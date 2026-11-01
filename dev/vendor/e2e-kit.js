// ecosystem/tooling/e2e-kit.js v1.2.0
// Playwright helpers shared by every tool's dev/e2e.js: a static server on the
// repo root, a browser page that records console errors, and the standard
// checks every tool must pass (spec 00 and the per-tool definition of done).
//
// Needs Playwright, which is not a project dependency. Once, from the repo root:
//   npm i --no-save playwright && npx playwright install chromium
// Or set CHROMIUM_PATH to an installed Chromium. If neither works, the kit looks
// for a Chromium that Playwright downloaded earlier in ~/.cache/ms-playwright.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { }
  try { return require(path.join(process.cwd(), 'node_modules', 'playwright')); } catch (e) { }
  console.error('Playwright not found. From the repo root, once: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}
function cachedChromium() {
  const dir = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(dir)) return null;
  const cands = fs.readdirSync(dir).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
  for (const d of cands) {
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const p = path.join(dir, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
async function launch() {
  const { chromium } = loadPlaywright();
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try { return await chromium.launch(); }
  catch (e) {
    const p = cachedChromium();
    if (!p) throw e;
    return chromium.launch({ executablePath: p });
  }
}

function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    // A same-origin page with no scripts, so storage can be cleared with no tool timers alive.
    if (req.url === '/__blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>blank</title><link rel="icon" href="data:,">'); }
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// opts: { page: the tool's page relative to root (default 'index.html'),
//         query: added to the page URL on every open (default '') }
async function start(root, opts) {
  root = path.resolve(root);
  opts = opts || {};
  const pagePath = opts.page || 'index.html', query = opts.query || '';
  const server = await serve(root);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, colorScheme: 'light' });
  const page = await context.newPage();
  const t = { root, base, server, browser, context, page, pagePath, query, errors: [], passed: 0, failed: 0, fails: [] };
  const watch = p => {
    p.on('console', m => { if (m.type() === 'error') t.errors.push(m.text()); });
    p.on('pageerror', e => t.errors.push(String(e)));
  };
  watch(page);
  t.watch = watch;
  t.ok = (name, cond, detail) => {
    if (cond) { t.passed++; console.log('  PASS ' + name); }
    else { t.failed++; t.fails.push(name); console.log('  FAIL ' + name + (detail !== undefined ? ': ' + detail : '')); }
  };
  t.near = (name, got, exp) => {
    const good = typeof got === 'number' && isFinite(got) && (Math.abs(exp) < 1 ? Math.abs(got - exp) <= 0.01 : Math.abs(got - exp) / Math.abs(exp) <= 0.005);
    t.ok(name, good, 'got ' + got + ', expected ' + exp);
  };
  t.open = async (q) => { await page.goto(base + '/' + pagePath + (q === undefined ? query : q)); await page.waitForFunction(() => !!window.__app); };
  // Start clean: leave the tool first so a pending autosave cannot write old state back.
  t.fresh = async () => {
    await page.goto(base + '/__blank');
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
    await t.open();
  };
  t.close = async () => { await browser.close(); server.close(); };
  t.finish = async () => {
    t.ok('no console errors during the run', t.errors.length === 0, t.errors.slice(0, 5).join(' | '));
    await t.close();
    console.log('\n' + t.passed + ' passed, ' + t.failed + ' failed');
    if (t.failed) console.log('Failed: ' + t.fails.join('; '));
    process.exitCode = t.failed ? 1 : 0;
  };
  return t;
}

/* ------------------------------------------------------------------ probes */
// Visible text (skipping script/style) plus input values, for NaN checks.
async function pageText(page) {
  return page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    while (w.nextNode()) out.push(w.currentNode.nodeValue);
    document.querySelectorAll('input').forEach(i => out.push(i.value));
    return out.join(' ');
  });
}
async function noBadNumbers(t, label) {
  const txt = await pageText(t.page);
  const bad = txt.match(/\bNaN\b|Infinity|undefined|\bnull\b/);
  t.ok('no NaN, Infinity or undefined shown (' + label + ')', !bad, bad && txt.slice(Math.max(0, bad.index - 60), bad.index + 40));
}
function pngSize(buf) { return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; }
async function download(t, click) {
  const [d] = await Promise.all([t.page.waitForEvent('download'), click()]);
  const p = await d.path();
  return { name: d.suggestedFilename(), buf: fs.readFileSync(p) };
}

