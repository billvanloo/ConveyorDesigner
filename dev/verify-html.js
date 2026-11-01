// Confirms the code inlined in index.html is exactly the tested code, then runs
// spec cases on the inline copy. Run: node dev/verify-html.js   (--fix copies dev/core.js in)
'use strict';
const path = require('path');
const vb = require('./vendor/verify-blocks.js');
const root = path.join(__dirname, '..');
if (process.argv.includes('--fix') && vb.syncCore(root)) console.log('Copied dev/core.js into index.html.');
let passed = 0, failed = 0;
const ok = (n, c, d) => { if (c) { passed++; console.log('  PASS ' + n); } else { failed++; console.log('  FAIL ' + n + (d ? ': ' + d : '')); } };
const near = (n, g, e) => ok(n, typeof g === 'number' && (Math.abs(e) < 1 ? Math.abs(g - e) <= 0.01 : Math.abs(g - e) / Math.abs(e) <= 0.005), 'got ' + g + ', expected ' + e);

console.log('Inline blocks match dev/core.js and dev/vendor/');
const problems = vb.verify(root);
problems.forEach(p => ok(p, false));
ok('every inline block matches its tested copy', problems.length === 0);

console.log('Inline copy runs the spec cases');
const MotorCore = vb.loadInline(root, 'vendor:motor-core.js');
const BeamCore = vb.loadInline(root, 'vendor:beam-core.js');
const C = vb.loadInline(root, 'core', { MotorCore, BeamCore });
const d = C.design(C.defaultState());
near('CD-1 T_e (inline, default state)', d.pull.Te, 22.6);
near('CD-1 N_p (inline)', d.pulley.Np, 95.5);
near('CD-7 n with the default 1.3 × T₂,min (inline)', d.shaft.n, 12.2);
near('CD-6 ratio at η = 0.9 (inline)', C.design(Object.assign(C.defaultState(), { eta: 0.9 })).drive.i, 2.70);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
