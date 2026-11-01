// Conveyor Designer: every test case in spec 05 §8 (CD-1 to CD-10), run through
// the tool core in display units, the shared fixtures that prove the embedded
// motor and shaft models give identical results to specs 02 and 01 (§9), the
// requirements engine, and the files the tool exchanges.
// Run: node dev/test.js
'use strict';
const C = require('./core.js');
const MC = require('./vendor/motor-core.js');
const BC = require('./vendor/beam-core.js');
const Schemas = require('./vendor/schemas.js');
const Shell = require('./vendor/shell.js');
const PL = require('./vendor/prediction-log.js');
const F = require('./vendor/conveyor-shared.json');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ': ' + detail : '')); }
}
// 00 §10: 0.5% relative, or 0.01 in the displayed unit for values under 1.
function near(name, got, exp) {
  const good = typeof got === 'number' && isFinite(got) &&
    (Math.abs(exp) < 1 ? Math.abs(got - exp) <= 0.01 : Math.abs(got - exp) / Math.abs(exp) <= 0.005);
  ok(name, good, 'got ' + got + ', expected ' + exp);
}
function rel(name, got, exp) { ok(name, typeof got === 'number' && Math.abs(got - exp) / Math.abs(exp) <= 0.005, 'got ' + got + ', expected ' + exp); }
const st = o => Object.assign(C.defaultState(), o);
const des = o => C.design(st(o));
const f = v => Shell.util.fmtSig(v, 3), fu = (v, u) => f(v) + (u ? ' ' + u : '');

console.log('CD-1: level conveyor');
const d1 = des({});
{
  near('CD-1 m′_p = 3.33 kg/m', d1.load.mp, 3.33);
  near('CD-1 throughput 60 per minute', d1.load.throughput, 60);
  near('CD-1 T_e = 22.6 N', d1.pull.Te, 22.6);
  near('CD-1 P = 6.77 W', d1.power.P, 6.77);
  near('CD-1 motor power needed 10.2 W', d1.power.Pmotor, 10.2);
  rel('CD-1 T_p = 0.677 N·m', d1.pulley.Tp, 0.677);
  near('CD-1 N_p = 95.5 rpm', d1.pulley.Np, 95.5);
  ok('boxes on the belt: 6 to 7 (0.3 m does not divide 2 m)', d1.load.boxesMin === 6 && d1.load.boxesMax === 7 && !d1.load.divides);
  ok('a spacing that divides the bed gives one number', C.load(st({ s: 0.25 })).divides && C.load(st({ s: 0.25 })).boxesMax === 9);
  ok('belt pull does not depend on speed', des({ v: 0.6 }).pull.Te === d1.pull.Te);
  ok('level: no incline flag', d1.hold === null);
}

console.log('CD-2: incline');
{
  const d = des({ L: 1, H: 0.5 });
  near('CD-2 T_e = 27.6 N', d.pull.Te, 27.6);
  near('CD-2 friction part 11.3 N', d.pull.fric, 11.3);
  near('CD-2 lift part 16.4 N', d.pull.lift, 16.4);
  near('CD-2 backward pull 16.4 N, flag shown', d.hold.backward, 16.4);
  near('incline angle arcsin(H/L) = 30°', d.pull.angle * 180 / Math.PI, 30);
  const s = st({ L: 1, H: 0.5 });
  ok('CD-2 working names the backward pull', C.working(d, s, f, fu)[0].steps.some(x => x.title === 'Backward pull with the power off' && /brake or holding feature/.test(x.note)));
}

