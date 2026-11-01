// ecosystem/schemas.js v1.0.0
// Validators and builders for the files the tools exchange (see ecosystem/schemas.md).
// Each reader returns { value, warnings } or throws an Error whose message is written
// for students ("This file ..."). Pure functions, no DOM.
const Schemas = (function () {
  'use strict';
  const isNum = v => typeof v === 'number' && isFinite(v);
  const fail = msg => { throw new Error(msg); };

  function parse(text) {
    if (text && typeof text === 'object') return text;
    try { return JSON.parse(String(text).replace(/^﻿/, '')); }
    catch (e) { fail('This file is not valid JSON, so it could not be read.'); }
  }
  function header(obj, schema, current, warnings) {
    if (!obj || typeof obj !== 'object') fail('This file is empty or not a JSON object.');
    if (obj.schema !== schema) fail('This is not a ' + schema + ' file' + (obj.schema ? ' (it says "' + obj.schema + '").' : '.'));
    const v = Number(obj.schemaVersion);
    if (!isFinite(v) || v < 1) fail('This file has no schema version, so it could not be read.');
    if (v > current) warnings.push('This file was made by a newer tool version; some fields may be ignored.');
  }
  // Angle difference in degrees, 0..180.
  function angleGap(a, b) { const d = Math.abs(((a - b) % 360 + 540) % 360 - 180); return d; }

  /* ------------------------------------------------------------ shaft-loads (spec 01 §7) */
  const SHAFT_LOADS_VERSION = 1;
  function readShaftLoads(text) {
    const obj = parse(text), warnings = [];
    header(obj, 'shaft-loads', SHAFT_LOADS_VERSION, warnings);
    if (!Array.isArray(obj.loads) || obj.loads.length === 0) fail('This shaft-loads file has no loads in it.');
    const units = obj.units || {};
    if (units.force && units.force !== 'N') fail('Forces in this file are in ' + units.force + '. Only N is supported.');
    if (units.torque && units.torque !== 'N·m' && units.torque !== 'N*m' && units.torque !== 'N m') fail('Torques in this file are in ' + units.torque + '. Only N·m is supported.');
    const loads = obj.loads.map((l, i) => {
      const n = i + 1;
      if (!l || typeof l !== 'object') fail('Load ' + n + ' is not readable.');
      const magnitude = Number(l.magnitude);
      if (!isFinite(magnitude)) fail('Load ' + n + ' has no magnitude.');
      if (magnitude < 0) fail('Load ' + n + ' has a negative magnitude. Magnitudes must be positive; the direction goes in angleDeg.');
      const angleDeg = l.angleDeg == null ? 270 : Number(l.angleDeg);
      if (!isFinite(angleDeg)) fail('Load ' + n + ' has an angle that is not a number.');
      const torque = l.torque == null ? null : Number(l.torque);
      if (torque !== null && !isFinite(torque)) fail('Load ' + n + ' has a torque that is not a number.');
      return {
        label: String(l.label || ('Load ' + n)).slice(0, 20), magnitude, angleDeg, torque,
        plane: l.plane || null, shaft: l.shaft == null ? null : String(l.shaft),
      };
    });
    const angles = loads.map(l => l.angleDeg);
    let spread = 0;
    // Spec 01 §5.5: warn when any two loads point more than 5° apart. Version 1
    // places every imported load by its magnitude, so even opposed loads need a look.
    for (let i = 0; i < angles.length; i++) for (let j = i + 1; j < angles.length; j++) {
      spread = Math.max(spread, angleGap(angles[i], angles[j]));
    }
    return {
      value: { source: String(obj.source || 'unknown tool'), loads, notes: Array.isArray(obj.notes) ? obj.notes.map(String) : [] },
      warnings, planeSpreadDeg: spread, multiPlane: spread > 5,
    };
  }
  function makeShaftLoads(source, loads, notes) {
    return {
      schema: 'shaft-loads', schemaVersion: SHAFT_LOADS_VERSION, source,
      units: { force: 'N', torque: 'N·m' },
      loads: loads.map(l => {
        const o = { label: l.label, magnitude: l.magnitude, angleDeg: l.angleDeg };
        if (isNum(l.torque)) o.torque = l.torque;
        if (l.plane) o.plane = l.plane;
        if (l.shaft != null) o.shaft = l.shaft;
        return o;
      }),
      notes: notes || [],
    };
  }

  /* ------------------------------------------------------------ drive-request / drive-result (spec 02 §5.5) */
  const DRIVE_VERSION = 1;
  function readStages(list, where) {
    if (list == null) return null;
    if (!Array.isArray(list) || !list.length) fail(where + ' has an empty stage list.');
    return list.map((s, i) => {
      const ratio = Number(s.ratio), efficiency = s.efficiency == null ? 1 : Number(s.efficiency);
      if (!(ratio > 0)) fail('Stage ' + (i + 1) + ' in ' + where + ' needs a ratio greater than 0.');
      if (!(efficiency > 0 && efficiency <= 1)) fail('Stage ' + (i + 1) + ' in ' + where + ' needs an efficiency between 0 and 1.');
      return { ratio, efficiency };
    });
  }
  function readDriveRequest(text) {
    const obj = parse(text), warnings = [];
    header(obj, 'drive-request', DRIVE_VERSION, warnings);
    const loadTorque = Number(obj.loadTorque);
    if (!isFinite(loadTorque) || loadTorque < 0) fail('This drive request needs a load torque of 0 N·m or more.');
    const targetSpeed = obj.targetSpeed == null ? null : Number(obj.targetSpeed);
    if (targetSpeed !== null && !(targetSpeed > 0)) fail('The target speed in this drive request must be greater than 0 rpm.');
    let motor = null;
    if (obj.motor) {
      const m = obj.motor;
      motor = { label: String(m.label || ''), stallTorque: Number(m.stallTorque), noLoadSpeed: Number(m.noLoadSpeed), count: m.count == null ? 1 : Number(m.count) };
      if (!(motor.stallTorque > 0) || !(motor.noLoadSpeed > 0)) fail('The motor in this drive request needs a stall torque and no-load speed greater than 0.');
    }
    return { value: { source: String(obj.source || 'unknown tool'), loadTorque, targetSpeed, stages: readStages(obj.stages, 'this drive request'), motor, note: obj.note ? String(obj.note) : '' }, warnings };
  }
  function makeDriveRequest(source, o) {
    const r = { schema: 'drive-request', schemaVersion: DRIVE_VERSION, source, units: { torque: 'N·m', speed: 'rpm' }, loadTorque: o.loadTorque };
    if (isNum(o.targetSpeed)) r.targetSpeed = o.targetSpeed;
    if (o.stages) r.stages = o.stages.map(s => ({ ratio: s.ratio, efficiency: s.efficiency }));
    if (o.motor) r.motor = Object.assign({}, o.motor);
    if (o.note) r.note = o.note;
    return r;
  }
  function makeDriveResult(source, o) {
    return {
      schema: 'drive-result', schemaVersion: DRIVE_VERSION, source, units: { torque: 'N·m', speed: 'rpm', power: 'W' },
      motor: Object.assign({}, o.motor),
      stages: (o.stages || []).map(s => ({ ratio: s.ratio, efficiency: s.efficiency })),
      ratio: o.ratio, efficiency: o.efficiency,
      loadTorque: o.loadTorque, targetSpeed: isNum(o.targetSpeed) ? o.targetSpeed : null,
      ratioRoots: o.ratioRoots || null,
      operatingPoint: Object.assign({}, o.operatingPoint),
      dutyBand: o.dutyBand,
    };
  }
  function readDriveResult(text) {
    const obj = parse(text), warnings = [];
    header(obj, 'drive-result', DRIVE_VERSION, warnings);
    if (!(Number(obj.ratio) > 0)) fail('This drive result has no gear ratio.');
    if (!obj.operatingPoint || typeof obj.operatingPoint !== 'object') fail('This drive result has no operating point.');
    return { value: obj, warnings };
  }

  /* ------------------------------------------------------------ design file envelope (00 §6) */
  function makeDesignFile(meta, state) {
    return { tool: meta.tool, toolVersion: meta.toolVersion, schemaVersion: meta.schemaVersion, savedAt: new Date().toISOString(), state };
  }
  // opts: { tool, schemaVersion, migrate(fromVersion, state) -> { state, dropped: [..] } }
  function readDesignFile(text, opts) {
    const obj = parse(text), warnings = [];
    if (!obj || typeof obj !== 'object' || !('state' in obj)) {
      if (obj && obj.schema) fail('This is a ' + obj.schema + ' file, not a saved design. Use the import menu for it.');
      fail('This is not a saved design file.');
    }
    if (obj.tool && opts.tool && obj.tool !== opts.tool) fail('This design was saved from the ' + obj.tool + ', not the ' + opts.tool + '.');
    const v = Number(obj.schemaVersion) || 1;
    let state = obj.state;
    if (v > opts.schemaVersion) warnings.push('This design was saved by a newer version of the tool. Anything this version does not know about was left out.');
    else if (v < opts.schemaVersion && opts.migrate) {
      const m = opts.migrate(v, state);
      state = m.state;
      if (m.dropped && m.dropped.length) warnings.push('Could not load from the older file: ' + m.dropped.join(', ') + '.');
    }
    return { value: { state, savedAt: obj.savedAt || null, toolVersion: obj.toolVersion || '' }, warnings };
  }

  // Detect which kind of file this is, for tools that accept several on one Load button.
  function kindOf(text) {
    let obj; try { obj = parse(text); } catch (e) { return null; }
    if (obj && obj.schema) return obj.schema;
    if (obj && 'state' in obj) return 'design';
    return null;
  }

  return {
    SHAFT_LOADS_VERSION, DRIVE_VERSION, angleGap,
    readShaftLoads, makeShaftLoads, readDriveRequest, makeDriveRequest, readDriveResult, makeDriveResult,
    makeDesignFile, readDesignFile, kindOf,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Schemas;