/* ------------------------------------------------------------------ standard checks */
// opts:
//   change(page)       make one input change (used to check that results re-hide)
//   mutate(page)       change the design so a load can be seen to restore it
//   predictKeys        keys of the predict-first targets
//   drawing            selector of the main drawing (default '#shStage svg')
//   shotDir            where to write screenshots
//   shotName           base name for screenshots
//   teacherTool        true for a tool with no Name field and no predict first (the
//                      Collector): those checks are skipped, and the header must not show them
async function standard(t, opts) {
  const { page } = t;
  opts = Object.assign({ drawing: '#shStage svg', shotName: 'tool' }, opts);

  console.log('Standard: page and drawing');
  await t.fresh();
  t.ok('drawing is present', await page.locator(opts.drawing).count() > 0);
  await noBadNumbers(t, 'default state');
  const teacher = !!opts.teacherTool;
  t.ok('header has the required buttons', await page.evaluate(ids => ids.every(id => { const e = document.getElementById(id); return e && !e.hidden; }),
    teacher ? ['shPng', 'shReport', 'shSave', 'shLoad', 'shHelp', 'shTheme'] : ['shName', 'shPng', 'shReport', 'shSave', 'shLoad', 'shHelp', 'shTheme', 'shPredict']));
  if (teacher) t.ok('teacher tool hides Name, Predict first and Log', await page.evaluate(() => document.getElementById('shNameWrap').hidden && document.getElementById('shPredict').hidden && document.getElementById('shLog').hidden));
  t.ok('footer has the attribution links', await page.evaluate(() => {
    const f = document.querySelector('footer').textContent;
    return ['Designed by', 'Report a bug', 'Request a feature', 'Ko-fi', 'MIT License', 'View source'].every(s => f.includes(s));
  }));
  t.ok('drawing has a live text description', await page.evaluate(() => { const d = document.getElementById('shDesc'); return d.getAttribute('aria-live') === 'polite'; }));
  await page.waitForTimeout(600);
  t.ok('drawing description is filled in', (await page.textContent('#shDesc')).trim().length > 20);

  console.log('Standard: theme');
  const th0 = await page.getAttribute('html', 'data-theme');
  await page.click('#shTheme');
  const th1 = await page.getAttribute('html', 'data-theme');
  t.ok('theme button switches theme', th0 !== th1 && (th1 === 'dark' || th1 === 'light'));
  await page.reload(); await page.waitForFunction(() => !!window.__app);
  t.ok('theme is remembered after reload', (await page.getAttribute('html', 'data-theme')) === th1);
  if (opts.shotDir) {
    fs.mkdirSync(opts.shotDir, { recursive: true });
    const dark = th1 === 'dark';
    await page.screenshot({ path: path.join(opts.shotDir, opts.shotName + (dark ? '-dark' : '-light') + '.png') });
    await page.click('#shTheme');
    await page.screenshot({ path: path.join(opts.shotDir, opts.shotName + (dark ? '-light' : '-dark') + '.png') });
  }
  await t.fresh();

  console.log('Standard: help');
  await page.focus('body'); await page.keyboard.press('?');
  t.ok('? opens help', await page.evaluate(() => document.getElementById('shHelpDlg').open));
  t.ok('help has sources and teacher notes', await page.evaluate(() => { const b = document.getElementById('shHelpDlg').textContent; return b.includes('Sources') && b.includes('Teacher notes'); }));
  await page.keyboard.press('Escape');
  t.ok('Esc closes help', await page.evaluate(() => !document.getElementById('shHelpDlg').open));

  if (!teacher) {
  console.log('Standard: predict first');
  await page.click('#shPredict');
  t.ok('predict-first box appears', await page.isVisible('#shPfBox'));
  t.ok('results show blanks, not values', await page.locator('#shResultsBody .masked').count() > 0);
  t.ok('working is hidden', (await page.textContent('#shWorkingBody')).includes('Hidden until you check'));
  for (const k of opts.predictKeys || []) t.ok('prediction field for ' + k, await page.locator('#shPf_' + k).count() === 1);
  const n0 = await page.evaluate(() => window.__app.log.length);
  const first = (opts.predictKeys || [])[0];
  // Tools with one Check per step (predict groups): work with the first key's group.
  const grp = first ? await page.getAttribute('#shPf_' + first, 'data-group') || '' : '';
  const checkSel = '#shPfBox [data-check="' + grp + '"]', againSel = '#shPfBox [data-again="' + grp + '"]';
  const checkAll = async () => { while (await page.locator('#shPfBox [data-check]').count()) await page.locator('#shPfBox [data-check]').first().click(); };
  if (first) await page.fill('#shPf_' + first, '1');
  await checkAll();
  t.ok('Check reveals the results', await page.locator('#shResultsBody .masked').count() === 0);
  t.ok('Check shows the "You predicted" message', (await page.textContent('#shPfBox')).includes('You predicted'));
  t.ok('Check writes a log record', await page.evaluate(() => window.__app.log.length) === n0 + 1);
  await noBadNumbers(t, 'after Check');
  if (opts.change) {
    await opts.change(page);
    t.ok('changing an input hides the results again', await page.locator('#shResultsBody .masked').count() > 0);
    if (first) t.ok('changing an input clears the prediction fields', (await page.inputValue('#shPf_' + first)) === '');
  }
  if (first) {
    await page.fill('#shPf_' + first, '1'); await page.click(checkSel);
    await page.click(againSel);
    await page.fill('#shPf_' + first, '2'); await page.click(checkSel);
    const attempts = await page.evaluate(k => window.__app.log.filter(r => r.quantity === window.__app.log[window.__app.log.length - 1].quantity).map(r => r.attempt), first);
    t.ok('Predict again on the same problem counts a new attempt', attempts[attempts.length - 1] === attempts[attempts.length - 2] + 1, JSON.stringify(attempts));
    await page.click(againSel);
    await page.fill('#shPf_' + first, '3');
    await page.press('#shPf_' + first, 'Enter');
    t.ok('Enter in a prediction box checks it and the results stay shown', await page.evaluate(g => !window.__app.masked(g), grp) && await page.locator(againSel).count() === 1);
  }
  await page.click('#shPredict');

  console.log('Standard: prediction log export');
  await page.click('#shLog');
  const csv = await download(t, () => page.click('#shLogCsv'));
  t.ok('log CSV file name pattern', /^unnamed_[a-z0-9-]+_prediction-log_\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), csv.name);
  t.ok('log CSV has a byte order mark and header', csv.buf[0] === 0xEF && csv.buf.toString('utf8').includes('schema,schemaVersion,tool'));
  const js = await download(t, () => page.click('#shLogJson'));
  t.ok('log JSON is a prediction-log file', JSON.parse(js.buf.toString('utf8')).schema === 'prediction-log');
  await page.keyboard.press('Escape');
  }

  console.log('Standard: save and load');
  if (!teacher) await page.fill('#shName', 'Test Student');
  const who = teacher ? '[A-Za-z0-9-]+' : 'Test-Student';
  const saved = await download(t, () => page.click('#shSave'));
  const file = JSON.parse(saved.buf.toString('utf8'));
  t.ok('save file name pattern', new RegExp('^' + who + '_[a-z0-9-]+_[A-Za-z0-9-]+_\\d{4}-\\d{2}-\\d{2}\\.json$').test(saved.name), saved.name);
  t.ok('save file has tool, versions, date and state', ['tool', 'toolVersion', 'schemaVersion', 'savedAt', 'state'].every(k => k in file));
  const before = await page.evaluate(() => JSON.stringify(window.__app.state));
  if (opts.mutate) await opts.mutate(page);
  const mid = await page.evaluate(() => JSON.stringify(window.__app.state));
  t.ok('design changed before loading', mid !== before);
  const tmp = path.join(os.tmpdir(), 'ebtn-e2e-' + process.pid + '.json');
  fs.writeFileSync(tmp, saved.buf);
  await page.setInputFiles('#shFile', tmp);
  await page.waitForFunction(b => JSON.stringify(window.__app.state) === b, before, { timeout: 3000 }).catch(() => { });
  t.ok('Load restores the saved design exactly', (await page.evaluate(() => JSON.stringify(window.__app.state))) === before);
  fs.writeFileSync(tmp, '{"not":"a design"');
  await page.setInputFiles('#shFile', tmp);
  await page.waitForTimeout(150);
  t.ok('a broken file shows a message instead of failing', (await page.textContent('#shToast')).length > 10);
  fs.unlinkSync(tmp);

  console.log('Standard: export image');
  const png = await download(t, () => page.click('#shPng'));
  const sz = pngSize(png.buf);
  const dw = await page.evaluate(() => { const d = window.__app.withLight(() => window.__app.cfg.drawing(window.__app, { export: true })); return { w: d.width, h: d.height }; });
  t.ok('PNG is 2× the drawing with a caption strip', sz.width === dw.w * 2 && sz.height === (dw.h + 40) * 2, JSON.stringify(sz) + ' vs ' + JSON.stringify(dw));
  t.ok('PNG file name pattern', new RegExp('^' + who + '_[a-z0-9-]+_[A-Za-z0-9-]+_\\d{4}-\\d{2}-\\d{2}\\.png$').test(png.name), png.name);

  console.log('Standard: report');
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('#shReport');
  const rep = await page.evaluate(() => ({ printed: window.__printed, text: document.getElementById('sh-report').textContent, svg: !!document.querySelector('#sh-report svg') }));
  t.ok('Report prints', rep.printed === 1);
  t.ok('Report has the drawing', rep.svg);
  t.ok('Report has inputs, results, working, predictions and sources', (teacher ? ['Inputs', 'Results', 'Show the working', 'Sources'] : ['Inputs', 'Results', 'Show the working', 'Prediction history', 'Sources', 'Test Student']).every(s => rep.text.includes(s)));
  if (teacher) t.ok('teacher tool report has no prediction history or signature line', !rep.text.includes('Prediction history') && !rep.text.includes('Student signature'));
  t.ok('Report shows no NaN or Infinity', !/\bNaN\b|Infinity|undefined/.test(rep.text));

  console.log('Standard: settings and Clear my data');
  await page.click('#shSettings');
  await page.selectOption('#shSig', '4');
  t.ok('4 significant figures setting applies', await page.evaluate(() => window.__app.settings.sig === 4));
  await page.selectOption('#shSig', '3');
  await page.click('#shClear'); await page.click('#shClear');
  t.ok('Clear my data empties name and log', await page.evaluate(() => window.__app.log.length === 0 && document.getElementById('shName').value === '' && !Object.keys(localStorage).some(k => k.startsWith('ebtn:' + window.__app.cfg.slug + ':log'))));
  await page.waitForFunction(() => !document.getElementById('shSettingsDlg').open).catch(() => { });

  console.log('Standard: small screen');
  await page.setViewportSize({ width: 700, height: 900 });
  t.ok('small-screen notice shows below 768 px', await page.isVisible('#shSmall'));
  await noBadNumbers(t, 'small screen');
  await page.setViewportSize({ width: 1280, height: 800 });
  t.ok('small-screen notice hidden at 1280 px', !(await page.isVisible('#shSmall')));

  console.log('Standard: opened from disk');
  const p2 = await t.context.newPage();
  const errs = [], net = [];
  p2.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p2.on('pageerror', e => errs.push(String(e)));
  p2.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) net.push(r.url()); });
  await p2.goto('file://' + path.join(t.root, t.pagePath) + t.query);
  await p2.waitForFunction(() => !!window.__app);
  t.ok('works from file:// with no console errors', errs.length === 0, errs.join(' | '));
  t.ok('makes no network requests', net.length === 0, net.join(' '));
  await p2.close();
}

// Median of several timings of fn() in the page, in ms.
async function timeIt(page, fnSrc, runs) {
  return page.evaluate(({ src, n }) => {
    const fn = new Function(src); const ts = [];
    for (let i = 0; i < n; i++) { const a = performance.now(); fn(); ts.push(performance.now() - a); }
    ts.sort((x, y) => x - y); return ts[Math.floor(ts.length / 2)];
  }, { src: fnSrc, n: runs || 15 });
}

module.exports = { start, standard, noBadNumbers, pageText, download, pngSize, timeIt, launch };