console.log('CD-3 and CD-4: tensions and side load');
const s3 = st({ T2auto: false }); s3.T2 = C.design(s3).tensions.T2min;
const d3 = C.design(s3);
{
  near('CD-3 e^(0.3π) = 2.57', d3.tensions.ef, 2.57);
  near('CD-3 T₂,min = 14.4 N', d3.tensions.T2min, 14.4);
  near('CD-3 T₁ = 37.0 N with T₂ = T₂,min', d3.tensions.T1, 37.0);
  near('CD-3 R = 51.4 N', d3.side.R, 51.4);
  ok('R = T₁ + T₂ at 180°', Math.abs(d3.side.R - (d3.tensions.T1 + d3.tensions.T2)) < 1e-9);
  ok('at 180° wrap the side load points along the belt, toward the tail (180°)', Math.abs(d3.side.angleDeg - 180) < 1e-9);
  const s4 = st({ wrap: 210, T2auto: false }); s4.T2 = C.design(s4).tensions.T2min;
  const d4 = C.design(s4);
  near('CD-4 e^(μθ) = 3.00', d4.tensions.ef, 3.00);
  near('CD-4 T₂,min = 11.3 N', d4.tensions.T2min, 11.3);
  near('CD-4 T₁ = 33.8 N', d4.tensions.T1, 33.8);
  near('CD-4 R = 44.0 N', d4.side.R, 44.0);
  near('default tension setting is 1.3 × T₂,min', d1.tensions.T2, 1.3 * d1.tensions.T2min);
}

console.log('CD-5 and CD-6: motor and ratio (table values, as ERRATA notes)');
{
  const d5 = C.drive({ Tp: 0.68, Np: 95.5, Ts: 2, N0: 300, ratioMode: 'hand', ratio: 3.14, eta: 0.9, D: 0.06, vTarget: 0.3 });
  near('CD-5 loaded pulley speed 84.0 rpm', d5.Nout, 84.0);
  near('CD-5 belt speed 0.264 m/s', d5.vBelt, 0.264);
  near('CD-5 speed error −12.0%', d5.speedErr, -12.0);
  const req = [{ id: 1, desc: 'Belt speed', qty: 'speed', cmp: 'within', target: 0.3, tol: 10 }];
  const fake = { drive: d5 };
  ok('CD-5 speed requirement 0.3 m/s ± 10%: fail', C.requirements(req, st({}), fake)[0].status === 'fail');
  const d6 = C.drive({ Tp: 0.68, Np: 95.5, Ts: 2, N0: 300, ratioMode: 'solver', ratio: 3.14, eta: 0.9, D: 0.06, vTarget: 0.3 });
  near('CD-6 i_high = 2.70', d6.i, 2.70);
  near('CD-6 belt speed 0.300 m/s', d6.vBelt, 0.300);
  ok('CD-6 speed requirement: pass', C.requirements(req, st({}), { drive: d6 })[0].status === 'pass');
  const linked = des({ eta: 0.9, ratioMode: 'hand', ratio: 3.14 });
  near('linked values in the tool: belt speed 0.264 m/s', linked.drive.vBelt, 0.264);
  ok('linked values: −11.9% (ERRATA CD-5/6 explains the 0.1%)', linked.drive.speedErr < -11.8 && linked.drive.speedErr > -12.0, String(linked.drive.speedErr));
  near('linked solver ratio is also 2.70 at η = 0.9', des({ eta: 0.9 }).drive.i, 2.70);
  const weak = des({ Ts: 0.5 });
  ok('a motor too weak for the target: no ratio, with the reason', weak.drive.i === null && /no ratio reaches/.test(weak.drive.reason) && weak.drive.vBelt === undefined);
  ok('a stalled motor at a hand ratio is a result, not an error', des({ Ts: 0.1, ratioMode: 'hand', ratio: 1 }).drive.op.stalled === true);
}

console.log('CD-7: shaft check');
{
  const s7 = Object.assign(st({ T2auto: false }), { T2: s3.T2 });
  const d = C.design(s7);
  near('CD-7 M = 1.28 N·m', d.shaft.M, 1.28);
  near('M = R L_b / 4', d.shaft.M, d.shaft.Mformula);
  near('CD-7 τ_max = 14.4 MPa', d.shaft.tauMax / 1e6, 14.4);
  near('CD-7 n = 13.8', d.shaft.n, 13.8);
  near('CD-7 bearing loads 25.7 N each', d.bearing, 25.7);
  near('bearing A from BeamCore agrees', d.shaft.RA, 25.7);
}

