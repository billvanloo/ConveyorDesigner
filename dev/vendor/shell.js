// ecosystem/shell/shell.js v1.2.2
// Shared tool frame for the Engineered by the Numbers tools (spec 00 §2–8):
// header, footer, help, themes, small-screen notice, predict-first, show the
// working, field validation, save/load, PNG export, printable report, the
// prediction log store, settings and Clear my data. A tool supplies its
// inputs, calculation, drawing and readouts through the config passed to
// Shell.create(). Needs PredictionLog and Schemas defined first.
const Shell = (function () {
  'use strict';
  const req = (a, b) => { try { return require(a); } catch (e) { return require(b); } };
  const PL = typeof PredictionLog !== 'undefined' ? PredictionLog : req('./prediction-log.js', '../prediction-log.js');
  const SC = typeof Schemas !== 'undefined' ? Schemas : req('./schemas.js', '../schemas.js');

  /* =================================================================
     PURE HELPERS (unit-tested in Node)
     ================================================================= */
  const isNum = v => typeof v === 'number' && isFinite(v);
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

  // Significant-figure display (00 §3). Keeps trailing zeros ("4.10"), groups
  // thousands, uses a true minus sign, never prints NaN or Infinity.
  function fmtSig(v, sig) {
    sig = sig || 3;
    if (!isNum(v)) return '—';
    if (v === 0 || Object.is(v, -0)) return '0';
    const a = Math.abs(v);
    let s;
    if (a >= 1e7 || a < 1e-4) {
      const [m, e] = v.toExponential(sig - 1).split('e');
      s = m + ' × 10' + String(Number(e)).split('').map(c => SUP[c] || c).join('');
    } else {
      // Round first so 99.96 at 3 s.f. becomes 100 (not "100.0").
      const r = Number(v.toPrecision(sig));
      const digitsBefore = Math.floor(Math.log10(Math.abs(r))) + 1;
      const decimals = Math.max(0, sig - digitsBefore);
      s = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      if (r < 0) s = '-' + s;
    }
    return s.replace(/^-/, '−');
  }
  // Plain number for an input box: up to 6 significant figures, no grouping.
  function fmtInput(v) { return isNum(v) ? String(Number(v.toPrecision(6))) : ''; }
  function fmtPct(p, sig) {
    if (!isNum(p)) return 'not defined';
    return (p > 0 ? '+' : '') + fmtSig(p, sig) + '%';
  }

  // Accepts "1,000", "1 000", "−3", ".5". Returns NaN for anything else.
  function parseNumber(str) {
    if (typeof str === 'number') return str;
    const s = String(str == null ? '' : str).trim().replace(/[−–]/g, '-').replace(/(\d)[,\s](?=\d{3}(\D|$))/g, '$1');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }

  // Field validation (00 §8). spec: { name, unit, min, max, gt (exclusive lower bound),
  // integer, check(v) -> message|null }. Returns { value, error }.
  function validateNumber(raw, spec) {
    const name = spec.name || 'This value';
    const u = spec.unit ? ' ' + spec.unit : '';
    if (String(raw == null ? '' : raw).trim() === '') return { value: NaN, error: 'Enter a value for ' + lc(name) + '.' };
    const v = parseNumber(raw);
    if (!isNum(v)) return { value: NaN, error: name + ' must be a number.' };
    if (spec.integer && Math.round(v) !== v) return { value: v, error: name + ' must be a whole number.' };
    if (spec.gt !== undefined && !(v > spec.gt)) return { value: v, error: name + ' must be greater than ' + spec.gt + u + '.' };
    if (spec.min !== undefined && spec.max !== undefined && (v < spec.min || v > spec.max)) return { value: v, error: name + ' must be between ' + fmtBound(spec.min) + ' and ' + fmtBound(spec.max) + u + '.' };
    if (spec.min !== undefined && v < spec.min) return { value: v, error: name + ' must be at least ' + fmtBound(spec.min) + u + '.' };
    if (spec.max !== undefined && v > spec.max) return { value: v, error: name + ' must be at most ' + fmtBound(spec.max) + u + '.' };
    if (spec.check) { const m = spec.check(v); if (m) return { value: v, error: m }; }
    return { value: v, error: null };
  }
  const fmtBound = v => Math.abs(v) >= 10000 ? v.toLocaleString('en-US') : String(v);
  const lc = s => s.charAt(0).toLowerCase() + s.slice(1);

  // 00 §6: <name>_<tool>_<challenge or sandbox>_<YYYY-MM-DD>.<ext>
  function safePart(s) { return String(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, ''); }
  function exportName(o) {
    const base = [safePart(o.student) || 'unnamed', safePart(o.tool), safePart(o.context) || 'sandbox', o.dateISO].join('_');
    return o.ext ? base + '.' + o.ext : base;
  }
  function localDateISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // 00 §4.5 default bands: within 1% "Match", within 5% "Close".
  function verdictFor(pct, tol) {
    tol = tol || { match: 1, close: 5 };
    if (!isNum(pct)) return null;
    const a = Math.abs(pct);
    return a <= tol.match ? 'match' : a <= tol.close ? 'close' : 'off';
  }
  // Yes/no targets (kind: 'yesno') are logged as 1 for yes and 0 for no (QUESTIONS Q13).
  const yesNo = v => v === 1 ? 'yes' : v === 0 ? 'no' : 'not defined';
  function yesNoMessage(pred, model, reason) {
    if (model !== 0 && model !== 1) return 'You predicted ' + yesNo(pred) + '. The model answer is not defined' + (reason ? ': ' + reason : '') + '.';
    return 'You predicted ' + yesNo(pred) + '. The model says ' + yesNo(model) + '.';
  }
  function predictionMessage(pred, model, unit, sig, reason) {
    const u = unit ? ' ' + unit : '';
    if (!isNum(model)) return 'You predicted ' + fmtSig(pred, sig) + u + '. The model value is not defined' + (reason ? ': ' + reason : '') + '.';
    const pct = PL.pctDiff(pred, model);
    return 'You predicted ' + fmtSig(pred, sig) + u + '. The model gives ' + fmtSig(model, sig) + u +
      (pct === null ? ' (difference not defined: the model value is 0).' : ' (' + fmtPct(pct, sig) + ' difference).');
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Teacher challenge lists (00 §4.5–4.6). Accepts a JSON string, an object
  // { tool, schemaVersion, challenges: [...] } or a bare array of challenges.
  // Each challenge: { id, title, brief, inputs: {key: SI value}, hidden: [key],
  // tolerance: { match, close } (percent), requirePrediction, predictFirst }.
  // Returns { value: { challenges }, warnings }, or throws with a message for the teacher.
  const CHALLENGE_VERSION = 1;
  function readChallengeList(input, tool) {
    let obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { throw new Error('The challenge list is not valid JSON. Check for a missing comma, quote or bracket.'); }
    }
    if (Array.isArray(obj)) obj = { challenges: obj };
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.challenges)) throw new Error('A challenge list needs a "challenges" list.');
    if (obj.tool && tool && obj.tool !== tool) throw new Error('This challenge list is for the ' + obj.tool + ', not the ' + tool + '.');
    const warnings = [];
    if (isNum(obj.schemaVersion) && obj.schemaVersion > CHALLENGE_VERSION) warnings.push('This list was made for a newer tool version; some fields may be ignored.');
    const seen = new Set();
    const challenges = obj.challenges.map((c, i) => {
      const where = 'Challenge ' + (i + 1);
      if (!c || typeof c !== 'object') throw new Error(where + ' is not an object.');
      const id = typeof c.id === 'string' ? c.id.trim() : '';
      if (!id) throw new Error(where + ' needs an "id", for example "FS-1".');
      if (seen.has(id)) throw new Error('Two challenges have the id "' + id + '". Each id must be different.');
      seen.add(id);
      const inputs = c.inputs === undefined ? {} : c.inputs;
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error(id + ': "inputs" must be an object of input names and values.');
      for (const k in inputs) if (!isNum(inputs[k]) && typeof inputs[k] !== 'string' && typeof inputs[k] !== 'boolean') throw new Error(id + ': input "' + k + '" must be a number, text or true/false.');
      const hidden = c.hidden === undefined ? [] : c.hidden;
      if (!Array.isArray(hidden) || hidden.some(k => typeof k !== 'string')) throw new Error(id + ': "hidden" must be a list of input names.');
      let tolerance = null;
      if (c.tolerance !== undefined) {
        const t = c.tolerance;
        if (!t || !isNum(t.match) || !isNum(t.close) || t.match <= 0 || t.close < t.match) throw new Error(id + ': "tolerance" needs "match" and "close" percentages, with 0 < match ≤ close.');
        tolerance = { match: t.match, close: t.close };
      }
      return {
        id, title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : id,
        brief: typeof c.brief === 'string' ? c.brief : '',
        inputs, hidden, tolerance,
        requirePrediction: c.requirePrediction === true,
        predictFirst: c.predictFirst !== false,
        example: c.example === true,
      };
    });
    return { value: { challenges }, warnings };
  }

  const util = { fmtSig, fmtInput, fmtPct, parseNumber, validateNumber, exportName, safePart, localDateISO, verdictFor, predictionMessage, yesNoMessage, esc, readChallengeList };

  /* =================================================================
     BROWSER FRAME
     ================================================================= */
  const FEEDBACK = 'billvanloo.tech+feedback@gmail.com';

  function store(prefix) {
    return {
      get(k, dflt) { try { const s = localStorage.getItem(prefix + k); return s == null ? dflt : JSON.parse(s); } catch (e) { return dflt; } },
      set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
      del(k) { try { localStorage.removeItem(prefix + k); } catch (e) { } },
      clearAll() { try { Object.keys(localStorage).filter(k => k.indexOf(prefix) === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { } },
    };
  }
  function h(tag, attrs, html) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]); }
    if (html !== undefined) el.innerHTML = html;
    return el;
  }
  function download(filename, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = h('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { }
      ta.remove(); return ok;
    }
  }

  function create(cfg) {
    const S = store('ebtn:' + cfg.slug + ':');
    const G = store('ebtn-');                       // shared across tools on one site: name, theme
    const app = {
      cfg, util, PL, SC,
      state: null, el: {},
      settings: Object.assign({ sig: 3, team: '', classPeriod: '', predictFirst: false }, cfg.defaultSettings || {}, S.get('settings', {})),
      pf: { revealed: false, groups: {}, fields: {}, messages: [] },
      invalid: {}, fields: [], log: S.get('log', []),
      sessionStart: Date.now(), working: [],
    };

    /* ---------------- state ---------------- */
    const saved = S.get('state', null);
    app.state = cfg.defaultState();
    if (saved && saved.schemaVersion === cfg.schemaVersion && saved.state) {
      try { app.state = Object.assign(cfg.defaultState(), saved.state); } catch (e) { app.state = cfg.defaultState(); }
    }

    /* ---------------- skeleton ---------------- */
    const repoUrl = 'https://github.com/billvanloo/' + cfg.repo;
    const mail = kind => 'mailto:' + FEEDBACK + '?subject=' + encodeURIComponent('[' + cfg.repo + '] ' + kind);
    document.body.innerHTML = '';
    const header = h('header', { class: 'sh-header' },
      '<div class="titleblock"><span class="t1">' + esc(cfg.tool) + '</span><span class="t2">' + esc(cfg.subtitle || '') + '</span></div>' +
      '<div id="shModes"></div><div id="shTabs"></div>' +
      '<div class="chwrap" id="shChWrap" hidden><label for="shChallenge">Challenge</label><select id="shChallenge"></select></div>' +
      '<div class="spacer"></div>' +
      '<div class="namewrap" id="shNameWrap"><label for="shName">Name</label><input id="shName" maxlength="40" placeholder="Your name" autocomplete="name"></div>' +
      '<div class="hbtns">' +
      '<button id="shPredict" aria-pressed="false" title="Hide results until you enter and check a prediction">Predict first</button>' +
      '<button id="shPng" title="Download a PNG of the drawing">Export image</button>' +
      '<button id="shReport" title="Printable report (print to PDF)">Report</button>' +
      '<button id="shSave" title="Save your design as a file">Save</button>' +
      '<button id="shLoad" title="Open a saved design or an import file">Load</button>' +
      '<button id="shLog" title="Your prediction log">Log</button>' +
      '<button id="shSettings" aria-label="Settings" title="Settings">⚙</button>' +
      '<button id="shTheme" aria-pressed="false" title="Switch light or dark theme">theme</button>' +
      '<button id="shHelp" aria-label="Help" title="How to use this tool (?)">?</button>' +
      '</div><input type="file" id="shFile" accept=".json,.csv,application/json,text/csv" hidden' + (cfg.onFiles ? ' multiple' : '') + '>');
    const brief = h('div', { id: 'shBrief', class: 'sh-brief', role: 'note', hidden: true });
    const small = h('div', { id: 'shSmall', class: 'sh-small', role: 'note' },
      '<span>This tool needs a larger screen, at least 1024 px wide, for full use. The readouts still work here.</span><button type="button">Dismiss</button>');
    const main = h('main', { class: 'sh-main', id: 'shMain' },
      '<section id="shInputs" class="sh-col sh-inputs" aria-label="Inputs"></section>' +
      '<section id="shStage" class="sh-col sh-stage" aria-label="Drawing"></section>' +
      '<section id="shResults" class="sh-col sh-results" aria-label="Results">' +
      '<div id="shResultsBody"></div>' +
      '<div id="shPfBox" class="pfbox" hidden></div>' +
      '<details id="shWorking" class="working"><summary>Show the working</summary><div id="shWorkingBody"></div></details>' +
      '</section>');
    const footer = h('footer', { class: 'sh-footer' },
      '<span class="foot-by">Designed by <a href="https://billvanloo.com" target="_blank" rel="noopener"><strong>Bill Van Loo</strong></a></span>' +
      '<span class="foot-ai">Developed using Claude — please don\'t use this tool if you\'re uncomfortable using tools built with AI assistance.</span>' +
      '<span class="foot-spacer"></span>' +
      '<a href="' + mail('Bug report') + '">Report a bug</a>' +
      '<a href="' + mail('Feature request') + '">Request a feature</a>' +
      '<a href="https://ko-fi.com/billvanloo" target="_blank" rel="noopener">Support on Ko-fi</a>' +
      '<a href="' + repoUrl + '/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>' +
      '<a href="' + repoUrl + '" target="_blank" rel="noopener">View source</a>');
    const live = h('div', { id: 'shLive', class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const desc = h('div', { id: 'shDesc', class: 'sr-only', 'aria-live': 'polite' });
    const toastEl = h('div', { id: 'shToast', class: 'sh-toast', role: 'status', 'aria-live': 'polite' });
    const report = h('div', { id: 'sh-report' });
    [header, small, brief, main, footer, live, desc, toastEl, report].forEach(e => document.body.appendChild(e));
    const $ = id => document.getElementById(id);
    app.el = { inputs: $('shInputs'), stage: $('shStage'), results: $('shResultsBody'), pf: $('shPfBox'), working: $('shWorkingBody'), workingBox: $('shWorking') };

    /* ---------------- dialogs ---------------- */
    function dialog(id, title) {
      const d = h('dialog', { id, class: 'sh-dlg', 'aria-labelledby': id + 'T' },
        '<div class="dlg-h"><h2 id="' + id + 'T">' + esc(title) + '</h2><button class="btn small" data-close>Close</button></div><div class="dlg-b"></div>');
      d.querySelector('[data-close]').addEventListener('click', () => d.close());
      d.addEventListener('click', e => { if (e.target === d) d.close(); });
      document.body.appendChild(d);
      return { dlg: d, body: d.querySelector('.dlg-b') };
    }
    const helpD = dialog('shHelpDlg', 'How to use the ' + cfg.tool);
    const logD = dialog('shLogDlg', 'Prediction log');
    const setD = dialog('shSettingsDlg', 'Settings');

    /* ---------------- toast, live regions ---------------- */
    let toastT = 0;
    app.toast = (msg, ms) => {
      toastEl.textContent = msg; toastEl.classList.add('on');
      clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), ms || 3500);
    };
    app.announce = msg => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };
    let descT = 0, lastDesc = '';
    app.describe = text => {
      if (text === lastDesc) return;
      lastDesc = text; clearTimeout(descT);
      descT = setTimeout(() => { desc.textContent = text; }, 450);
    };

    /* ---------------- theme ---------------- */
    const curTheme = () => document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    function syncTheme() {
      const t = curTheme();
      $('shTheme').textContent = t === 'light' ? '☾ Dark' : '☀ Light';
      $('shTheme').setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    }
    $('shTheme').addEventListener('click', () => {
      const next = curTheme() === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      G.set('theme', next);
      syncTheme(); render();
    });
    // Palette for drawings, read from the CSS tokens.
    const PAL_KEYS = ['paper', 'grid-minor', 'grid-major', 'ink', 'ink-soft', 'line', 'steel', 'steel-edge', 'dykem', 'dykem-soft', 'brass', 'brass-ink', 'pass', 'fail', 'warn', 'pos-fill', 'neg-fill', 'field', 'panel', 'badge-text'];
    app.pal = () => {
      const cs = getComputedStyle(document.documentElement), p = {};
      PAL_KEYS.forEach(k => { p[k.replace(/-(\w)/g, (m, c) => c.toUpperCase())] = cs.getPropertyValue('--' + k).trim(); });
      p.fontUi = cs.getPropertyValue('--font-ui').trim(); p.fontMono = cs.getPropertyValue('--font-mono').trim();
      return p;
    };
    // Exports and reports are always ink on paper (00 §2).
    app.withLight = fn => {
      const root = document.documentElement, prev = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
      try { return fn(); } finally { root.setAttribute('data-theme', prev || 'light'); }
    };

    /* ---------------- formatting ---------------- */
    app.fmt = v => fmtSig(v, app.settings.sig);
    app.fmtU = (v, unit) => isNum(v) ? fmtSig(v, app.settings.sig) + (unit ? ' ' + unit : '') : '—';

    /* ---------------- name ---------------- */
    const nameEl = $('shName');
    nameEl.value = G.get('name', '') || '';
    nameEl.addEventListener('input', () => G.set('name', nameEl.value));
    app.student = () => nameEl.value.trim();
    // A teacher tool (the Collector) has no student name and no predict first.
    if (cfg.nameField === false) $('shNameWrap').hidden = true;
    if (cfg.predictFirst === false) { $('shPredict').hidden = true; $('shLog').hidden = true; app.settings.predictFirst = false; }

    /* ---------------- small screen ---------------- */
    if (G.get('smallDismissed', false)) small.hidden = true;
    small.querySelector('button').addEventListener('click', () => { small.hidden = true; G.set('smallDismissed', true); });

    /* ---------------- modes ---------------- */
    if (cfg.modes) {
      const box = $('shModes');
      box.className = 'modes'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', cfg.modes.label || 'Mode');
      cfg.modes.options.forEach(o => {
        const b = h('button', { type: 'button', 'data-mode': o.id, 'aria-pressed': 'false' }, esc(o.label));
        b.addEventListener('click', () => { cfg.modes.set(app, o.id); app.changed(); });
        box.appendChild(b);
      });
    }
    function syncModes() {
      if (!cfg.modes) return;
      const cur = cfg.modes.get(app);
      document.querySelectorAll('#shModes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === cur ? 'true' : 'false'));
    }

    /* ---------------- tabs ---------------- */
    // cfg.tabs: { label, options: [{ id, label }], get(app), set(app, id) }. Switching a
    // tab is not an input change, so predictions stay. The tab lives in the tool's state.
    if (cfg.tabs) {
      const box = $('shTabs');
      box.className = 'tabs'; box.setAttribute('role', 'tablist'); box.setAttribute('aria-label', cfg.tabs.label || 'Views');
      cfg.tabs.options.forEach(o => {
        const b = h('button', { type: 'button', role: 'tab', id: 'shTab_' + o.id, 'data-tab': o.id, 'aria-selected': 'false', 'aria-controls': 'shMain', tabindex: '-1' }, esc(o.label));
        b.addEventListener('click', () => app.selectTab(o.id));
        box.appendChild(b);
      });
      box.addEventListener('keydown', e => {
        const ids = cfg.tabs.options.map(o => o.id);
        let i = ids.indexOf(cfg.tabs.get(app));
        if (e.key === 'ArrowRight') i = (i + 1) % ids.length;
        else if (e.key === 'ArrowLeft') i = (i - 1 + ids.length) % ids.length;
        else if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = ids.length - 1;
        else return;
        e.preventDefault();
        app.selectTab(ids[i]);
        $('shTab_' + ids[i]).focus();
      });
    }
    app.tab = () => cfg.tabs ? cfg.tabs.get(app) : null;
    app.selectTab = id => {
      if (!cfg.tabs || app.tab() === id) return;
      const o = cfg.tabs.options.find(x => x.id === id);
      if (!o) return;
      cfg.tabs.set(app, id);
      saveState(); render();
      app.announce(o.label + ' tab.');
    };
    function syncTabs() {
      if (!cfg.tabs) return;
      const cur = app.tab();
      document.querySelectorAll('#shTabs [role="tab"]').forEach(b => {
        const on = b.dataset.tab === cur;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
      });
      document.body.setAttribute('data-tab', cur || '');
    }

    /* ---------------- challenges (00 §4.5–4.6) ---------------- */
    // cfg.challenges: { builtIn: [...] (examples), active(app) -> challenge mode on?,
    // apply(app, challenge) (default: copy challenge.inputs into app.state) }.
    // A teacher's list, pasted in Settings, replaces the built-in examples.
    const CH = cfg.challenges || null;
    const builtInChallenges = () => {
      if (!CH || !CH.builtIn) return [];
      try { return readChallengeList(CH.builtIn, cfg.tool).value.challenges; } catch (e) { console.error('Built-in challenges are not valid: ' + e.message); return []; }
    };
    app.challengeList = () => {
      const t = CH ? S.get('challenges', null) : null;
      if (t) { try { return readChallengeList(t, cfg.tool).value.challenges; } catch (e) { /* fall back to the examples */ } }
      return builtInChallenges();
    };
    app.isChallengeMode = () => !!CH && (CH.active ? !!CH.active(app) : !!(cfg.modes && cfg.modes.get(app) === 'challenge'));
    app.challenge = () => {
      if (!app.isChallengeMode() || !app.settings.challengeId) return null;
      return app.challengeList().find(c => c.id === app.settings.challengeId) || null;
    };
    app.isHidden = key => { const c = app.challenge(); return !!(c && c.hidden.indexOf(key) >= 0); };
    app.startChallenge = id => {
      const c = app.challengeList().find(x => x.id === id) || null;
      app.settings.challengeId = c ? c.id : null;
      if (c) {
        if (c.predictFirst || c.requirePrediction) app.settings.predictFirst = true;
        if (CH.apply) CH.apply(app, c);
        else for (const k in c.inputs) if (Object.prototype.hasOwnProperty.call(app.state, k)) app.state[k] = c.inputs[k];
      }
      saveSettings(); app.invalid = {};
      clearPrediction(); app.refreshFields(); saveState(); render();
      app.announce(c ? 'Challenge ' + c.id + ': ' + c.title + '.' : 'No challenge chosen.');
    };
    // 00 §4.6: a challenge can require a checked prediction before Run (or Spin up, Turn ...).
    app.gate = () => {
      const c = app.challenge();
      if (!c || !c.requirePrediction || (pfOn() && app.pf.revealed)) return true;
      app.toast('Check your prediction first.'); app.announce('Check your prediction first.');
      return false;
    };
    if (CH) $('shChallenge').addEventListener('change', e => app.startChallenge(e.target.value));
    function syncChallenge() {
      if (!CH) return;
      const on = app.isChallengeMode(), list = app.challengeList(), c = app.challenge();
      $('shChWrap').hidden = !on;
      const sel = $('shChallenge');
      const html = '<option value="">Choose a challenge</option>' + list.map(x => '<option value="' + esc(x.id) + '">' + esc(x.id + ' · ' + x.title) + (x.example ? ' (example)' : '') + '</option>').join('');
      if (sel.innerHTML !== html) sel.innerHTML = html;
      sel.value = c ? c.id : '';
      brief.hidden = !(on && c);
      if (on && c) {
        const bh = '<strong>' + esc(c.id + ' · ' + c.title) + '</strong>' + (c.brief ? ' ' + esc(c.brief) : '') +
          (c.hidden.length ? ' <span class="note">Some values are hidden for this challenge.</span>' : '') +
          (c.requirePrediction ? ' <span class="note">Check a prediction before you run it.</span>' : '');
        if (brief.innerHTML !== bh) brief.innerHTML = bh;
      }
    }

    /* =================================================================
       FIELDS
       ================================================================= */
    // Numeric input row. o: { id, label, unit, name, get(app), set(app, v), min, max, gt, integer,
    // check(v, app), step, help, parent, key }. `key` names the value for challenges: a
    // challenge that hides that key shows "hidden" in a locked box.
    app.numField = (parent, o) => {
      const row = h('div', { class: 'fld' });
      const errId = o.id + 'Err';
      row.innerHTML = '<label for="' + o.id + '">' + o.label + '</label>' +
        '<span class="ctl"><input type="text" inputmode="decimal" id="' + o.id + '" aria-describedby="' + errId + '" autocomplete="off">' +
        (o.unit ? '<span class="unit">' + esc(o.unit) + '</span>' : '') + '</span>' +
        '<div class="err" id="' + errId + '" role="alert"></div>';
      const input = row.querySelector('input'), err = row.querySelector('.err');
      const spec = () => ({ name: o.name || o.label.replace(/<[^>]+>/g, ''), unit: o.unit, min: typeof o.min === 'function' ? o.min(app) : o.min, max: typeof o.max === 'function' ? o.max(app) : o.max, gt: o.gt, integer: o.integer, check: o.check ? v => o.check(v, app) : null });
      function commit() {
        const r = validateNumber(input.value, spec());
        if (r.error) {
          err.textContent = r.error; input.setAttribute('aria-invalid', 'true'); app.invalid[o.id] = r.error;
        } else {
          err.textContent = ''; input.removeAttribute('aria-invalid'); delete app.invalid[o.id];
          o.set(app, r.value);
        }
        app.changed();
      }
      input.addEventListener('input', commit);
      input.addEventListener('keydown', e => {
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && o.step) {
          e.preventDefault();
          const cur = parseNumber(input.value);
          const base = isNum(cur) ? cur : o.get(app);
          const d = (e.key === 'ArrowUp' ? 1 : -1) * o.step * (e.shiftKey ? 10 : 1);
          input.value = fmtInput(Number((base + d).toFixed(10)));
          commit();
        }
      });
      const hid = () => !!(o.key && app.isHidden(o.key));
      // Returns true when the box is showing "hidden" and must not be refreshed.
      const lockHidden = () => {
        if (hid()) { input.disabled = true; input.value = 'hidden'; err.textContent = ''; input.removeAttribute('aria-invalid'); delete app.invalid[o.id]; return true; }
        if (input.disabled && input.value === 'hidden') { input.disabled = false; input.value = fmtInput(o.get(app)); }
        return false;
      };
      const field = {
        o, input, err, row,
        sync() {
          if (lockHidden()) return;
          if (document.activeElement === input || app.invalid[o.id]) return;
          const v = o.get(app); const s = fmtInput(v);
          if (input.value !== s && parseNumber(input.value) !== v) input.value = s;
          else if (input.value === '' && s !== '') input.value = s;
        },
        revalidate() { if (!hid() && input.value !== '') { const r = validateNumber(input.value, spec()); if (r.error && !app.invalid[o.id]) { err.textContent = r.error; input.setAttribute('aria-invalid', 'true'); app.invalid[o.id] = r.error; } else if (!r.error && app.invalid[o.id]) { err.textContent = ''; input.removeAttribute('aria-invalid'); delete app.invalid[o.id]; o.set(app, r.value); } } },
        reset() { if (lockHidden()) return; err.textContent = ''; input.removeAttribute('aria-invalid'); delete app.invalid[o.id]; input.value = fmtInput(o.get(app)); },
      };
      input.value = fmtInput(o.get(app));
      app.fields.push(field);
      parent.appendChild(row);
      return field;
    };
    // Select row. o: { id, label, options: [[value, label]] or fn(app), get, set }
    app.selectField = (parent, o) => {
      const row = h('div', { class: 'fld' });
      row.innerHTML = '<label for="' + o.id + '">' + o.label + '</label><span class="ctl"><select id="' + o.id + '"></select></span>';
      const sel = row.querySelector('select');
      const fill = () => {
        const opts = typeof o.options === 'function' ? o.options(app) : o.options;
        const html = opts.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('');
        if (sel.innerHTML !== html) sel.innerHTML = html;
        sel.value = String(o.get(app));
      };
      fill();
      sel.addEventListener('change', () => { o.set(app, sel.value); app.changed(); });
      const field = { o, input: sel, row, sync: fill, reset: fill, revalidate() { } };
      app.fields.push(field);
      parent.appendChild(row);
      return field;
    };
    app.checkField = (parent, o) => {
      const row = h('label', { class: 'chk' }, '<input type="checkbox" id="' + o.id + '"> ' + o.label);
      const cb = row.querySelector('input');
      cb.checked = !!o.get(app);
      cb.addEventListener('change', () => { o.set(app, cb.checked); app.changed(); });
      const field = { o, input: cb, row, sync() { cb.checked = !!o.get(app); }, reset() { cb.checked = !!o.get(app); }, revalidate() { } };
      app.fields.push(field);
      parent.appendChild(row);
      return field;
    };
    app.removeFields = container => { app.fields = app.fields.filter(f => { if (container.contains(f.row)) { delete app.invalid[f.o.id]; return false; } return true; }); };
    app.hasInvalid = () => Object.keys(app.invalid).length > 0;
    app.invalidReason = () => 'not defined: fix the highlighted input' + (Object.keys(app.invalid).length > 1 ? 's' : '');

    /* =================================================================
       PREDICT FIRST (00 §4)
       ================================================================= */
    const pfOn = () => !!app.settings.predictFirst;
    // Predict targets can carry a `group` (and `groupLabel`). Each group has its own
    // Check, so a team can predict one design step before seeing the next. A tool with
    // no groups behaves as one group named ''.
    const groupsOf = targets => {
      const gs = [];
      targets.forEach(t => { const g = t.group || ''; if (gs.indexOf(g) < 0) gs.push(g); });
      return gs.length ? gs : [''];
    };
    const grp = g => { g = g || ''; return app.pf.groups[g] || (app.pf.groups[g] = { revealed: false, messages: [] }); };
    // masked(): true while any group is still hidden. masked(group): that group only.
    app.masked = g => {
      if (!pfOn()) return false;
      if (g !== undefined) return !grp(g).revealed;
      return !app.pf.revealed;
    };
    // Wrap a readout value: shows a blank box while hidden.
    app.show = (text, g) => app.masked(g) ? '<span class="masked" aria-label="hidden until you check your prediction">?</span>' : text;
    function clearPrediction() { app.pf.revealed = false; app.pf.groups = {}; app.pf.fields = {}; app.pf.messages = []; }
    $('shPredict').addEventListener('click', () => {
      const c = app.challenge();
      if (c && c.requirePrediction && pfOn()) { app.toast('This challenge needs predict first.'); return; }
      app.settings.predictFirst = !pfOn(); saveSettings(); clearPrediction(); render();
      app.announce(pfOn() ? 'Predict first is on. Results are hidden until you check a prediction.' : 'Predict first is off.');
    });
    function problemId() {
      if (cfg.problemId) return cfg.problemId(app);
      const c = app.challenge();
      return c ? c.id : PL.sandboxProblemId(snapshot().values);
    }
    function snapshot() { return cfg.inputsSnapshot ? cfg.inputsSnapshot(app) : { values: {}, units: {} }; }
    const tolerance = () => { const c = app.challenge(); return (c && c.tolerance) || cfg.tolerance; };
    const gid = g => g ? '_' + String(g).replace(/[^A-Za-z0-9_-]/g, '-') : '';
    function renderPf() {
      const box = app.el.pf;
      $('shPredict').setAttribute('aria-pressed', pfOn() ? 'true' : 'false');
      if (!pfOn()) { box.hidden = true; return; }
      box.hidden = false;
      const targets = cfg.predictTargets(app);
      const gs = groupsOf(targets), multi = gs.length > 1;
      const blocked = app.hasInvalid();
      let html = '<h3>Predict first</h3>';
      if (gs.some(g => !grp(g).revealed)) html += '<p class="note">Enter your predictions, then press Check. Results stay hidden until you do.</p>';
      gs.forEach(g => {
        const ts = targets.filter(t => (t.group || '') === g), st = grp(g), sfx = gid(g);
        if (multi) html += '<div class="pfgroup" data-group="' + esc(g) + '"><h4>' + (ts[0] && ts[0].groupLabel ? ts[0].groupLabel : esc(g)) + '</h4>';
        if (!st.revealed) {
          ts.forEach(t => {
            const id = 'shPf_' + t.key, cur = app.pf.fields[t.key] || '';
            const ctl = t.kind === 'yesno'
              ? '<select id="' + id + '" data-key="' + esc(t.key) + '" data-group="' + esc(g) + '"><option value=""' + (cur === '' ? ' selected' : '') + '>—</option><option value="1"' + (cur === '1' ? ' selected' : '') + '>Yes</option><option value="0"' + (cur === '0' ? ' selected' : '') + '>No</option></select><span class="unit"></span>'
              : '<input type="text" inputmode="decimal" id="' + id + '" data-key="' + esc(t.key) + '" data-group="' + esc(g) + '" value="' + esc(cur) + '" autocomplete="off"><span class="unit">' + esc(t.unit || '') + '</span>';
            html += '<div class="pfrow"><label for="' + id + '">' + t.label + '</label>' + ctl + '</div>';
          });
          html += '<div class="btnrow"><button class="btn primary" id="shCheck' + sfx + '" data-check="' + esc(g) + '" type="button"' + (blocked ? ' disabled' : '') + '>Check</button></div>';
        } else {
          st.messages.forEach(m => { html += '<div class="pfmsg ' + (m.verdict || '') + '">' + m.html + '</div>'; });
          html += '<div class="btnrow"><button class="btn" id="shAgain' + sfx + '" data-again="' + esc(g) + '" type="button">Predict again</button></div>';
        }
        if (multi) html += '</div>';
      });
      if (blocked && gs.some(g => !grp(g).revealed)) html += '<p class="note warn">Fix the highlighted input before checking.</p>';
      box.innerHTML = html;
      box.querySelectorAll('[data-key]').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => { app.pf.fields[inp.dataset.key] = inp.value; }));
      // preventDefault: Check moves focus to "Predict again", and without it the same Enter
      // press would go on to activate that button and undo the Check at once.
      box.querySelectorAll('[data-key]').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(inp.dataset.group); } }));
      box.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => check(b.dataset.check)));
      box.querySelectorAll('[data-again]').forEach(b => b.addEventListener('click', () => {
        const g = b.dataset.again, st = grp(g);
        st.revealed = false; st.messages = []; app.pf.revealed = false;
        cfg.predictTargets(app).filter(t => (t.group || '') === g).forEach(t => { delete app.pf.fields[t.key]; });
        render();
        const f = box.querySelector('[data-key][data-group="' + (window.CSS && CSS.escape ? CSS.escape(g) : g) + '"]'); if (f) f.focus();
      }));
    }
    function check(g) {
      g = g || '';
      if (app.hasInvalid()) return;
      const all = cfg.predictTargets(app);
      const targets = all.filter(t => (t.group || '') === g);
      const student = app.student() || 'unnamed';
      const pid = problemId(), snap = snapshot();
      const msgs = [], recs = [];
      for (const t of targets) {
        const raw = app.pf.fields[t.key];
        if (raw === undefined || String(raw).trim() === '') continue;
        const p = parseNumber(raw);
        if (!isNum(p)) { app.toast(t.label.replace(/<[^>]+>/g, '') + ': enter a number.'); document.getElementById('shPf_' + t.key).focus(); return; }
        const yn = t.kind === 'yesno';
        if (yn && p !== 0 && p !== 1) { app.toast(t.label.replace(/<[^>]+>/g, '') + ': choose yes or no.'); return; }
        const model = isNum(t.model) ? t.model : null;
        const rec = PL.makeRecord({
          tool: cfg.tool, toolVersion: cfg.version, student, team: app.settings.team, classPeriod: app.settings.classPeriod,
          problemId: pid, quantity: t.quantity || t.key, unit: yn ? 'yes/no' : t.unit || '', predicted: p, model, measured: t.measured,
          attempt: PL.nextAttempt(app.log, student, pid, t.quantity || t.key), inputs: snap,
        });
        recs.push(rec);
        const v = yn ? (model === p ? 'match' : 'off') : verdictFor(rec.pctPredVsModel, tolerance());
        const tag = v === 'match' ? ' <span class="pftag match">Match</span>' : v === 'close' ? ' <span class="pftag close">Close</span>' : '';
        msgs.push({ verdict: v === 'match' ? 'match' : v === 'close' ? 'close' : '', html: '<b>' + t.label + '</b>' + tag + '<br>' + esc(yn ? yesNoMessage(p, model, t.reason) : predictionMessage(p, model, t.unit, app.settings.sig, t.reason)) });
      }
      if (!recs.length) msgs.push({ html: 'No prediction was entered, so nothing was logged. The results are shown below.' });
      app.log = app.log.concat(recs); saveLog();
      const st = grp(g);
      st.revealed = true; st.messages = msgs;
      app.pf.messages = msgs;
      app.pf.revealed = groupsOf(all).every(x => grp(x).revealed);
      render();
      app.announce(msgs.map(m => m.html.replace(/<[^>]+>/g, ' ')).join(' '));
      const again = $('shAgain' + gid(g)); if (again) again.focus();
    }
    app.check = check;
    // Attach a measured value to this student's latest prediction of a quantity for the
    // current inputs (a target's `quantity`). Returns the updated record, or null when
    // there is no such prediction yet. A target can also carry `measured` at Check.
    app.recordMeasured = (quantity, measured) => {
      const res = PL.annotateLatest(app.log, { student: app.student() || 'unnamed', problemId: problemId(), quantity, tool: cfg.tool }, { measured });
      if (res.index < 0) return null;
      app.log = res.records; saveLog();
      return app.log[res.index];
    };

    /* =================================================================
       SHOW THE WORKING (00 §5)
       ================================================================= */
    // steps: [{ title, formula, sub, result, note, source }], or groups of them:
    // [{ heading, group, steps: [...] }]. A group with a predict `group` stays hidden
    // until that group's prediction is checked.
    app.setWorking = steps => { app.working = steps || []; };
    const workingGrouped = () => app.working.some(s => s && Array.isArray(s.steps));
    const groupMasked = gr => gr.group !== undefined ? app.masked(gr.group) : app.masked();
    const stepsHtml = steps => '<ol class="wk">' + steps.map(s =>
      '<li><div class="wt">' + s.title + '</div>' +
      (s.formula ? '<div class="wf">' + s.formula + '</div>' : '') +
      (s.sub ? '<div class="ws">= ' + s.sub + '</div>' : '') +
      (s.result ? '<div class="wr">= ' + s.result + '</div>' : '') +
      (s.note ? '<div class="note">' + s.note + '</div>' : '') +
      (s.source ? '<div class="wsrc">Source: ' + esc(s.source) + '</div>' : '') + '</li>').join('') + '</ol>';
    function renderWorking() {
      const body = app.el.working;
      if (workingGrouped()) {
        if (app.hasInvalid()) { body.innerHTML = '<p class="note" style="padding:8px 10px">' + esc(app.invalidReason()) + '.</p>'; return; }
        body.innerHTML = app.working.map(gr => '<h4 class="wk-h">' + gr.heading + '</h4>' +
          (groupMasked(gr) ? '<p class="note" style="padding:4px 10px 8px">Hidden until you check your prediction.</p>'
            : gr.steps.length ? stepsHtml(gr.steps) : '<p class="note" style="padding:4px 10px 8px">Nothing to show yet.</p>')).join('');
        return;
      }
      if (app.masked()) { body.innerHTML = '<p class="note" style="padding:8px 10px">Hidden until you check your prediction.</p>'; return; }
      if (app.hasInvalid()) { body.innerHTML = '<p class="note" style="padding:8px 10px">' + esc(app.invalidReason()) + '.</p>'; return; }
      if (!app.working.length) { body.innerHTML = '<p class="note" style="padding:8px 10px">Nothing to show yet.</p>'; return; }
      body.innerHTML = stepsHtml(app.working);
    }

    /* =================================================================
       RENDER CYCLE
       ================================================================= */
    let saveT = 0;
    function saveState() { clearTimeout(saveT); saveT = setTimeout(() => S.set('state', { schemaVersion: cfg.schemaVersion, state: cfg.getState ? cfg.getState(app) : app.state }), 250); }
    function saveSettings() { S.set('settings', app.settings); }
    function saveLog() { S.set('log', app.log); }
    function render() {
      syncModes(); syncTabs(); syncChallenge();
      app.fields.forEach(f => f.sync());
      cfg.render(app);
      renderPf();
      renderWorking();
    }
    app.render = render;
    // Call after any input change (00 §4.4: hides results and clears predictions).
    app.changed = (opts) => {
      if (!(opts && opts.keepPrediction) && pfOn()) clearPrediction();
      saveState(); render();
    };
    app.refreshFields = () => { app.fields.forEach(f => f.reset()); };

    /* =================================================================
       SAVE / LOAD / IMPORT (00 §6)
       ================================================================= */
    function context() { if (cfg.context) return cfg.context(app); const c = app.challenge(); return c ? c.id : 'sandbox'; }
    function contextLabel() { if (cfg.contextLabel) return cfg.contextLabel(app); const c = app.challenge(); return c ? 'Challenge ' + c.id : 'Sandbox'; }
    app.fileName = ext => exportName({ student: app.student(), tool: cfg.slug, context: context(), dateISO: localDateISO(), ext });
    $('shSave').addEventListener('click', () => {
      const f = SC.makeDesignFile({ tool: cfg.tool, toolVersion: cfg.version, schemaVersion: cfg.schemaVersion }, cfg.getState ? cfg.getState(app) : app.state);
      f.student = app.student();
      download(app.fileName('json'), JSON.stringify(f, null, 2), 'application/json');
      app.toast('Saved ' + app.fileName('json'));
    });
    $('shLoad').addEventListener('click', () => app.openFile());
    app.openFile = () => { $('shFile').value = ''; $('shFile').click(); };
    $('shFile').addEventListener('change', e => { const fs = e.target.files; if (fs.length) { if (cfg.onFiles) readFiles(fs); else readFile(fs[0]); } });
    document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', e => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      if (cfg.onFiles) readFiles(e.dataTransfer.files); else readFile(e.dataTransfer.files[0]);
    });
    // cfg.onFiles(app, [{ name, text, error }]): a tool that takes many files at once
    // (the Collector) gets every file except saved design files, which the shell
    // restores as usual. A file that can't be read has text null and an error.
    function readFiles(list) {
      return Promise.all([...list].map(f => new Promise(res => {
        const r = new FileReader();
        r.onload = () => res({ name: f.name, text: String(r.result), error: null });
        r.onerror = () => res({ name: f.name, text: null, error: 'the file could not be read' });
        r.readAsText(f);
      }))).then(files => {
        const rest = files.filter(f => {
          if (f.text !== null && !/\.csv$/i.test(f.name) && SC.kindOf(f.text) === 'design') { app.loadText(f.text, f.name); return false; }
          return true;
        });
        if (rest.length) cfg.onFiles(app, rest);
      });
    }
    app.readFiles = readFiles;
    function readFile(file) {
      const r = new FileReader();
      r.onload = () => app.loadText(String(r.result), file.name);
      r.onerror = () => app.toast('That file could not be read.', 6000);
      r.readAsText(file);
    }
    app.loadText = (text, name) => {
      try {
        const kind = /\.csv$/i.test(name || '') ? 'prediction-log' : SC.kindOf(text);
        if (kind === 'design') {
          const res = SC.readDesignFile(text, { tool: cfg.tool, schemaVersion: cfg.schemaVersion, migrate: cfg.migrate });
          app.state = Object.assign(cfg.defaultState(), res.value.state);
          if (cfg.afterLoad) cfg.afterLoad(app);
          app.invalid = {};
          clearPrediction(); app.refreshFields(); saveState(); render();
          app.toast(res.warnings.length ? res.warnings.join(' ') : 'Loaded ' + (name || 'design') + '.', res.warnings.length ? 8000 : 3500);
          return { ok: true, warnings: res.warnings };
        }
        if (kind === 'prediction-log') {
          const res = PL.parseFile(name || 'log.json', text);
          const d = PL.dedupe(app.log.concat(res.records));
          const added = d.records.length - app.log.length;
          app.log = d.records; saveLog();
          app.toast('Added ' + added + ' prediction record' + (added === 1 ? '' : 's') + ' to your log.' + (res.warnings.length ? ' Note: ' + res.warnings.join(' ') : ''), 6000);
          return { ok: true };
        }
        if (kind && cfg.imports && cfg.imports[kind]) { cfg.imports[kind](app, text, name); return { ok: true }; }
        throw new Error(kind ? 'The ' + cfg.tool + ' cannot open a ' + kind + ' file.' : 'This file is not a design, import or prediction log this tool can read.');
      } catch (err) {
        app.toast(err.message, 8000);
        return { ok: false, error: err.message };
      }
    };
    app.download = download;

    /* =================================================================
       EXPORT IMAGE (00 §6): 2× PNG, ink on paper, caption strip
       ================================================================= */
    function drawingForExport() { return app.withLight(() => cfg.drawing(app, { export: true })); }
    function captionText() {
      return (cfg.nameField === false ? '' : 'Name: ' + (app.student() || 'unnamed') + '   ·   ') + cfg.tool + '   ·   ' + contextLabel() + '   ·   ' + localDateISO();
    }
    app.exportImage = () => new Promise((resolve, reject) => {
      const d = drawingForExport();
      const img = new Image();
      img.onload = () => {
        try {
          const scale = 2, capH = 40, W = d.width, H = d.height + capH;
          const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale;
          const x = c.getContext('2d'); x.scale(scale, scale);
          x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
          x.drawImage(img, 0, 0, d.width, d.height);
          x.strokeStyle = '#23272C'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(0, d.height + 0.75); x.lineTo(W, d.height + 0.75); x.stroke();
          x.fillStyle = '#23272C'; x.font = '600 13px "Avenir Next","Segoe UI",sans-serif'; x.textBaseline = 'middle';
          x.fillText(captionText(), 12, d.height + capH / 2);
          c.toBlob(blob => { download(app.fileName('png'), blob); resolve({ width: c.width, height: c.height }); }, 'image/png');
        } catch (e) { app.toast('The image could not be exported in this browser.', 6000); reject(e); }
      };
      img.onerror = () => { app.toast('The image could not be exported in this browser.', 6000); reject(new Error('svg load failed')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d.svg);
    });
    $('shPng').addEventListener('click', () => { app.exportImage().catch(() => { }); });

    /* =================================================================
       REPORT (00 §6): printable page
       ================================================================= */
    app.buildReport = () => {
      const d = drawingForExport();
      const r = cfg.report(app);
      const rows = list => list.map(([k, v]) => '<tr><th style="width:45%">' + k + '</th><td class="mono">' + v + '</td></tr>').join('');
      const session = app.log.filter(x => Date.parse(x.timestamp) >= app.sessionStart - 1000);
      const wkHead = '<tr class="hd"><th>#</th><th>Step</th><th>Formula</th><th>With numbers</th><th>Result</th><th>Source</th></tr>';
      const wkRows = steps => steps.map((s, i) => '<tr><td>' + (i + 1) + '</td><td>' + s.title + '</td><td class="mono">' + (s.formula || '') + '</td><td class="mono">' + (s.sub || '') + '</td><td class="mono">' + (s.result || '') + '</td><td>' + esc(s.source || '') + '</td></tr>').join('');
      const wk = workingGrouped()
        ? app.working.map(gr => '<h3 class="wk-h">' + gr.heading + '</h3>' + (groupMasked(gr) ? '<p>Hidden until the prediction is checked.</p>' : gr.steps.length ? '<table>' + wkHead + wkRows(gr.steps) + '</table>' : '<p>Nothing to show.</p>')).join('')
        : app.masked() ? '<p>Hidden until the prediction is checked.</p>' : app.working.length ? '<table>' + wkHead + wkRows(app.working) + '</table>' : '<p>Nothing to show.</p>';
      const hist = session.length ? '<table><tr class="hd"><th>Time</th><th>Quantity</th><th>Predicted</th><th>Model</th><th>Difference</th><th>Attempt</th></tr>' +
        session.map(x => '<tr><td>' + esc(x.timestamp.slice(11, 19)) + '</td><td>' + esc(x.quantity) + '</td><td class="mono">' + fmtSig(x.predicted, app.settings.sig) + ' ' + esc(x.unit) + '</td><td class="mono">' + (x.model === null ? 'not defined' : fmtSig(x.model, app.settings.sig) + ' ' + esc(x.unit)) + '</td><td class="mono">' + fmtPct(x.pctPredVsModel, app.settings.sig) + '</td><td>' + x.attempt + '</td></tr>').join('') + '</table>' : '<p>No predictions checked this session.</p>';
      const sources = (cfg.help && cfg.help.sources || []).map(s => '<li>' + esc(s.title) + (s.url ? ': ' + esc(s.url) : '') + '</li>').join('');
      const teacherTool = cfg.predictFirst === false;
      report.innerHTML = '<div class="rb"><h1>' + esc(cfg.tool) + ' — Report</h1><div class="sub">' + esc(cfg.subtitle || '') + '</div>' +
        '<table><tr class="hd"><th>Name</th><th>Date</th><th>Mode</th><th>Tool version</th></tr><tr><td>' + esc(teacherTool && cfg.nameField === false ? '—' : app.student() || 'unnamed') + '</td><td>' + localDateISO() + '</td><td>' + esc(contextLabel()) + '</td><td>' + esc(cfg.version) + '</td></tr></table>' +
        // report().lead: sections printed first, before the drawing (the Conveyor Designer's requirements).
        (r.lead || []).map(x => '<h2>' + esc(x.title) + '</h2>' + x.html).join('') +
        '<div class="fig">' + d.svg + '</div>' +
        '<h2>Inputs</h2><table>' + rows(r.inputs) + '</table>' +
        '<h2>Results</h2><table>' + rows(r.outputs) + '</table>' +
        (r.notes && r.notes.length ? '<h2>Notes</h2><ul>' + r.notes.map(n => '<li>' + n + '</li>').join('') + '</ul>' : '') +
        (r.sections || []).map(x => '<h2>' + esc(x.title) + '</h2>' + x.html).join('') +
        '<h2>Show the working</h2>' + wk +
        (teacherTool ? '' : '<h2>Prediction history (this session)</h2>' + hist) +
        '<h2>Sources</h2><ol>' + sources + '</ol>' +
        (teacherTool ? '' : '<div class="sig"><span>Student signature</span><span>Teacher check</span></div>') + '</div>';
      return report;
    };
    $('shReport').addEventListener('click', () => {
      app.buildReport();
      const prev = document.title;
      document.title = app.fileName('');
      document.title = document.title.replace(/\.$/, '');
      const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
      window.addEventListener('afterprint', restore);
      window.print();
      setTimeout(restore, 1500);
    });

    /* =================================================================
       PREDICTION LOG DIALOG (07 §3.3)
       ================================================================= */
    function renderLog() {
      const b = logD.body, sig = app.settings.sig;
      const recs = app.log.map((r, i) => ({ r, i })).reverse();
      b.innerHTML = '<p>Every Check in predict-first mode adds a row here. You can add a measured lab value and a note to any row. Records stay in this browser until you clear them in Settings.</p>' +
        '<div class="btnrow"><button class="btn" id="shLogJson">Export JSON</button><button class="btn" id="shLogCsv">Export CSV</button><button class="btn" id="shLogCopy">Copy last row</button></div>' +
        (recs.length ? '<div style="overflow-x:auto"><table><thead><tr><th>Time</th><th>Problem</th><th>Quantity</th><th>Predicted</th><th>Model</th><th>Diff.</th><th>Try</th><th>Measured</th><th>Note</th></tr></thead><tbody>' +
          recs.map(({ r, i }) => '<tr><td>' + esc(r.timestamp.slice(5, 16).replace('T', ' ')) + '</td><td>' + esc(r.problemId) + '</td><td>' + esc(r.quantity) + '</td><td>' + fmtSig(r.predicted, sig) + ' ' + esc(r.unit) + '</td><td>' + (r.model === null ? 'not defined' : fmtSig(r.model, sig)) + '</td><td>' + fmtPct(r.pctPredVsModel, sig) + '</td><td>' + r.attempt + '</td>' +
            '<td><input data-i="' + i + '" data-f="measured" inputmode="decimal" aria-label="Measured value for ' + esc(r.quantity) + '" value="' + (r.measured === null ? '' : r.measured) + '"></td>' +
            '<td><input data-i="' + i + '" data-f="note" aria-label="Note for ' + esc(r.quantity) + '" maxlength="200" value="' + esc(r.note) + '"></td></tr>').join('') + '</tbody></table></div>'
          : '<p class="note">No predictions yet. Turn on Predict first, enter a prediction and press Check.</p>');
      b.querySelectorAll('input[data-i]').forEach(inp => inp.addEventListener('change', () => {
        const i = +inp.dataset.i, f = inp.dataset.f;
        if (f === 'measured') { const v = inp.value.trim() === '' ? null : parseNumber(inp.value); if (v !== null && !isNum(v)) { app.toast('Measured value must be a number.'); return; } app.log[i] = PL.annotate(app.log[i], { measured: v }); }
        else app.log[i] = PL.annotate(app.log[i], { note: inp.value });
        saveLog(); renderLog();
      }));
      const logName = ext => exportName({ student: app.student(), tool: cfg.slug, context: 'prediction-log', dateISO: localDateISO(), ext });
      $('shLogJson').addEventListener('click', () => download(logName('json'), JSON.stringify(PL.toJSON(app.log), null, 2), 'application/json'));
      $('shLogCsv').addEventListener('click', () => download(logName('csv'), PL.toCSV(app.log), 'text/csv;charset=utf-8'));
      $('shLogCopy').addEventListener('click', async () => {
        if (!app.log.length) { app.toast('The log is empty.'); return; }
        const ok = await copyText(PL.toTSVRow(app.log[app.log.length - 1]));
        app.toast(ok ? 'Copied the last row. Paste it into your class spreadsheet.' : 'Copy did not work in this browser. Use Export CSV instead.');
      });
    }
    $('shLog').addEventListener('click', () => { renderLog(); logD.dlg.showModal(); });

    /* =================================================================
       SETTINGS, CLEAR MY DATA
       ================================================================= */
    function renderSettings() {
      const b = setD.body;
      b.innerHTML = '<h3>Numbers</h3><div class="fld"><label for="shSig">Significant figures shown</label><span class="ctl"><select id="shSig"><option value="3">3</option><option value="4">4</option></select></span></div>' +
        '<p class="note">Calculations are never rounded; this only changes the display.</p>' +
        '<h3>Your class</h3><div class="fld"><label for="shTeam">Team (optional)</label><span class="ctl"><input type="text" id="shTeam" maxlength="40" style="text-align:left"></span></div>' +
        '<div class="fld"><label for="shPeriod">Class period (optional)</label><span class="ctl"><input type="text" id="shPeriod" maxlength="20" style="text-align:left"></span></div>' +
        '<div id="shSetExtra"></div>' +
        (CH ? '<h3>Challenges (teacher)</h3><p class="note">Paste a challenge list (JSON) to replace the built-in examples. Students paste the same list into their copy. The help panel shows the format.</p>' +
          '<textarea id="shChText" rows="7" spellcheck="false" aria-describedby="shChMsg"></textarea>' +
          '<div class="btnrow"><button class="btn" id="shChSave" type="button">Use this list</button><button class="btn" id="shChReset" type="button">Use the built-in examples</button></div>' +
          '<p class="note" id="shChMsg" role="status"></p>' : '') +
        '<h3>Your data</h3><p>Your name, current design, predictions and settings are kept in this browser only.</p>' +
        '<div class="btnrow"><button class="btn danger" id="shClear">Clear my data</button></div><p class="note" id="shClearMsg"></p>';
      $('shSig').value = String(app.settings.sig);
      $('shSig').addEventListener('change', () => { app.settings.sig = +$('shSig').value; saveSettings(); render(); });
      $('shTeam').value = app.settings.team; $('shPeriod').value = app.settings.classPeriod;
      $('shTeam').addEventListener('input', () => { app.settings.team = $('shTeam').value; saveSettings(); });
      $('shPeriod').addEventListener('input', () => { app.settings.classPeriod = $('shPeriod').value; saveSettings(); });
      if (cfg.settingsExtra) cfg.settingsExtra(app, $('shSetExtra'));
      if (CH) {
        const custom = S.get('challenges', null);
        $('shChText').value = JSON.stringify(custom || { tool: cfg.tool, schemaVersion: CHALLENGE_VERSION, challenges: CH.builtIn || [] }, null, 2);
        $('shChMsg').textContent = custom ? 'Using your challenge list.' : 'Using the built-in examples.';
        $('shChSave').addEventListener('click', () => {
          try {
            const res = readChallengeList($('shChText').value, cfg.tool);
            S.set('challenges', JSON.parse($('shChText').value));
            $('shChMsg').textContent = 'Saved ' + res.value.challenges.length + ' challenge' + (res.value.challenges.length === 1 ? '' : 's') + '.' + (res.warnings.length ? ' ' + res.warnings.join(' ') : '');
            if (app.settings.challengeId && !app.challengeList().some(c => c.id === app.settings.challengeId)) { app.settings.challengeId = null; saveSettings(); }
            render();
          } catch (e) { $('shChMsg').textContent = e.message; }
        });
        $('shChReset').addEventListener('click', () => {
          S.del('challenges'); app.settings.challengeId = null; saveSettings();
          $('shChText').value = JSON.stringify({ tool: cfg.tool, schemaVersion: CHALLENGE_VERSION, challenges: CH.builtIn || [] }, null, 2);
          $('shChMsg').textContent = 'Using the built-in examples.'; render();
        });
      }
      let armed = false;
      $('shClear').addEventListener('click', () => {
        if (!armed) { armed = true; $('shClear').textContent = 'Click again to clear everything'; $('shClearMsg').textContent = 'This removes your name, design, prediction log and settings from this browser.'; return; }
        app.clearData(); setD.dlg.close();
      });
    }
    app.clearData = () => {
      clearTimeout(saveT);                      // a pending autosave must not write the old design back
      S.clearAll(); G.del('name');
      app.settings = Object.assign({ sig: 3, team: '', classPeriod: '', predictFirst: false }, cfg.defaultSettings || {});
      app.log = []; app.state = cfg.defaultState(); nameEl.value = ''; app.invalid = {};
      if (cfg.afterLoad) cfg.afterLoad(app);
      clearPrediction(); app.refreshFields(); render();
      app.toast('Your data was cleared from this browser.');
    };
    app.saveSettings = saveSettings;
    $('shSettings').addEventListener('click', () => { renderSettings(); setD.dlg.showModal(); });

    /* =================================================================
       HELP (00 §2)
       ================================================================= */
    function renderHelp() {
      const hp = cfg.help || {};
      const keys = (cfg.tabs ? [['← / → on the tabs', 'Switch view']] : []).concat(hp.keys || []).concat([['?', 'Open this help'], ['Esc', 'Close a dialog'], ['↑ / ↓ in a number box', 'Step the value (hold Shift for ×10)']]).concat(cfg.predictFirst === false ? [] : [['Enter in a prediction box', 'Check']]);
      const pfHelp = cfg.predictFirst === false ? '' :
        '<h3>Predict first</h3><p>Turn on <strong>Predict first</strong> in the header. The results you are asked to predict are hidden. Type a prediction for each one and press <strong>Check</strong>. The tool shows how far off you were and saves the attempt to your prediction log (<strong>Log</strong> button). Change any input and the results hide again. Within 1% counts as a match and within 5% as close. Open <strong>Show the working</strong> to see each step of the calculation and find where a prediction went wrong.</p>';
      const chHelp = !CH ? '' : '<h3>Challenges</h3><p>Choose a challenge from the list in the header. Predict first turns on, and some challenges hide input values or ask for a checked prediction before you run the model. Your teacher can replace the example challenges in Settings.</p>';
      helpD.body.innerHTML = (hp.html || '') + pfHelp + chHelp +
        '<h3>Numbers and units</h3><p>Results show 3 significant figures (4 in Settings). The tool never rounds in the middle of a calculation. ' + (hp.units || '') + '</p>' +
        '<h3>Saving your work</h3><p>Your name, design and predictions are kept in this browser. <strong>Save</strong> downloads a design file, and <strong>Load</strong> opens one (you can also drop a file onto the page). <strong>Export image</strong> downloads a picture of the drawing, and <strong>Report</strong> opens a printable page: choose "Save as PDF" in the print window. Exports always print ink on paper, whichever theme is on screen.</p>' +
        '<h3>Keyboard</h3><ul>' + keys.map(([k, a]) => '<li><kbd>' + esc(k) + '</kbd> ' + esc(a) + '</li>').join('') + '</ul>' +
        '<p>Screen readers hear a description of the drawing whenever it changes. With your system\'s reduce motion setting on, animations stop but numbers stay live. Use a laptop, Chromebook or full-size tablet; phone screens are too small for the drawing.</p>' +
        '<h3>Sources</h3><ol>' + (hp.sources || []).map(s => '<li>' + esc(s.title) + (s.url ? ': <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a>' : '') + '</li>').join('') + '</ol>' +
        '<div class="teacher"><h3 style="margin-top:0">Teacher notes</h3>' + (hp.teacher || '') +
        (cfg.predictFirst === false ? '' : '<p>The prediction log exports as JSON or CSV in the shared Engineered by the Numbers format, so a class set can be merged in the Prediction Log Collector. Nothing is sent anywhere; all data stays in the student\'s browser.</p>') +
        (CH ? '<p>A challenge list is JSON: <code>{ "tool": "' + esc(cfg.tool) + '", "schemaVersion": 1, "challenges": [ { "id": "XX-1", "title": "…", "brief": "…", "inputs": { … }, "hidden": [ … ], "tolerance": { "match": 1, "close": 5 }, "requirePrediction": true } ] }</code>. Input names and units are the ones in this tool\'s saved design file. Paste it in Settings.</p>' : '') + '</div>' +
        '<p class="note">' + esc(cfg.tool) + ' version ' + esc(cfg.version) + '.</p>';
    }
    app.openHelp = () => { renderHelp(); helpD.dlg.showModal(); };
    $('shHelp').addEventListener('click', app.openHelp);
    document.addEventListener('keydown', e => {
      const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === '?' && !typing && !document.querySelector('dialog[open]')) { e.preventDefault(); app.openHelp(); }
    });

    /* ---------------- go ---------------- */
    syncTheme();
    if (cfg.afterLoad) cfg.afterLoad(app);
    if (cfg.build) cfg.build(app);
    app.fields.forEach(f => f.revalidate());
    render();
    if (typeof window !== 'undefined') window.__app = app;
    return app;
  }

  return { create, util, version: '1.2.2' };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Shell;
