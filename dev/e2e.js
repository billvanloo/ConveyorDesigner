// Browser checks for the Conveyor Designer: the standard shell checks, then spec
// 05's test cases and acceptance criteria through the interface, including CD-10
// in the real Shaft and Beam Workbench and a drive request round trip through the
// real Motor and Drive Matcher (both skipped, with a message, when the sibling
// repo isn't checked out next to this one).
// Run: node dev/e2e.js   (needs Playwright: npm i --no-save playwright)
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const kit = require('./vendor/e2e-kit.js');

(async () => {
  const root = path.join(__dirname, '..');
  const t = await kit.start(root);
  const { page } = t;
  const shots = path.join(root, 'docs', 'screenshots');
  await kit.standard(t, {
    predictKeys: ['Te', 'P', 'Np', 'T2min', 'R', 'n'],
    change: async p => { await p.fill('#cdMBox', '2'); },
    mutate: async p => { await p.fill('#cdL', '3'); },
    shotDir: shots, shotName: 'conveyor-designer',
  });

  const D = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__cd.design(), (k, v) => k === 'beam' ? undefined : v)));
  const rows = sel => page.evaluate(s => Object.fromEntries([...document.querySelectorAll(s + ' tr')].filter(r => r.querySelector('th') && r.querySelector('td')).map(r => [r.querySelector('th').textContent.trim(), r.querySelector('td').textContent.trim()])), sel);
  const step = id => rows('#cdStep_' + id);
  const right = () => rows('#shResultsBody');
  const fill = (sel, v) => page.fill(sel, String(v));
  const tmp = (name, obj) => { const p = path.join(os.tmpdir(), 'cd-' + process.pid + '-' + name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };

  console.log('CD-1: the default conveyor through the interface');
  await t.fresh();
  await page.click('#shTab_design');
  let s = await step('pull');
  t.ok('CD-1 m′_p 3.33 kg/m, throughput 60.0 boxes/min', s['Product mass per meter m′p'] === '3.33 kg/m' && s['Throughput at the target speed'] === '60.0 boxes/min');
  t.ok('CD-1 T_e 22.6 N', s['Belt pull Te'] === '22.6 N');
  t.ok('CD-1 P 6.77 W, motor power needed 10.2 W', (await step('power'))['Belt power P = Te v'] === '6.77 W' && Object.values(await step('power'))[1] === '10.2 W');
  t.ok('CD-1 T_p 0.677 N·m, N_p 95.5 rpm', (await step('pulley'))['Pulley torque Tp'] === '0.677 N·m' && (await step('pulley'))['Pulley speed Np'] === '95.5 rpm');
  t.ok('right column summary matches the mockup (60.0 N / 12.2 at 1.3 × T₂,min)', (await right())['Side load R / shaft n'] === '60.0 N / 12.2' && (await right())['T2,min / setting / T1'] === '14.4 / 18.7 / 41.3 N');
  t.ok('the solver hits the target: speed error 0%', (await step('motor'))['Speed error against 0.300 m/s'] === '0%');
  t.ok('the side view shows T_e, v and throughput', (await page.textContent('#cdSvg')).includes('= 22.6 N · v = 0.300 m/s · 60.0 boxes/min'));
  t.ok('Design tab says there are no requirements yet', await page.isVisible('#cdNoReq'));

  console.log('CD-2: incline');
  await fill('#cdL', 1); await fill('#cdH', 0.5);
  s = await step('pull');
  t.ok('CD-2 T_e 27.6 N, friction 11.3 N, lift 16.4 N', s['Belt pull Te'] === '27.6 N' && s['Friction part'] === '11.3 N' && s['Lift part'] === '16.4 N');
  t.ok('CD-2 backward pull 16.4 N and the incline flag', s['Backward pull, power off'] === '16.4 N' && (await page.textContent('#cdSvg')).includes('the load can drive the belt backward with the power off (16.4 N)'));
  t.ok('the side view is drawn at 30°', (await page.textContent('#cdSvg')).includes('(30.0°)'));

  console.log('CD-8: lift above the bed length');
  await fill('#cdH', 3);
  t.ok('CD-8 field message', (await page.textContent('#cdHErr')) === 'Lift cannot be more than the bed length.');
  await kit.noBadNumbers(t, 'CD-8');
  await fill('#cdL', 4);
  t.ok('lengthening the bed clears the message', (await page.textContent('#cdHErr')) === '');

  console.log('CD-3, CD-4 and CD-7: tensions, side load and shaft');
  await t.fresh();
  await page.click('#shTab_design');
  await page.uncheck('#cdT2a');
  t.ok('turning off 1.3 × T₂,min keeps the current setting, 18.7 N', (await page.inputValue('#cdT2')) === '18.7');
  const T2min3 = (await D()).tensions.T2min;
  await fill('#cdT2', T2min3.toFixed(6));
  s = await step('tensions');
  t.ok('CD-3 e^(μθ) 2.57, T₂,min 14.4 N, T₁ 37.0 N', s['Capstan factor eμθ'] === '2.57' && s['T2,min'] === '14.4 N' && s['Tight side T1'] === '37.0 N');
  t.ok('CD-3 R 51.4 N', (await step('shaft'))['Side load R'].startsWith('51.4 N'));
  const sh = await step('shaft');
  t.ok('CD-7 M 1.28 N·m, τ_max 14.4 MPa, n 13.8, bearings 25.7 N each', sh['Bending moment M = R Lb/4'] === '1.28 N·m' && sh['τmax (Tresca)'] === '14.4 MPa' && sh['Safety factor n'] === '13.8 (no unit)' && sh['Bearing loads'] === '25.7 N each');
  t.ok('the placeholder yield strength is flagged', (await page.textContent('#cdStep_shaft')).includes('Placeholder value in use'));
  const shaftFile = await kit.download(t, () => page.click('#cdExpShaft'));
  t.ok('shaft-loads file name', /_conveyor-designer_shaft-loads_\d{4}-\d{2}-\d{2}\.json$/.test(shaftFile.name), shaftFile.name);
  const sl = JSON.parse(shaftFile.buf.toString('utf8'));
  t.ok('CD-10 file: one load of 51.4 N with torque 0.677 N·m', sl.schema === 'shaft-loads' && sl.loads.length === 1 && Math.abs(sl.loads[0].magnitude - 51.37) < 0.01 && Math.abs(sl.loads[0].torque - 0.677) < 0.001);
  await fill('#cdWrap', 210);
  const T2min4 = (await D()).tensions.T2min;
  await fill('#cdT2', T2min4.toFixed(6));
  const d4 = await D();
  t.near('CD-4 e^(μθ) 3.00', d4.tensions.ef, 3.00); t.near('CD-4 T₂,min 11.3 N', d4.tensions.T2min, 11.3); t.near('CD-4 T₁ 33.8 N', d4.tensions.T1, 33.8); t.near('CD-4 R 44.0 N', d4.side.R, 44.0);

  console.log('CD-9: tension below the minimum');
  await fill('#cdWrap', 180);
  await page.click('#shTab_requirements');
  await page.click('#cdAddReq');
  await page.selectOption('#cdReqEd tr:last-child select[data-f="qty"]', 'slip');
  await fill('#cdReqEd tr:last-child input[data-f="target"]', 1);
  await fill('#cdT2', 10);
  t.ok('CD-9 slip margin under 1 and the requirement fails', (await page.textContent('#cdReqEd tr:last-child .st')) === 'fail' && (await page.textContent('#cdReqEd tr:last-child .val')).startsWith('0.694'));
  t.ok('CD-9 the drawing marks the drive pulley', (await page.textContent('#cdSvg')).includes('belt will slip'));
  t.ok('CD-9 the right column warns', (await page.textContent('#shResultsBody')).includes('The belt will slip'));

  console.log('CD-5 and CD-6: motor, ratio and the speed requirement');
  await t.fresh();
  await page.click('#cdExReq');
  await fill('#cdEta', 0.9);
  await page.selectOption('#cdRM', 'hand');
  await fill('#cdRatio', 3.14);
  await page.click('#shTab_design');
  s = await step('motor');
  t.ok('CD-5 loaded pulley speed 84.1 rpm (84.0 with the table\'s rounded load), belt 0.264 m/s', s['Motor / pulley speed'].endsWith('/ 84.1 rpm') && s['Loaded belt speed'] === '0.264 m/s');
  t.ok('CD-5 speed error −11.9% (ERRATA: −12.0% with the rounded values)', s['Speed error against 0.300 m/s'] === '−11.9%');
  t.ok('CD-5 speed requirement 0.3 m/s ± 10% fails', (await page.textContent('#cdReqSide')).includes('R1 Belt speed 0.300 m/s ±10.0%fail'));
  t.ok('the Motor step shows the failure in the strip', (await page.textContent('#cdStrip')).includes('Motor and ratio ✗'));
  await page.selectOption('#cdRM', 'solver');
  s = await step('motor');
  t.ok('CD-6 i_high 2.70, belt speed 0.300 m/s', s['Ratio used'].startsWith('2.70') && s['Loaded belt speed'] === '0.300 m/s');
  t.ok('CD-6 the speed requirement passes', (await page.textContent('#cdReqSide')).includes('R1 Belt speed 0.300 m/s ±10.0%pass'));
  t.ok('the motor plot shows the operating point', (await page.textContent('#cdStep_motor')).includes('% of stall'));
  await fill('#cdTs', 0.5);
  t.ok('a motor too weak for the target: explained, not an error', (await page.textContent('#cdStep_motor')).includes('No ratio reaches the target speed') && (await page.textContent('#cdReqSide')).includes('not defined'));
  await kit.noBadNumbers(t, 'no feasible ratio');

  console.log('Requirements editor');
  await t.fresh();
  t.ok('starts empty', (await page.textContent('#cdReqEd')).includes('No requirements yet'));
  await page.click('#cdAddReq');
  t.ok('Add requirement focuses its description', await page.evaluate(() => document.activeElement.dataset.f === 'desc'));
  await page.keyboard.type('Fast enough');
  await fill('#cdReqEd tr:last-child input[data-f="target"]', 0.3);
  t.ok('target ± tolerance against the belt speed: pass', (await page.textContent('#cdReqEd tr:last-child .st')) === 'pass');
  await page.selectOption('#cdReqEd tr:last-child select[data-f="cmp"]', 'atLeast');
  await fill('#cdReqEd tr:last-child input[data-f="target"]', 0.5);
  t.ok('at least 0.5 m/s: fail', (await page.textContent('#cdReqEd tr:last-child .st')) === 'fail');
  await fill('#cdReqEd tr:last-child input[data-f="target"]', 'abc');
  t.ok('a bad target is marked and ignored', (await page.getAttribute('#cdReqEd tr:last-child input[data-f="target"]', 'aria-invalid')) === 'true');
  await page.click('#cdExReq');
  t.ok('example requirements are added with the next IDs (R2 to R7)', (await page.textContent('#cdReqEd')).includes('R7') && (await page.textContent('#cdReqSide')).includes('R7 Guards on both nip points'));
  await page.click('#cdReqEd [data-rm="1"]');
  t.ok('a requirement can be removed', !(await page.textContent('#cdReqEd')).includes('Fast enough'));
  await page.waitForTimeout(400);                     // the autosave runs 250 ms after a change
  await page.reload(); await page.waitForFunction(() => !!window.__app);
  t.ok('requirements are saved with the design', (await page.textContent('#cdReqSide')).includes('R7 Guards on both nip points') && !(await page.textContent('#cdReqSide')).includes('R1 '));

  console.log('Steps: collapsible, keyboard and the step strip');
  await page.click('#shTab_design');
  t.ok('Design tab hides the no-requirements banner once rows exist', !(await page.isVisible('#cdNoReq')));
  await page.focus('#cdStep_pull summary'); await page.keyboard.press('Enter');
  t.ok('Enter on a step heading closes it', !(await page.evaluate(() => document.getElementById('cdStep_pull').open)));
  await fill('#cdMBox', 1.2);
  t.ok('a closed step stays closed after an update', !(await page.evaluate(() => document.getElementById('cdStep_pull').open)));
  await page.click('#cdStrip [data-goto="pull"]');
  t.ok('the step strip opens a step and moves focus to it', await page.evaluate(() => document.getElementById('cdStep_pull').open && document.activeElement.closest('#cdStep_pull') !== null));

  console.log('Predict first: one Check per design step');
  await t.fresh();
  await page.click('#shTab_design');
  await page.click('#shPredict');
  t.ok('every step\'s answers are hidden', (await step('pull'))['Belt pull Te'] === '?' && (await step('tensions'))['T2,min'] === '?' && (await step('shaft'))['Side load R'].startsWith('?'));
  t.ok('five Check buttons, one per step', await page.locator('#shPfBox [data-check]').count() === 5);
  await fill('#shPf_Te', 22);
  await page.click('#shPfBox [data-check="pull"]');
  t.ok('checking the belt pull reveals that step only', (await step('pull'))['Belt pull Te'] === '22.6 N' && (await step('power'))['Belt power P = Te v'] === '?');
  t.ok('the side view reveals T_e but not v', (await page.textContent('#cdSvg')).includes('= 22.6 N · v = ?'));
  t.ok('that step\'s working shows; later ones stay hidden', await page.evaluate(() => { const b = document.getElementById('shWorkingBody').textContent; return b.includes('T_e = μ g (m′_b + m′_p) L + m′_p g H') && b.includes('Hidden until you check'); }));
  t.ok('the log records the step\'s prediction', await page.evaluate(() => window.__app.log.slice(-1)[0].quantity === 'belt pull T_e'));

  console.log('Boxes move at the belt speed');
  await t.fresh();
  await page.evaluate(() => Anim.manual(true));
  const p0 = await page.evaluate(() => window.__cd.phase());
  await page.evaluate(() => Anim.advanceAll(1));
  t.near('one second moves the boxes 0.300 m', (await page.evaluate(() => window.__cd.phase())) - p0, 0.300);
  await page.evaluate(() => Anim.manual(false));

  console.log('Design record (acceptance)');
  await t.fresh();
  await page.click('#cdExReq');
  await page.click('#shTab_record');
  t.ok('the record tab previews the requirements', (await page.textContent('#cdTabRec')).includes('R1') && (await page.textContent('#cdTabRec')).includes('letter paper'));
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('#cdPrint');
  const rep = await page.evaluate(() => { const r = document.getElementById('sh-report'); return { text: r.textContent, h2: [...r.querySelectorAll('h2')].map(h => h.textContent), cells: [...r.querySelectorAll('table')].slice(2, 4).flatMap(tb => [...tb.querySelectorAll('td')].map(td => td.textContent)) }; });
  t.ok('Print the design record prints', await page.evaluate(() => window.__printed === 1));
  t.ok('the requirements table comes first, then inputs, results, the working, then sources', rep.h2[0] === 'Requirements' && rep.h2.indexOf('Inputs') > 0 && rep.h2.indexOf('Show the working') > rep.h2.indexOf('Results') && rep.h2[rep.h2.length - 1] === 'Sources', rep.h2.join(' | '));
  t.ok('the working is grouped by design step, in order', ['Load and belt pull', 'Power', 'Drive pulley', 'Motor and ratio', 'Tensions and slip', 'Pulley shaft and bearings'].every((hd, i, a) => rep.text.indexOf(hd) >= 0 && (i === 0 || rep.text.indexOf(hd) > rep.text.indexOf(a[i - 1]))));
  const unitless = rep.cells.filter(c => /\d/.test(c) && !/[A-Za-zµμ%°]/.test(c));
  t.ok('every number in the inputs and results carries a unit (or says it has none)', unitless.length === 0, unitless.join(' | '));
  const pdf = await page.pdf({ format: 'Letter' });
  t.ok('the record renders as a letter-size PDF', pdf.length > 10000 && /\/MediaBox \[0 0 612 792\]/.test(pdf.toString('latin1')));

  console.log('Drive files and the Motor and Drive Matcher round trip');
  await t.fresh();
  await fill('#cdEta', 0.9);
  const req = await kit.download(t, () => page.click('#cdExpDrive'));
  const rq = JSON.parse(req.buf.toString('utf8'));
  t.ok('drive request: T_p, N_p, the solver ratio and the motor', rq.schema === 'drive-request' && Math.abs(rq.loadTorque - 0.677) < 0.001 && Math.abs(rq.targetSpeed - 95.49) < 0.01 && Math.abs(rq.stages[0].ratio - 2.70) < 0.01 && rq.motor.stallTorque === 2);
  const gear = await kit.download(t, () => page.click('#cdExpGear'));
  t.ok('the Gear Train button saves the same request and explains', JSON.parse(gear.buf.toString('utf8')).schema === 'drive-request' && (await page.textContent('#shToast')).includes('after its planned upgrade'));
  const mdm = path.resolve(root, '..', 'MotorDriveMatcher');
  if (fs.existsSync(path.join(mdm, 'index.html'))) {
    const m = await kit.start(mdm);
    await m.fresh();
    await m.page.setInputFiles('#shFile', tmp('req.json', req.buf.toString('utf8')));
    await m.page.waitForTimeout(300);
    t.ok('the Matcher reads the request', Math.abs(parseFloat(await m.page.inputValue('#mdTL')) - 0.677) < 0.001);
    const res = await kit.download(m, () => m.page.click('#mdExport'));
    await m.close();
    await page.setInputFiles('#shFile', tmp('res.json', res.buf.toString('utf8')));
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => window.__app.state);
    t.ok('its drive result loads back: motor, your ratio 2.70 and η 0.9', st.ratioMode === 'hand' && Math.abs(st.ratio - 2.70) < 0.01 && st.Ts === 2 && st.N0 === 300 && st.eta === 0.9, JSON.stringify([st.ratioMode, st.ratio, st.Ts, st.N0, st.eta]));
    t.ok('the round trip still meets the target speed', Math.abs((await D()).drive.vBelt - 0.3) < 0.001);
  } else console.log('  SKIP MotorDriveMatcher is not checked out next to this repo');

  console.log('CD-10 in the Shaft and Beam Workbench');
  const sbw = path.resolve(root, '..', 'ShaftBeamWorkbench');
  if (fs.existsSync(path.join(sbw, 'index.html'))) {
    const w = await kit.start(sbw);
    await w.fresh();
    await w.page.fill('#sbL', '100'); await w.page.fill('#sbD', '8');
    await w.page.click('#sbImp');
    await w.page.setInputFiles('#shFile', tmp('shaft.json', shaftFile.buf.toString('utf8')));
    await w.page.waitForSelector('#sbImport[open]');
    t.ok('the Workbench offers the centre of the 100 mm span', (await w.page.inputValue('#sbImpPos0')) === '50');
    await w.page.click('#sbImpGo');
    const r = await w.page.textContent('#shResultsBody');
    t.ok('CD-10 the Workbench readouts match CD-7: M 1.28 N·m, τ_max 14.4 MPa, n 13.8, reactions 25.7 N', ['1.28 N·m', '14.4 MPa', '13.8', '25.7 N / 25.7 N'].every(v => r.includes(v)), r.slice(0, 300));
    t.ok('no errors in the Workbench', w.errors.length === 0, w.errors.join(' | '));
    await w.close();
  } else console.log('  SKIP ShaftBeamWorkbench is not checked out next to this repo');

  console.log('Screenshots and performance');
  await t.fresh();
  await page.click('#cdExReq'); await page.click('#shTab_design');
  await page.screenshot({ path: path.join(shots, 'conveyor-designer-design.png') });
  const ms = await kit.timeIt(page, 'window.__app.changed()', 15);
  t.ok('a full update takes under 50 ms (' + ms.toFixed(1) + ' ms)', ms < 50);
  fs.writeFileSync(path.join(shots, 'perf.txt'), 'Full update (change + render), median of 15: ' + ms.toFixed(1) + ' ms\n');

  await t.finish();
})().catch(e => { console.error(e); process.exit(1); });