console.log('Shared fixtures (spec 05 §9): identical to the Matcher and the Workbench');
for (const c of F.motor) {
  const w0 = MC.rpmToRad(c.N0);
  if (c.ratio) {
    const mine = C.drive({ Tp: c.TL, Np: 95.5, Ts: c.Ts, N0: c.N0, ratioMode: 'hand', ratio: c.ratio, eta: c.eta, D: c.D, vTarget: c.vTarget });
    const theirs = MC.operate({ Ts: c.Ts, w0, k: 1, i: c.ratio, eta: c.eta, TL: c.TL, r: c.D / 2 });
    ok(c.id + ' operating point is the same number as MotorCore', mine.op.wout === theirs.wout && mine.op.Tm === theirs.Tm && mine.vBelt === theirs.v, mine.vBelt + ' vs ' + theirs.v);
    near(c.id + ' fixture belt speed', mine.vBelt, c.expect.vBelt);
  } else {
    const mine = C.drive({ Tp: c.TL, Np: c.Np, Ts: c.Ts, N0: c.N0, ratioMode: 'solver', eta: c.eta, D: c.D, vTarget: c.vTarget });
    const theirs = MC.solveRatio({ Ts: c.Ts, w0, k: 1, eta: c.eta, TL: c.TL, wTarget: MC.rpmToRad(c.Np) });
    ok(c.id + ' ratio is the same number as MotorCore', mine.i === theirs.iHigh && mine.solver.iLow === theirs.iLow);
    near(c.id + ' fixture i_high', mine.i, c.expect.iHigh);
  }
}
for (const c of F.shaft) {
  const mine = C.shaft(c.R, c.T, st({ Lb: c.Lb * 1000, dShaft: c.d * 1000, Sy: c.Sy / 1e6 }));
  const theirs = BC.analyze({ L: c.Lb, loads: [{ P: c.R, a: c.Lb / 2 }], mode: 'shaft', torque: { T: c.T, from: 0, to: c.Lb / 2 }, d: c.d, Sy: c.Sy, rule: 'tresca' });
  ok(c.id + ' shaft check is the same number as BeamCore', mine.n === theirs.n && mine.M === theirs.critical.M && mine.tauMax === theirs.critical.tauMax && mine.RA === theirs.RA, mine.n + ' vs ' + theirs.n);
  near(c.id + ' fixture n', mine.n, c.expect.n);
}

console.log('CD-8 and CD-9: lift and slip');
{
  ok('CD-8 lift above the bed length', C.liftCheck(2.5, 2) === 'Lift cannot be more than the bed length.' && C.liftCheck(2, 2) === null);
  const s = st({ T2auto: false, T2: 10 });
  s.reqs = [{ id: 1, desc: 'No slip', qty: 'slip', cmp: 'atLeast', target: 1 }];
  const d = C.design(s);
  ok('CD-9 tension below T₂,min: margin under 1 and the belt slips', d.tensions.margin < 1 && d.tensions.slips);
  ok('CD-9 slip requirement fails', d.reqs[0].status === 'fail');
  ok('CD-9 the working says the belt will slip', C.working(d, s, f, fu).find(g => g.heading === 'Tensions and slip').steps.some(x => /will slip/.test(x.note)));
}

console.log('CD-10: shaft-loads export for the Shaft and Beam Workbench');
{
  const file = Schemas.makeShaftLoads('Conveyor Designer', [C.shaftLoads(d3)]);
  const back = Schemas.readShaftLoads(JSON.stringify(file));
  ok('CD-10 one load', back.value.loads.length === 1 && !back.multiPlane);
  near('CD-10 load 51.4 N', back.value.loads[0].magnitude, 51.4);
  rel('CD-10 torque 0.677 N·m', back.value.loads[0].torque, 0.677);
  // The Workbench places it at the centre of a 100 mm span and carries the torque from A (its importLoads).
  const r = BC.analyze({ L: 0.1, loads: [{ P: back.value.loads[0].magnitude, a: 0.05 }], mode: 'shaft', torque: { T: back.value.loads[0].torque, from: 0, to: 0.05 }, d: 0.008, Sy: 400e6, rule: 'tresca' });
  near('CD-10 Workbench readout M matches CD-7', r.critical.M, 1.28);
  near('CD-10 Workbench readout n matches CD-7', r.n, 13.8);
}

