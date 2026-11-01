// ecosystem/beam-core.js v1.0.0
// Beam and shaft model from spec 01 §3: reactions, shear, bending moment,
// torque segment, bending and torsional stress in a solid round shaft,
// Tresca and von Mises safety factors, required diameter, and deflection by
// double numerical integration. Plain SI in and out (N, m, N·m, Pa); no DOM.
// Positions x are measured from support A (pin) along the shaft; support B
// (roller) is at x = L. Loads P are positive downward. Moments are sagging
// positive. Shared by the Shaft and Beam Workbench, the Conveyor Designer and
// the Truss Stress Visualizer's Beam mode.
const BeamCore = (function () {
  'use strict';
  const PI = Math.PI;
  const isNum = v => typeof v === 'number' && isFinite(v);

  /* ------------------------------------------------------------ statics (§3.1) */
  // Moments about A: R_B = Σ(P·a)/L; vertical balance: R_A = ΣP − R_B. Holds for overhangs.
  function reactions(L, loads) {
    let sumP = 0, sumPa = 0;
    for (const l of loads) { sumP += l.P; sumPa += l.P * l.a; }
    const RB = sumPa / L;
    return { RA: sumP - RB, RB, sumP, sumPa };
  }

  /* ------------------------------------------------------------ shear and moment (§3.2) */
  // V(x): sum of vertical forces to the left of x (reactions up +, loads down −).
  // side = 'left' gives the value just left of x, 'right' just right of it.
  function shearAt(x, L, loads, R, side) {
    const right = side !== 'left';
    const past = (s) => right ? s <= x : s < x;
    let V = 0;
    if (past(0)) V += R.RA;
    if (past(L)) V += R.RB;
    for (const l of loads) if (past(l.a)) V -= l.P;
    return V;
  }
  // M(x): moments about x of the forces to the left of x. Continuous, so no side.
  function momentAt(x, L, loads, R) {
    let M = 0;
    if (x > 0) M += R.RA * x;
    if (x > L) M += R.RB * (x - L);
    for (const l of loads) if (l.a < x) M -= l.P * (x - l.a);
    return M;
  }
  function torqueAt(x, tq) {
    if (!tq || !isNum(tq.T) || tq.T === 0) return 0;
    const lo = Math.min(tq.from, tq.to), hi = Math.max(tq.from, tq.to);
    const eps = 1e-12;
    return (x >= lo - eps && x <= hi + eps) ? tq.T : 0;   // closed interval (ERRATA: SB-12)
  }

  /* ------------------------------------------------------------ section stresses (§3.4) */
  // Stresses at one section of a solid round shaft. M, T in N·m, d in m, Sy in Pa.
  function section(o) {
    const d = o.d, Kb = o.Kb || 1, Kt = o.Kt || 1, M = Math.abs(o.M || 0), T = Math.abs(o.T || 0);
    const k = PI * d * d * d;
    const sigma = 32 * Kb * M / k;
    const tau = 16 * Kt * T / k;
    const tauMax = 16 / k * Math.hypot(Kb * M, Kt * T);          // Tresca combined
    const sigmaVM = Math.sqrt(sigma * sigma + 3 * tau * tau);      // von Mises
    const rule = o.rule === 'vonMises' ? 'vonMises' : 'tresca';
    let n = null;
    if (isNum(o.Sy)) {
      if (rule === 'tresca') n = tauMax > 0 ? o.Sy / (2 * tauMax) : Infinity;
      else n = sigmaVM > 0 ? o.Sy / sigmaVM : Infinity;
    }
    const out = { sigma, tau, tauMax, sigmaVM, n, rule };
    if (isNum(o.nTarget) && isNum(o.Sy)) out.dReq = requiredDiameter({ M, T, Sy: o.Sy, n: o.nTarget, Kb, Kt, rule });
    return out;
  }
  // Required diameter for a target safety factor (§3.4). Returns null when there is no load.
  function requiredDiameter(o) {
    const Kb = o.Kb || 1, Kt = o.Kt || 1, M = Math.abs(o.M), T = Math.abs(o.T);
    if (o.rule === 'vonMises') {
      const c = Math.sqrt((Kb * M) ** 2 + 0.75 * (Kt * T) ** 2);
      return c > 0 ? Math.cbrt((32 * o.n / (PI * o.Sy)) * c) : null;
    }
    const c = Math.hypot(Kb * M, Kt * T);
    return c > 0 ? Math.cbrt(16 * c / (PI * o.Sy / (2 * o.n))) : null;
  }

  /* ------------------------------------------------------------ whole-shaft analysis */
  // inp: { L, overhangLeft, overhangRight, loads: [{P, a, label}], mode: 'beam'|'shaft',
  //        torque: {T, from, to} | null, d, Sy, E, Kb, Kt, nTarget, rule, stations }
  function analyze(inp) {
    const L = inp.L, oL = inp.overhangLeft || 0, oR = inp.overhangRight || 0;
    const x0 = -oL, x1 = L + oR;
    const loads = (inp.loads || []).filter(l => isNum(l.P) && isNum(l.a));
    const shaft = inp.mode !== 'beam';
    const tq = shaft && inp.torque && isNum(inp.torque.T) ? inp.torque : null;
    const R = reactions(L, loads);

    // Stations: ≥400 evenly spaced over the modeled length, plus every load, support and torque end.
    const nSt = Math.max(400, inp.stations || 400);
    const special = [x0, 0, L, x1].concat(loads.map(l => l.a));
    if (tq) special.push(tq.from, tq.to);
    const set = new Set();
    for (let i = 0; i <= nSt; i++) set.add(round12(x0 + (x1 - x0) * i / nSt));
    special.forEach(s => { if (s >= x0 - 1e-12 && s <= x1 + 1e-12) set.add(round12(s)); });
    const xs = Array.from(set).sort((a, b) => a - b);
    const jumps = new Set([0, L].concat(loads.map(l => l.a)).map(round12));

    const V = [], M = [], T = [];
    for (const x of xs) { V.push(shearAt(x, L, loads, R, 'right')); M.push(momentAt(x, L, loads, R)); T.push(tq ? torqueAt(x, tq) : 0); }

    // Shear diagram polyline with both sides at each jump (for drawing and labels).
    const shearPts = [];
    xs.forEach((x, i) => {
      if (jumps.has(x) && x > x0 && x < x1) shearPts.push({ x, V: shearAt(x, L, loads, R, 'left') });
      shearPts.push({ x, V: V[i] });
    });

    // |M|max and its station.
    let iM = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(M[i]) > Math.abs(M[iM]) + 1e-12) iM = i;
    const Mmax = { M: M[iM], x: xs[iM] };

    // Stress, safety factor and required diameter at every station (§3.4: scan all stations).
    const rule = inp.rule === 'vonMises' ? 'vonMises' : 'tresca';
    const haveMat = isNum(inp.d) && inp.d > 0 && isNum(inp.Sy) && inp.Sy > 0;
    const nArr = [];
    let crit = null, dReq = null, dReqX = null;
    if (haveMat) {
      xs.forEach((x, i) => {
        const s = section({ M: M[i], T: T[i], d: inp.d, Sy: inp.Sy, Kb: inp.Kb, Kt: inp.Kt, rule });
        nArr.push(s.n);
        if (crit === null || s.n < crit.n - 1e-12) crit = Object.assign({ x, i, M: M[i], T: T[i] }, s);
        if (isNum(inp.nTarget) && inp.nTarget > 0) {
          const dr = requiredDiameter({ M: M[i], T: T[i], Sy: inp.Sy, n: inp.nTarget, Kb: inp.Kb, Kt: inp.Kt, rule });
          if (dr !== null && (dReq === null || dr > dReq + 1e-15)) { dReq = dr; dReqX = x; }
        }
      });
    }
    const loaded = crit !== null && isFinite(crit.n);
    const result = {
      L, x0, x1, R, RA: R.RA, RB: R.RB, xs, V, M, T, shearPts, Mmax, nArr, rule, mode: shaft ? 'shaft' : 'beam',
      torque: tq ? Math.abs(tq.T) : 0,
      critical: loaded ? crit : null,
      n: loaded ? crit.n : null,
      nReason: !haveMat ? 'enter a diameter and yield strength' : loaded ? null : 'no load',
      pass: loaded && isNum(inp.nTarget) ? crit.n >= inp.nTarget : null,
      dReq, dReqX,
    };
    if (isNum(inp.E) && inp.E > 0 && isNum(inp.d) && inp.d > 0) result.deflection = deflection(inp, loads, R);
    return result;
  }

  /* ------------------------------------------------------------ deflection (§3.5) */
  // y'' = M/(E I), integrated twice on a fine grid, with y = 0 at both supports.
  // Negative y is downward. I = π d⁴ / 64.
  function deflection(inp, loads, R) {
    const L = inp.L, x0 = -(inp.overhangLeft || 0), x1 = L + (inp.overhangRight || 0);
    const I = PI * Math.pow(inp.d, 4) / 64, EI = inp.E * I;
    const knots = Array.from(new Set([x0, 0, L, x1].concat(loads.map(l => l.a)).map(round12))).filter(x => x >= x0 && x <= x1).sort((a, b) => a - b);
    const xs = [x0];
    const per = 4000 / Math.max(1e-9, x1 - x0);
    for (let k = 1; k < knots.length; k++) {
      const a = knots[k - 1], b = knots[k], n = Math.max(2, Math.ceil((b - a) * per));
      for (let j = 1; j <= n; j++) xs.push(j === n ? b : a + (b - a) * j / n);
    }
    const curv = xs.map(x => momentAt(x, L, loads, R) / EI);
    const slope = [0], Y = [0];
    for (let i = 1; i < xs.length; i++) {
      const h = xs[i] - xs[i - 1];
      slope.push(slope[i - 1] + 0.5 * h * (curv[i] + curv[i - 1]));
      // Exact for a linear curvature over the step (M is piecewise linear between loads).
      Y.push(Y[i - 1] + h * slope[i - 1] + h * h * (2 * curv[i - 1] + curv[i]) / 6);
    }
    const at = x => { const i = xs.indexOf(x); return Y[i]; };
    const yA = at(0), yB = at(round12(L));
    // Add the straight line that brings y back to 0 at A (x = 0) and B (x = L).
    const c1 = (yB - yA) / L, c0 = -yA;
    const y = xs.map((x, i) => Y[i] + c0 - c1 * x);
    let k = 0;
    for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[k])) k = i;
    return { xs, y, I, EI, max: Math.abs(y[k]), maxSigned: y[k], x: xs[k] };
  }

  function round12(x) { return Math.round(x * 1e12) / 1e12; }

  // Closed form for a single centered load (Optimal Beam), for help and tests.
  const centeredDeflection = (P, L, E, I) => P * L * L * L / (48 * E * I);

  return { reactions, shearAt, momentAt, torqueAt, section, requiredDiameter, analyze, deflection, centeredDeflection };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BeamCore;
