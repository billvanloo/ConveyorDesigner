// Conveyor Designer core (spec 05). Takes the interface state in display units
// (kg, m, m/s, mm, N·m, rpm, MPa, degrees) and steps through the design in the
// unit's order: load and throughput, belt pull, power, drive pulley, motor and
// ratio (the shared MotorCore, unchanged), belt tensions and slip, pulley-shaft
// side load and check (the shared BeamCore, unchanged), bearings and the
// incline hold. It also scores the team's requirements, builds the working,
// targets, description and the shaft-loads and drive-request files.
// Pure functions; tested in dev/test.js.
const ConveyorCore = (function () {
  'use strict';
  const MC = typeof MotorCore !== 'undefined' ? MotorCore : require('./vendor/motor-core.js');
  const BC = typeof BeamCore !== 'undefined' ? BeamCore : require('./vendor/beam-core.js');
  const G = 9.81;
  const isNum = v => typeof v === 'number' && isFinite(v);
  const DEG = Math.PI / 180;
  const rad = MC.rpmToRad, rpm = MC.radToRpm;
  // Rounding noise from an exact solver root (1e-14 %) reads as 0.
  const clean = v => Math.abs(v) < 1e-9 ? 0 : v;

  const SOURCES = {
    pc: 'PackagingConveyor.com, conveyor engineering calculations',
    rul: 'Rulmeca, how to calculate conveyor belt tensions',
    bison: 'BisonConvey, capstan equation',
    wiki: 'Wikipedia, capstan equation',
    motor: 'Spec 02 (Motor and Drive Matcher) §3.1–3.4',
    shaft: 'Spec 01 (Shaft and Beam Workbench) §3.4',
    vr: 'v = ω r (OpenStax University Physics Vol. 1, 10.8)',
  };

  function defaultState() {
    return {
      mode: 'sandbox', tab: 'requirements',
      mBox: 1, s: 0.3, v: 0.3, L: 2, H: 0, mb: 0.5, mu: 0.3, SF: 1.5, eta: 1.0, D: 60,
      Ts: 2, N0: 300, ratioMode: 'solver', ratio: 3.14,
      muP: 0.3, wrap: 180, T2auto: true, T2: 18.7,
      Lb: 100, dShaft: 8, Sy: 400,
      reqs: [], nextReq: 1,
    };
  }

  // Field rules (spec 05 §5, 00 §8), in display units. Motor and shaft ranges follow specs 02 and 01.
  const FIELDS = {
    mBox: { name: 'Box mass', unit: 'kg', min: 0.01, max: 100 },
    s: { name: 'Box spacing', unit: 'm', min: 0.05, max: 10 },
    v: { name: 'Target belt speed', unit: 'm/s', min: 0.01, max: 5 },
    L: { name: 'Bed length', unit: 'm', min: 0.2, max: 20 },
    H: { name: 'Lift', unit: 'm', min: 0, max: 20 },
    mb: { name: 'Belt mass per meter', unit: 'kg/m', min: 0.01, max: 20 },
    mu: { name: 'Bed friction μ', min: 0.01, max: 1 },
    SF: { name: 'Service factor', min: 1, max: 3 },
    eta: { name: 'Drive efficiency η', min: 0.3, max: 1 },
    D: { name: 'Pulley diameter', unit: 'mm', min: 10, max: 1000 },
    Ts: { name: 'Stall torque', unit: 'N·m', min: 0.001, max: 500 },
    N0: { name: 'No-load speed', unit: 'rpm', min: 1, max: 50000 },
    ratio: { name: 'Ratio', min: 0.1, max: 100 },
    muP: { name: 'Pulley friction μp', min: 0.05, max: 1 },
    wrap: { name: 'Wrap angle', unit: '°', min: 90, max: 270 },
    T2: { name: 'Belt tension setting', unit: 'N', gt: 0, max: 100000 },
    Lb: { name: 'Bearing span', unit: 'mm', min: 10, max: 2000 },
    dShaft: { name: 'Shaft diameter', unit: 'mm', min: 1, max: 200 },
    Sy: { name: 'Yield strength', unit: 'MPa', min: 1, max: 2000 },
  };
  // CD-8.
  const liftCheck = (H, L) => H > L ? 'Lift cannot be more than the bed length.' : null;

  /* ------------------------------------------------------------ steps §3.1–3.4 */
  function load(s) {
    const mp = s.mBox / s.s;
    const ratio = s.L / s.s, fl = Math.floor(ratio + 1e-9);
    const divides = Math.abs(ratio - Math.round(ratio)) < 1e-9;
    return { mp, throughput: 60 * s.v / s.s, boxesMax: fl + 1, boxesMin: divides ? fl + 1 : fl, divides };
  }
  function beltPull(s, mp) {
    const fric = s.mu * G * (s.mb + mp) * s.L, lift = mp * G * s.H;
    return { fric, lift, Te: fric + lift, angle: s.L > 0 ? Math.asin(Math.min(1, s.H / s.L)) : 0 };
  }
  function power(s, Te) { const P = Te * s.v; return { P, Pmotor: P * s.SF / s.eta }; }
  function pulley(s, Te) { const D = s.D / 1000; return { D, Tp: Te * D / 2, Np: 60 * s.v / (Math.PI * D) }; }

  /* ------------------------------------------------------------ motor and ratio §3.5 (MotorCore) */
  // o: { Tp (N·m), Np (rpm), Ts (N·m), N0 (rpm), ratioMode, ratio, eta, D (m), vTarget (m/s) }
  function drive(o) {
    const w0 = rad(o.N0), wT = rad(o.Np);
    const solver = MC.solveRatio({ Ts: o.Ts, w0, k: 1, eta: o.eta, TL: o.Tp, wTarget: wT });
    const i = o.ratioMode === 'solver' ? (solver.feasible ? solver.iHigh : null) : o.ratio;
    const out = { solver, i, Pmax: MC.motor({ Ts: o.Ts, w0, k: 1 }).Pmax };
    if (i === null) { out.reason = 'no ratio reaches the target speed with this motor and load'; return out; }
    const op = MC.operate({ Ts: o.Ts, w0, k: 1, i, eta: o.eta, TL: o.Tp, r: o.D / 2 });
    out.op = op;
    out.Nm = rpm(op.wm); out.Nout = rpm(op.wout);
    out.vBelt = op.wout * o.D / 2;                      // v = ω r
    out.speedErr = clean((out.vBelt - o.vTarget) / o.vTarget * 100);
    if (op.stalled) out.reason = 'the motor stalls: the load needs more than its stall torque at this ratio';
    return out;
  }

  /* ------------------------------------------------------------ tensions §3.6 */
  function tensions(s, Te) {
    const theta = s.wrap * DEG, ef = Math.exp(s.muP * theta);
    const T2min = Te / (ef - 1);
    const T2 = s.T2auto ? 1.3 * T2min : s.T2;
    const T1 = Te + T2;
    return { theta, ef, T2min, T2, T1, margin: T2 / T2min, slips: T2 < T2min, TeMax: T2 * (ef - 1) };
  }

  /* ------------------------------------------------------------ side load, shaft, bearings §3.7 */
  // The two spans' directions differ by (180° − θ). The tight span leaves the drive pulley toward the
  // tail (180° on the side view); the slack span turns by the wrap. Their sum gives R and its direction.
  function sideLoad(T1, T2, theta) {
    const R = Math.sqrt(T1 * T1 + T2 * T2 - 2 * T1 * T2 * Math.cos(theta));
    const a2 = 2 * Math.PI - theta;
    const x = T1 * Math.cos(Math.PI) + T2 * Math.cos(a2), y = T1 * Math.sin(Math.PI) + T2 * Math.sin(a2);
    let ang = Math.atan2(y, x) / DEG; if (ang < 0) ang += 360;
    return { R, angleDeg: ang };
  }
  // Centred pulley on a shaft between two bearings, through BeamCore unchanged. The drive torque runs
  // from the coupling at bearing A to the pulley (QUESTIONS Q22 has the direction note).
  function shaft(R, Tp, s) {
    const Lb = s.Lb / 1000;
    const res = BC.analyze({ L: Lb, loads: [{ P: R, a: Lb / 2, label: 'Drive pulley' }], mode: 'shaft', torque: { T: Tp, from: 0, to: Lb / 2 }, d: s.dShaft / 1000, Sy: s.Sy * 1e6, rule: 'tresca' });
    const c = res.critical;
    return { Lb, beam: res, M: c ? c.M : null, T: c ? c.T : null, tauMax: c ? c.tauMax : null, n: res.n, RA: res.RA, RB: res.RB, Mformula: R * Lb / 4 };
  }

  /* ------------------------------------------------------------ the whole design */
  function design(s) {
    const ld = load(s), bp = beltPull(s, ld.mp), pw = power(s, bp.Te), pu = pulley(s, bp.Te);
    const dr = drive({ Tp: pu.Tp, Np: pu.Np, Ts: s.Ts, N0: s.N0, ratioMode: s.ratioMode, ratio: s.ratio, eta: s.eta, D: pu.D, vTarget: s.v });
    const tn = tensions(s, bp.Te);
    const sl = sideLoad(tn.T1, tn.T2, tn.theta);
    const sh = shaft(sl.R, pu.Tp, s);
    const out = {
      load: ld, pull: bp, power: pw, pulley: pu, drive: dr, tensions: tn, side: sl, shaft: sh,
      bearing: sl.R / 2,
      hold: s.H > 0 ? { backward: ld.mp * G * s.H } : null,
      throughputActual: isNum(dr.vBelt) ? 60 * dr.vBelt / s.s : null,
      powerMargin: dr.Pmax / pw.Pmotor,
    };
    out.reqs = requirements(s.reqs || [], s, out);
    return out;
  }

  /* ------------------------------------------------------------ requirements §4 */
  const QUANTITIES = {
    speed: { label: 'Belt speed', unit: 'm/s', cmp: 'within', value: (s, d) => d.drive.vBelt, output: 'loaded belt speed from the chosen ratio' },
    throughput: { label: 'Throughput', unit: 'boxes/min', cmp: 'atLeast', value: (s, d) => d.throughputActual, output: 'boxes per minute at the loaded belt speed' },
    boxMass: { label: 'Box mass capacity', unit: 'kg', cmp: 'atLeast', value: s => s.mBox, output: 'box mass used in T_e' },
    length: { label: 'Length', unit: 'm', cmp: 'atLeast', value: s => s.L, output: 'bed length L' },
    lift: { label: 'Lift', unit: 'm', cmp: 'atLeast', value: s => s.H, output: 'lift H' },
    duty: { label: 'Motor duty', unit: '% of stall', cmp: 'atMost', value: (s, d) => d.drive.op ? d.drive.op.pct : null, output: 'motor torque as a percent of stall' },
    slip: { label: 'Slip margin', unit: '', cmp: 'atLeast', value: (s, d) => d.tensions.margin, output: 'T₂ setting ÷ T₂,min' },
    shaftN: { label: 'Shaft safety factor', unit: '', cmp: 'atLeast', value: (s, d) => d.shaft.n, output: 'n from the shaft check' },
    powerMargin: { label: 'Motor power margin', unit: '', cmp: 'atLeast', value: (s, d) => d.powerMargin, output: 'maximum motor power ÷ motor power needed (QUESTIONS Q19)' },
    custom: { label: 'Custom', unit: '', cmp: 'manual', value: () => null, output: 'checked by the team' },
  };
  const CMPS = { within: 'within ±', atLeast: 'at least', atMost: 'at most', manual: 'checked by hand' };
  function requirements(rows, s, d) {
    return rows.map(r => {
      const q = QUANTITIES[r.qty] || QUANTITIES.custom;
      const cmp = r.qty === 'custom' ? 'manual' : (r.cmp || q.cmp);
      if (cmp === 'manual') return { row: r, q, cmp, value: null, status: 'manual' };
      const value = q.value(s, d);
      if (!isNum(value) || !isNum(r.target)) return { row: r, q, cmp, value: isNum(value) ? value : null, status: 'undefined', reason: isNum(value) ? 'no target' : 'not defined for this design' };
      let pass;
      const diff = r.target !== 0 ? clean((value - r.target) / r.target * 100) : null;
      if (cmp === 'within') pass = diff !== null && Math.abs(diff) <= (isNum(r.tol) ? r.tol : 0) + 1e-9;
      else if (cmp === 'atLeast') pass = value >= r.target - 1e-12;
      else pass = value <= r.target + 1e-12;
      return { row: r, q, cmp, value, diff, status: pass ? 'pass' : 'fail' };
    });
  }
  // The rows in the mockup, as a starting set the team edits.
  function exampleRequirements(startId) {
    const ex = [
      { desc: 'Belt speed', qty: 'speed', cmp: 'within', target: 0.3, tol: 10 },
      { desc: 'Throughput', qty: 'throughput', cmp: 'atLeast', target: 55 },
      { desc: 'Motor runs cool', qty: 'duty', cmp: 'atMost', target: 30 },
      { desc: 'Belt does not slip', qty: 'slip', cmp: 'atLeast', target: 1.2 },
      { desc: 'Pulley shaft is strong enough', qty: 'shaftN', cmp: 'atLeast', target: 2 },
      { desc: 'Guards on both nip points', qty: 'custom', cmp: 'manual', target: null },
    ];
    return ex.map((r, k) => Object.assign({ id: startId + k, tol: null }, r));
  }

  /* ------------------------------------------------------------ predict targets (§7) */
  // One Check per design step (shell groups). Quantity names are fixed in ecosystem/schemas.md.
  function targets(d) {
    return [
      { key: 'Te', group: 'pull', groupLabel: 'Belt pull', quantity: 'belt pull T_e', label: 'Belt pull T<sub>e</sub>', unit: 'N', model: d.pull.Te },
      { key: 'P', group: 'power', groupLabel: 'Power', quantity: 'belt power P', label: 'Belt power P', unit: 'W', model: d.power.P },
      { key: 'Np', group: 'pulley', groupLabel: 'Drive pulley', quantity: 'pulley speed N_p', label: 'Pulley speed N<sub>p</sub>', unit: 'rpm', model: d.pulley.Np },
      { key: 'T2min', group: 'tensions', groupLabel: 'Tensions and slip', quantity: 'minimum slack-side tension T2_min', label: 'T<sub>2,min</sub>', unit: 'N', model: d.tensions.T2min },
      { key: 'R', group: 'shaft', groupLabel: 'Pulley shaft', quantity: 'shaft side load R', label: 'Side load R', unit: 'N', model: d.side.R },
      { key: 'n', group: 'shaft', groupLabel: 'Pulley shaft', quantity: 'shaft safety factor n', label: 'Safety factor n', unit: '', model: d.shaft.n },
    ];
  }

  /* ------------------------------------------------------------ show the working (00 §5), by step */
  function working(d, s, f, fu) {
    const ld = d.load, bp = d.pull, pw = d.power, pu = d.pulley, dr = d.drive, tn = d.tensions, sl = d.side, sh = d.shaft;
    const groups = [];
    const pull = [
      { title: 'Product mass per meter', formula: 'm′_p = m_box / s', sub: fu(s.mBox, 'kg') + ' / ' + fu(s.s, 'm'), result: fu(ld.mp, 'kg/m'), source: SOURCES.pc },
      { title: 'Throughput', formula: '60 v / s', sub: '60 × ' + fu(s.v, 'm/s') + ' / ' + fu(s.s, 'm'), result: fu(ld.throughput, 'boxes/min'), source: SOURCES.pc },
      { title: 'Friction part of the belt pull', formula: 'μ g (m′_b + m′_p) L', sub: f(s.mu) + ' × 9.81 m/s² × (' + fu(s.mb, 'kg/m') + ' + ' + fu(ld.mp, 'kg/m') + ') × ' + fu(s.L, 'm'), result: fu(bp.fric, 'N'), source: SOURCES.pc },
      { title: 'Lift part of the belt pull', formula: 'm′_p g H', sub: fu(ld.mp, 'kg/m') + ' × 9.81 m/s² × ' + fu(s.H, 'm'), result: fu(bp.lift, 'N'), note: s.H > 0 ? 'The friction part uses the full weight, which slightly overestimates friction on an incline: on the safe side.' : '', source: SOURCES.pc },
      { title: 'Belt pull (effective tension)', formula: 'T_e = μ g (m′_b + m′_p) L + m′_p g H', sub: fu(bp.fric, 'N') + ' + ' + fu(bp.lift, 'N'), result: fu(bp.Te, 'N'), note: 'Belt pull does not depend on belt speed.', source: SOURCES.pc },
    ];
    if (d.hold) pull.push({ title: 'Backward pull with the power off', formula: 'm′_p g H', sub: fu(ld.mp, 'kg/m') + ' × 9.81 m/s² × ' + fu(s.H, 'm'), result: fu(d.hold.backward, 'N'), note: 'On an incline the load can drive the belt backward. Check whether the motor and gearbox hold, or add a brake or holding feature.', source: SOURCES.pc });
    groups.push({ heading: 'Load and belt pull', group: 'pull', steps: pull });
    groups.push({ heading: 'Power', group: 'power', steps: [
      { title: 'Belt power', formula: 'P = T_e v', sub: fu(bp.Te, 'N') + ' × ' + fu(s.v, 'm/s'), result: fu(pw.P, 'W'), source: SOURCES.rul },
      { title: 'Motor power needed', formula: 'P × service factor ÷ η', sub: fu(pw.P, 'W') + ' × ' + f(s.SF) + ' ÷ ' + f(s.eta), result: fu(pw.Pmotor, 'W'), source: SOURCES.pc },
    ] });
    groups.push({ heading: 'Drive pulley', group: 'pulley', steps: [
      { title: 'Pulley torque', formula: 'T_p = T_e D / 2', sub: fu(bp.Te, 'N') + ' × ' + fu(s.D, 'mm') + ' / 2', result: fu(pu.Tp, 'N·m'), source: SOURCES.rul },
      { title: 'Pulley speed', formula: 'N_p = 60 v / (π D)', sub: '60 × ' + fu(s.v, 'm/s') + ' / (π × ' + fu(s.D, 'mm') + ')', result: fu(pu.Np, 'rpm'), source: SOURCES.vr },
    ] });
    const mot = [];
    const sv = dr.solver;
    mot.push({ title: 'Ratio for the target speed under load', formula: 'ω_out i² − ω₀ i + ω₀ T_L / (η T_s) = 0', sub: f(sv.a) + ' i² − ' + f(-sv.b) + ' i + ' + f(sv.c) + ' = 0', result: sv.feasible ? 'i = ' + f(sv.iHigh) + (sv.iLow ? ' or ' + f(sv.iLow) : '') : 'no real root', note: sv.feasible ? 'The larger root keeps the motor below half its stall torque.' : 'No ratio reaches the target speed with this motor and load.', source: SOURCES.motor });
    if (dr.op) {
      const op = dr.op;
      mot.push({ title: 'Motor torque at the chosen ratio', formula: 'T_m = T_L / (i η)', sub: fu(pu.Tp, 'N·m') + ' / (' + f(dr.i) + ' × ' + f(s.eta) + ')', result: fu(op.Tm, 'N·m') + ' = ' + fu(op.pct, '% of stall'), note: 'Duty band: ' + op.band + '.', source: SOURCES.motor });
      mot.push({ title: 'Loaded speeds', formula: 'N_m = N₀ (1 − T_m/T_s),  N_out = N_m / i', sub: fu(s.N0, 'rpm') + ' × (1 − ' + f(op.Tm) + ' / ' + f(s.Ts) + '),  ÷ ' + f(dr.i), result: fu(dr.Nm, 'rpm') + ', ' + fu(dr.Nout, 'rpm'), source: SOURCES.motor });
      mot.push({ title: 'Loaded belt speed', formula: 'v = N_out π D / 60', sub: fu(dr.Nout, 'rpm') + ' × π × ' + fu(s.D, 'mm') + ' / 60', result: fu(dr.vBelt, 'm/s') + ' (' + U3pct(dr.speedErr) + ' against ' + fu(s.v, 'm/s') + ')', source: SOURCES.vr });
    }
    mot.push({ title: 'Motor power margin', formula: '(T_s ω₀ / 4) ÷ motor power needed', sub: fu(dr.Pmax, 'W') + ' ÷ ' + fu(pw.Pmotor, 'W'), result: f(d.powerMargin), note: 'Maximum motor power is at half the stall torque (QUESTIONS Q19).', source: SOURCES.motor });
    groups.push({ heading: 'Motor and ratio', group: 'pulley', steps: mot });
    groups.push({ heading: 'Tensions and slip', group: 'tensions', steps: [
      { title: 'Capstan factor', formula: 'e^(μ_p θ)', sub: 'e^(' + f(s.muP) + ' × ' + f(tn.theta) + ' rad)', result: f(tn.ef), note: 'θ in radians: ' + f(s.wrap) + '° = ' + f(tn.theta) + ' rad.', source: SOURCES.wiki },
      { title: 'Minimum slack-side tension', formula: 'T₂,min = T_e / (e^(μ_p θ) − 1)', sub: fu(bp.Te, 'N') + ' / (' + f(tn.ef) + ' − 1)', result: fu(tn.T2min, 'N'), source: SOURCES.bison },
      { title: 'Your belt tension setting', formula: s.T2auto ? 'T₂ = 1.3 × T₂,min' : 'T₂ (set by the team)', sub: s.T2auto ? '1.3 × ' + fu(tn.T2min, 'N') : '', result: fu(tn.T2, 'N'), source: SOURCES.rul },
      { title: 'Tight-side tension', formula: 'T₁ = T_e + T₂', sub: fu(bp.Te, 'N') + ' + ' + fu(tn.T2, 'N'), result: fu(tn.T1, 'N'), source: SOURCES.rul },
      { title: 'Slip margin', formula: 'T₂ / T₂,min', sub: fu(tn.T2, 'N') + ' / ' + fu(tn.T2min, 'N'), result: f(tn.margin), note: tn.slips ? 'Below 1: the belt will slip on the drive pulley.' : '', source: SOURCES.bison },
    ] });
    groups.push({ heading: 'Pulley shaft and bearings', group: 'shaft', steps: [
      { title: 'Side load on the pulley shaft', formula: 'R = √(T₁² + T₂² − 2 T₁ T₂ cos θ)', sub: '√(' + f(tn.T1) + '² + ' + f(tn.T2) + '² − 2 × ' + f(tn.T1) + ' × ' + f(tn.T2) + ' × cos ' + f(s.wrap) + '°)', result: fu(sl.R, 'N'), note: s.wrap === 180 ? 'For θ = 180° this is T₁ + T₂.' : '', source: SOURCES.rul },
      { title: 'Bending moment, pulley centred', formula: 'M = R L_b / 4', sub: fu(sl.R, 'N') + ' × ' + fu(s.Lb, 'mm') + ' / 4', result: fu(sh.Mformula, 'N·m'), source: SOURCES.shaft },
      { title: 'Largest shear stress (Tresca)', formula: 'τ_max = (16 / (π d³)) √(M² + T²)', sub: '16 / (π × (' + fu(s.dShaft, 'mm') + ')³) × √(' + f(sh.M) + '² + ' + f(pu.Tp) + '²)', result: fu(sh.tauMax / 1e6, 'MPa'), source: SOURCES.shaft },
      { title: 'Safety factor', formula: 'n = S_y / (2 τ_max)', sub: fu(s.Sy, 'MPa') + ' / (2 × ' + fu(sh.tauMax / 1e6, 'MPa') + ')', result: f(sh.n), note: 'The yield strength is a placeholder until the team enters a datasheet value.', source: SOURCES.shaft },
      { title: 'Bearing loads', formula: 'R / 2 each', sub: fu(sl.R, 'N') + ' / 2', result: fu(d.bearing, 'N') + ' each', source: SOURCES.shaft },
    ] });
    return groups;
  }
  const U3pct = p => (isNum(p) ? (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1) + '%' : 'not defined');

  /* ------------------------------------------------------------ files */
  function shaftLoads(d) {
    return { label: 'Drive pulley', magnitude: d.side.R, angleDeg: d.side.angleDeg, torque: d.pulley.Tp };
  }
  function driveRequest(d, s) {
    return {
      loadTorque: d.pulley.Tp, targetSpeed: d.pulley.Np,
      stages: isNum(d.drive.i) ? [{ ratio: d.drive.i, efficiency: s.eta }] : undefined,
      motor: { label: 'Team motor', stallTorque: s.Ts, noLoadSpeed: s.N0, count: 1 },
      note: 'Capstone conveyor drive',
    };
  }
  // A drive-result from the Motor and Drive Matcher: take its motor and overall ratio and efficiency.
  function applyDriveResult(s, res) {
    const v = res.value, notes = [];
    if (v.motor && v.motor.stallTorque > 0 && v.motor.noLoadSpeed > 0) {
      const k = Math.max(1, Math.round(v.motor.count || 1));
      s.Ts = v.motor.stallTorque * k; s.N0 = v.motor.noLoadSpeed;
      if (k > 1) notes.push('The result uses ' + k + ' motors in parallel; the Conveyor Designer models them as one motor with ' + k + ' times the stall torque.');
    }
    s.ratioMode = 'hand'; s.ratio = Number(Number(v.ratio).toPrecision(6));
    if (isNum(v.efficiency)) { const e = Math.min(1, Math.max(0.3, v.efficiency)); if (e !== v.efficiency) notes.push('The drive efficiency was kept within 0.3 to 1.'); s.eta = e; }
    return notes;
  }

  function describe(d, s, fu, masked) {
    let t = 'Side view of a ' + fu(s.L, 'm') + ' slider-bed conveyor' + (s.H > 0 ? ' rising ' + fu(s.H, 'm') : '') + ', boxes of ' + fu(s.mBox, 'kg') + ' every ' + fu(s.s, 'm') + ', drive pulley ' + fu(s.D, 'mm') + ' at the head. ';
    if (!masked) {
      t += 'Belt pull ' + fu(d.pull.Te, 'N') + '. ';
      if (isNum(d.drive.vBelt)) t += 'Loaded belt speed ' + fu(d.drive.vBelt, 'm/s') + '. ';
      t += 'Tight side ' + fu(d.tensions.T1, 'N') + ', slack side ' + fu(d.tensions.T2, 'N') + (d.tensions.slips ? ': the belt will slip. ' : '. ');
      t += 'Side load on the pulley shaft ' + fu(d.side.R, 'N') + '.';
    }
    const failing = d.reqs.filter(r => r.status === 'fail').length;
    if (d.reqs.length) t += ' Requirements: ' + d.reqs.filter(r => r.status === 'pass').length + ' pass, ' + failing + ' fail.';
    return t;
  }

  function snapshot(s) {
    return {
      values: { mBox: s.mBox, s: s.s, v: s.v, L: s.L, H: s.H, mb: s.mb, mu: s.mu, SF: s.SF, eta: s.eta, D: s.D / 1000, Ts: s.Ts, omega0: rad(s.N0), ratio: s.ratioMode === 'solver' ? 'solver' : s.ratio, muP: s.muP, wrap: s.wrap * DEG, T2: s.T2auto ? 'auto' : s.T2, Lb: s.Lb / 1000, d: s.dShaft / 1000, Sy: s.Sy * 1e6 },
      units: { mBox: 'kg', s: 'm', v: 'm/s', L: 'm', H: 'm', mb: 'kg/m', mu: '', SF: '', eta: '', D: 'm', Ts: 'N·m', omega0: 'rad/s', ratio: '', muP: '', wrap: 'rad', T2: 'N', Lb: 'm', d: 'm', Sy: 'Pa' },
    };
  }

  return { G, SOURCES, FIELDS, QUANTITIES, CMPS, defaultState, liftCheck, load, beltPull, power, pulley, drive, tensions, sideLoad, shaft, design, requirements, exampleRequirements, targets, working, shaftLoads, driveRequest, applyDriveResult, describe, snapshot };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ConveyorCore;
