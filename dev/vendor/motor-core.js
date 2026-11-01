// ecosystem/motor-core.js v1.0.0
// Permanent-magnet brushed DC motor at constant voltage (spec 02 §3): the
// straight-line torque-speed model, parallel motors, gear stages, load types,
// the operating point, the ratio solver, duty bands, and current and
// efficiency. Plain SI in and out (N·m, rad/s, W, A, V); no DOM. Shared by the
// Motor and Drive Matcher, the Conveyor Designer and the Gear Train Workbench.
const MotorCore = (function () {
  'use strict';
  const G = 9.81;                      // m/s², as the unit plan uses for physics
  const isNum = v => typeof v === 'number' && isFinite(v);
  const DEFAULT_BANDS = { continuous: 30, short: 60 };   // % of stall (ISL Products)

  // k identical motors on one gearbox input: stall torque k·Ts, same no-load speed (§3.1).
  function motor(o) {
    const k = o.k || 1, Ts = k * o.Ts, w0 = o.w0;
    return { k, Ts, w0, Pmax: Ts * w0 / 4, TatPmax: Ts / 2, wAtPmax: w0 / 2 };
  }
  // Motor torque available at speed w on the line T = Ts(1 − w/w0).
  const torqueAt = (m, w) => m.Ts * (1 - w / m.w0);
  const speedAt = (m, T) => m.w0 * (1 - T / m.Ts);
  const powerAt = (m, T) => T * speedAt(m, T);

  // Overall ratio and efficiency: products over the stages (§3.2).
  function gearing(stages) {
    let i = 1, eta = 1;
    for (const s of stages) { i *= s.ratio; eta *= (s.efficiency == null ? 1 : s.efficiency); }
    return { i, eta };
  }

  // Load torque at the output (§3.2). r in m, F in N, m in kg.
  function loadTorque(o) {
    if (o.type === 'force') return o.F * o.r;
    if (o.type === 'lift') return o.m * G * o.r;
    return o.T;
  }

  function dutyBand(pct, bands) {
    const b = bands || DEFAULT_BANDS;
    if (!isNum(pct)) return null;
    if (pct >= 100) return 'stalled';
    return pct <= b.continuous ? 'continuous' : pct <= b.short ? 'short' : 'avoid';
  }

  // Operating point (§3.2). o: { Ts, w0, k, i, eta, TL, r (optional, for linear speed), bands }
  function operate(o) {
    const m = motor(o);
    const Tm = o.TL / (o.i * o.eta);
    const pct = Tm / m.Ts * 100;
    const stalled = Tm >= m.Ts;
    const wm = stalled ? 0 : speedAt(m, Tm);
    const wout = wm / o.i;
    const res = {
      motor: m, Tm, pct, stalled, wm, wout,
      Pout: o.TL * wout, Pmech: Tm * wm,
      band: stalled ? 'stalled' : dutyBand(pct, o.bands),
    };
    if (isNum(o.r)) res.v = wout * o.r;
    return res;
  }

  // Ratio for a target output speed under load (§3.3):
  //   w_out·i² − w0·i + w0·T_L/(η·Ts) = 0
  // Returns both roots; i_high keeps the motor below half its stall torque.
  function solveRatio(o) {
    const m = motor(o);
    const a = o.wTarget, b = -m.w0, c = m.w0 * o.TL / (o.eta * m.Ts);
    const D = b * b - 4 * a * c;
    const out = { a, b, c, D, feasible: D >= 0, iHigh: null, iLow: null };
    if (D < 0 || !(a > 0)) return out;
    const sq = Math.sqrt(D);
    out.iHigh = (m.w0 + sq) / (2 * a);
    out.iLow = (m.w0 - sq) / (2 * a);
    if (!(out.iLow > 1e-12)) out.iLow = null;           // T_L = 0 gives a zero root: not a ratio
    out.pctHigh = o.TL / (out.iHigh * o.eta) / m.Ts * 100;
    out.pctLow = out.iLow ? o.TL / (out.iLow * o.eta) / m.Ts * 100 : null;
    return out;
  }

  // Current and efficiency (§3.5). Per-motor current rises linearly with that motor's torque;
  // with k motors each carries T_m/k. Torque constant k_t = Ts/(Is − I0) for one motor.
  function electrical(o) {
    const k = o.k || 1;
    const perT = o.Tm / k;
    const Iper = o.I0 + (o.Is - o.I0) * perT / o.Ts;
    const I = k * Iper;
    const Pin = o.V * I;
    const Pmech = o.Tm * o.wm;
    return { I, Iper, Pin, Pmech, eff: Pin > 0 ? Pmech / Pin : null, kt: o.Ts / (o.Is - o.I0) };
  }

  // Nearest two-gear pair (whole teeth) to a ratio, for rounding a recommendation.
  function nearestPair(ratio, zMin, zMax) {
    zMin = zMin || 10; zMax = zMax || 100;
    let best = null;
    for (let z1 = zMin; z1 <= zMax; z1++) {
      const z2 = Math.round(ratio * z1);
      if (z2 < zMin || z2 > zMax) continue;
      const err = Math.abs(z2 / z1 - ratio);
      if (!best || err < best.err - 1e-12) best = { z1, z2, ratio: z2 / z1, err };
    }
    return best;
  }

  const rpmToRad = n => n * 2 * Math.PI / 60;
  const radToRpm = w => w * 60 / (2 * Math.PI);

  return { G, DEFAULT_BANDS, motor, torqueAt, speedAt, powerAt, gearing, loadTorque, dutyBand, operate, solveRatio, electrical, nearestPair, rpmToRad, radToRpm };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MotorCore;
