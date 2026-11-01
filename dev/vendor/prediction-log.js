// ecosystem/prediction-log.js v1.1.0
// Prediction Log record format (spec 07 Part A). Pure functions, no DOM.
// Every tool writes records through this module so the Collector can merge them.
const PredictionLog = (function () {
  'use strict';
  const SCHEMA = 'prediction-log';
  const SCHEMA_VERSION = 1;
  const FIELDS = ['schema', 'schemaVersion', 'tool', 'toolVersion', 'student', 'team', 'classPeriod',
    'problemId', 'quantity', 'unit', 'predicted', 'model', 'measured', 'pctPredVsModel',
    'pctMeasVsModel', 'attempt', 'timestamp', 'inputs', 'note'];
  const NUMERIC = ['predicted', 'model', 'measured', 'pctPredVsModel', 'pctMeasVsModel'];
  const NEWER_WARNING = 'made by a newer tool version; some fields may be ignored';

  const isNum = v => typeof v === 'number' && isFinite(v);

  // (value − reference) ÷ reference × 100; null when either is missing or the reference is 0 (00 §3).
  function pctDiff(value, reference) {
    if (!isNum(value) || !isNum(reference) || reference === 0) return null;
    return (value - reference) / reference * 100;
  }

  // ISO 8601 local time with offset, e.g. 2026-09-27T14:03:09-05:00.
  function isoLocal(date) {
    const d = date || new Date();
    const p = n => String(Math.abs(Math.trunc(n))).padStart(2, '0');
    const off = -d.getTimezoneOffset();
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' +
      p(d.getMinutes()) + ':' + p(d.getSeconds()) + (off >= 0 ? '+' : '-') + p(off / 60) + ':' + p(off % 60);
  }

  // Short stable hash (FNV-1a, 32-bit) for sandbox problem IDs.
  function shortHash(obj) {
    const s = typeof obj === 'string' ? obj : stableStringify(obj);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0').slice(0, 6);
  }
  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const sandboxProblemId = inputs => 'sandbox-' + shortHash(inputs);

  // Attempt number for the next record: one more than the highest so far for
  // this student, problem and quantity.
  function nextAttempt(records, student, problemId, quantity) {
    let max = 0;
    for (const r of records) {
      if (r.student === student && r.problemId === problemId && r.quantity === quantity && r.attempt > max) max = r.attempt;
    }
    return max + 1;
  }

  function makeRecord(o) {
    const model = isNum(o.model) ? o.model : null;
    const measured = isNum(o.measured) ? o.measured : null;
    const rec = {
      schema: SCHEMA, schemaVersion: SCHEMA_VERSION,
      tool: String(o.tool || ''), toolVersion: String(o.toolVersion || ''),
      student: (o.student || '').trim() || 'unnamed',
      team: o.team || '', classPeriod: o.classPeriod || '',
      problemId: String(o.problemId || 'sandbox'),
      quantity: String(o.quantity || ''), unit: o.unit == null ? '' : String(o.unit),
      predicted: o.predicted, model, measured,
      pctPredVsModel: pctDiff(o.predicted, model),
      pctMeasVsModel: pctDiff(measured, model),
      attempt: o.attempt || 1,
      timestamp: o.timestamp || isoLocal(),
      inputs: o.inputs || { values: {}, units: {} },
      note: o.note || '',
    };
    return rec;
  }

  // Update measured value and/or note after the fact; keeps the derived percent in step.
  function annotate(rec, { measured, note } = {}) {
    const out = Object.assign({}, rec);
    if (measured !== undefined) { out.measured = isNum(measured) ? measured : null; out.pctMeasVsModel = pctDiff(out.measured, out.model); }
    if (note !== undefined) out.note = String(note);
    return out;
  }

  // Record a measured value (and/or note) on the most recent record that matches
  // student, problemId and quantity (and tool, when given). Returns the new list and
  // the index changed, or index -1 when nothing matches. The list passed in is not changed.
  function annotateLatest(records, match, fields) {
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.student === match.student && r.problemId === match.problemId && r.quantity === match.quantity && (!match.tool || r.tool === match.tool)) {
        const out = records.slice();
        out[i] = annotate(r, fields);
        return { records: out, index: i };
      }
    }
    return { records, index: -1 };
  }

  /* ---------------------------------------------------------------- JSON */
  function toJSON(records) {
    return { schema: SCHEMA, schemaVersion: SCHEMA_VERSION, records: records.map(r => Object.assign({}, r)) };
  }

  /* ---------------------------------------------------------------- CSV (RFC 4180) */
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(records) {
    const lines = [FIELDS.join(',')];
    for (const r of records) lines.push(FIELDS.map(f => csvCell(r[f])).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function parseCSVRows(text) {
    const rows = []; let row = [], cell = '', i = 0, q = false;
    if (text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (q) throw new Error('a quoted cell is not closed');
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }
  function fromCSV(text) {
    const rows = parseCSVRows(text);
    if (!rows.length) throw new Error('the file is empty');
    const head = rows[0].map(h => h.trim());
    for (const need of ['student', 'problemId', 'quantity', 'predicted']) {
      if (head.indexOf(need) < 0) throw new Error('the header row has no "' + need + '" column');
    }
    const warnings = [];
    const records = rows.slice(1).map(cells => {
      const o = {};
      head.forEach((h, k) => { o[h] = cells[k] === undefined ? '' : cells[k]; });
      return normalize(o, warnings);
    });
    return { records, warnings: dedupeStrings(warnings) };
  }

  /* ---------------------------------------------------------------- normalize (either file form) */
  function toNumOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : null;
  }
  function normalize(o, warnings) {
    const ver = toNumOrNull(o.schemaVersion);
    if (ver !== null && ver > SCHEMA_VERSION) warnings.push(NEWER_WARNING);
    const r = {};
    r.schema = SCHEMA; r.schemaVersion = SCHEMA_VERSION;
    for (const f of ['tool', 'toolVersion', 'student', 'team', 'classPeriod', 'problemId', 'quantity', 'unit', 'timestamp', 'note']) {
      r[f] = o[f] == null ? '' : String(o[f]);
    }
    if (!r.student) r.student = 'unnamed';
    for (const f of NUMERIC) r[f] = toNumOrNull(o[f]);
    r.attempt = Math.max(1, Math.round(toNumOrNull(o.attempt) || 1));
    let inputs = o.inputs;
    if (typeof inputs === 'string') { try { inputs = inputs ? JSON.parse(inputs) : {}; } catch (e) { inputs = {}; warnings.push('some input snapshots could not be read'); } }
    r.inputs = inputs && typeof inputs === 'object' ? inputs : {};
    // Derived fields are recomputed so a hand-edited spreadsheet stays consistent.
    r.pctPredVsModel = pctDiff(r.predicted, r.model);
    r.pctMeasVsModel = pctDiff(r.measured, r.model);
    return r;
  }
  function fromJSON(text) {
    let data;
    try { data = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (e) { throw new Error('this is not valid JSON (' + e.message + ')'); }
    const warnings = [];
    let list;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.records)) {
      if (data.schema && data.schema !== SCHEMA) throw new Error('this is a "' + data.schema + '" file, not a prediction log');
      if (toNumOrNull(data.schemaVersion) > SCHEMA_VERSION) warnings.push(NEWER_WARNING);
      list = data.records;
    } else throw new Error('no "records" list was found');
    return { records: list.map(o => normalize(o || {}, warnings)), warnings: dedupeStrings(warnings) };
  }
  // Pick the reader from the file name or content.
  function parseFile(name, text) {
    const t = String(text).replace(/^﻿/, '').trimStart();
    if (/\.json$/i.test(name) || t[0] === '{' || t[0] === '[') return fromJSON(t);
    return fromCSV(String(text));
  }

  const dupKey = r => [r.student, r.tool, r.problemId, r.quantity, r.attempt, r.timestamp].join('\u0001');
  function dedupe(records) {
    const seen = new Set(), out = [];
    for (const r of records) { const k = dupKey(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
    return { records: out, removed: records.length - out.length };
  }

  // One tab-separated line (no header) for pasting into a shared spreadsheet.
  function toTSVRow(r) {
    return FIELDS.map(f => {
      const v = r[f];
      if (v === null || v === undefined) return '';
      return (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/[\t\r\n]+/g, ' ');
    }).join('\t');
  }

  function dedupeStrings(a) { return a.filter((s, i) => a.indexOf(s) === i); }

  return {
    SCHEMA, SCHEMA_VERSION, FIELDS, NEWER_WARNING,
    pctDiff, isoLocal, shortHash, stableStringify, sandboxProblemId, nextAttempt,
    makeRecord, annotate, annotateLatest, toJSON, toCSV, fromCSV, fromJSON, parseFile, parseCSVRows, dedupe, toTSVRow,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PredictionLog;