console.log('Drive files');
{
  const req = Schemas.readDriveRequest(JSON.stringify(Schemas.makeDriveRequest('Conveyor Designer', C.driveRequest(d1, st({})))));
  rel('drive request carries T_p', req.value.loadTorque, 0.677);
  near('drive request carries N_p as the target', req.value.targetSpeed, 95.5);
  ok('drive request carries the motor and the solver ratio', req.value.motor.stallTorque === 2 && Math.abs(req.value.stages[0].ratio - d1.drive.i) < 1e-12);
  const res = Schemas.readDriveResult(JSON.stringify(Schemas.makeDriveResult('Motor and Drive Matcher', { motor: { label: 'M', stallTorque: 1.5, noLoadSpeed: 200, count: 2 }, stages: [{ ratio: 1.9, efficiency: 0.85 }], ratio: 1.9, efficiency: 0.85, loadTorque: 0.68, operatingPoint: {}, dutyBand: 'continuous' })));
  const s = st({});
  const notes = C.applyDriveResult(s, res);
  ok('a drive result sets the motor, a hand ratio and η', s.Ts === 3 && s.N0 === 200 && s.ratioMode === 'hand' && s.ratio === 1.9 && s.eta === 0.85);
  ok('parallel motors are explained', notes.length === 1 && /2 motors in parallel/.test(notes[0]));
}

console.log('Requirements (§4)');
{
  const s = st({});
  s.reqs = C.exampleRequirements(1);
  const d = C.design(s);
  ok('six example rows', d.reqs.length === 6);
  ok('the example rows score: speed pass, throughput pass, duty pass, slip pass, shaft pass, guard manual', d.reqs.map(r => r.status).join() === 'pass,pass,pass,pass,pass,manual', d.reqs.map(r => r.status).join());
  near('throughput uses the loaded belt speed', d.reqs[1].value, 60 * d.drive.vBelt / 0.3);
  near('power margin = (T_s ω₀ / 4) / motor power needed', d.powerMargin, (2 * 300 * 2 * Math.PI / 60 / 4) / d1.power.Pmotor);
  const row = (o) => C.requirements([Object.assign({ id: 1, desc: '' }, o)], s, d)[0];
  ok('at most', row({ qty: 'duty', cmp: 'atMost', target: 5 }).status === 'fail');
  ok('box mass capacity', row({ qty: 'boxMass', cmp: 'atLeast', target: 1 }).status === 'pass');
  ok('a row with no target is not defined, not a pass', row({ qty: 'speed', cmp: 'within', target: null, tol: 10 }).status === 'undefined');
  const weak = C.design(Object.assign(st({ Ts: 0.5 }), { reqs: [{ id: 1, qty: 'speed', cmp: 'within', target: 0.3, tol: 10 }] }));
  ok('a speed requirement with no feasible ratio is not defined', weak.reqs[0].status === 'undefined' && /not defined/.test(weak.reqs[0].reason));
}

console.log('Predict-first targets, working and records');
{
  const t = C.targets(d1);
  ok('six targets in five steps, with the shared quantity names', t.map(x => x.quantity).join('|') === 'belt pull T_e|belt power P|pulley speed N_p|minimum slack-side tension T2_min|shaft side load R|shaft safety factor n' && new Set(t.map(x => x.group)).size === 5);
  const w = C.working(d1, st({}), f, fu);
  ok('working in step order, each tied to a predict step', w.map(g => g.heading).join('|') === 'Load and belt pull|Power|Drive pulley|Motor and ratio|Tensions and slip|Pulley shaft and bearings' && w.every(g => g.group));
  ok('every step names a source', w.every(g => g.steps.every(x => x.source)));
  ok('no NaN or Infinity in the working, even with no feasible ratio', !/NaN|Infinity|undefined/.test(JSON.stringify(C.working(des({ Ts: 0.5 }), st({ Ts: 0.5 }), f, fu))));
  const rec = PL.makeRecord({ tool: 'Conveyor Designer', toolVersion: '1.0.0', student: 'Team A', problemId: 'CD-1', quantity: t[0].quantity, unit: 'N', predicted: 20, model: t[0].model, attempt: 1, inputs: C.snapshot(st({})) });
  near('record percent difference for T_e', rec.pctPredVsModel, (20 - d1.pull.Te) / d1.pull.Te * 100);
  ok('description gives the main numbers unless masked', /22.6 N/.test(C.describe(d1, st({}), fu, false)) && !/22.6/.test(C.describe(d1, st({}), fu, true)));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
