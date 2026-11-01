// ecosystem/tooling/verify-blocks.js v1.0.0
// Checks that the code inlined in a tool's index.html is byte-for-byte the code
// that the tests run: every `/* BEGIN vendor:<file> */ … /* END vendor:<file> */`
// block must equal dev/vendor/<file>, and the `/* BEGIN core */ … /* END core */`
// block must equal dev/core.js. Used by each tool's dev/verify-html.js.
'use strict';
const fs = require('fs');
const path = require('path');

const BEGIN = /\/\* BEGIN (vendor:[\w.-]+|core) \*\/\n/g;

function blocks(html) {
  const out = [];
  let m;
  BEGIN.lastIndex = 0;
  while ((m = BEGIN.exec(html))) {
    const name = m[1];
    const start = m.index + m[0].length;
    const endTag = '/* END ' + name + ' */';
    const end = html.indexOf(endTag, start);
    if (end < 0) throw new Error('no END marker for ' + name);
    out.push({ name, text: html.slice(start, end), start, end });
  }
  return out;
}
function extract(html, name) {
  const b = blocks(html).find(x => x.name === name);
  if (!b) throw new Error('block ' + name + ' not found in index.html');
  return b.text;
}

// Returns a list of problems (empty when everything matches).
function verify(repoRoot) {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const dev = path.join(repoRoot, 'dev');
  const problems = [];
  const found = blocks(html);
  for (const b of found) {
    const file = b.name === 'core' ? path.join(dev, 'core.js') : path.join(dev, 'vendor', b.name.slice(7));
    if (!fs.existsSync(file)) { problems.push(b.name + ': ' + path.relative(repoRoot, file) + ' does not exist'); continue; }
    const want = fs.readFileSync(file, 'utf8');
    if (want !== b.text) {
      const a = want.split('\n'), c = b.text.split('\n');
      let i = 0; while (i < a.length && a[i] === c[i]) i++;
      problems.push(b.name + ': index.html differs from ' + path.relative(repoRoot, file) + ' at line ' + (i + 1) + ' of the block');
    }
  }
  if (!found.some(b => b.name === 'core')) problems.push('core: no /* BEGIN core */ block in index.html');
  const vendorDir = path.join(dev, 'vendor');
  if (fs.existsSync(vendorDir)) {
    for (const f of fs.readdirSync(vendorDir)) {
      if (f === 'verify-blocks.js' || f === 'e2e-kit.js' || f === 'VENDORED.md' || !/\.(js|css)$/.test(f)) continue;
      if (!found.some(b => b.name === 'vendor:' + f)) problems.push('vendor:' + f + ' is in dev/vendor but not inlined in index.html');
    }
  }
  return problems;
}

// Copy dev/core.js into the core block of index.html. Returns true if it changed.
function syncCore(repoRoot) {
  const htmlPath = path.join(repoRoot, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const core = fs.readFileSync(path.join(repoRoot, 'dev', 'core.js'), 'utf8');
  const b = '/* BEGIN core */\n', e = '/* END core */';
  const i = html.indexOf(b), j = html.indexOf(e, i);
  if (i < 0 || j < 0) throw new Error('index.html has no core block');
  if (html.slice(i + b.length, j) === core) return false;
  fs.writeFileSync(htmlPath, html.slice(0, i + b.length) + core + html.slice(j));
  return true;
}

// Evaluate the inline core block in a fresh function scope and return what it exports
// (the block assigns module.exports when `module` exists).
function loadInline(repoRoot, name, globals) {
  const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const src = extract(html, name);
  const mod = { exports: {} };
  const names = Object.keys(globals || {});
  new Function('module', 'exports', 'require', ...names, src)(mod, mod.exports, require, ...names.map(n => globals[n]));
  return mod.exports;
}

module.exports = { blocks, extract, verify, loadInline, syncCore };
