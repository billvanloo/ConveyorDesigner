// ecosystem/anim.js v1.0.0
// One animation clock per moving part of a tool (03 block and screw, 04 wheel,
// 05 boxes). It turns real frames into simulation time and calls the tool's
// step function, which should work out the state from the simulation time (for
// example θ(t) for the wheel), so the stop lands on the computed time.
//   - pauses while the browser tab is hidden, and never jumps more than 0.1 s per frame
//   - time scale for slow motion (04: 1, ¼, 1/10)
//   - reduced motion (00 §7): the loop does not run; the tool shows the end state
//     and keeps its numbers live
//   - a manual clock for tests: Anim.manual(true) stops every loop, and
//     anim.advance(seconds) or Anim.advanceAll(seconds) moves time exactly
const Anim = (function () {
  'use strict';
  const all = [];
  let manualMode = false;
  const hasWin = typeof window !== 'undefined';
  const MAX_DT = 0.1;                         // s of real time per frame, at most

  function prefersReduced() {
    try { return hasWin && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // opts: { step(dtSim, tSim) -> false to stop, onStop(), onReduced(), scale,
  //         now(), raf(fn), caf(id), reduced() }
  function create(opts) {
    opts = opts || {};
    const now = opts.now || (() => (hasWin && window.performance ? performance.now() : Date.now()));
    const raf = opts.raf || (hasWin && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : (fn => setTimeout(() => fn(now()), 16)));
    const caf = opts.caf || (hasWin && window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout);
    const reduced = opts.reduced || prefersReduced;
    let id = null, last = null;
    const a = {
      time: 0, scale: opts.scale || 1, running: false,
      reduced,
      // Start (or resume) the loop. Returns false under reduced motion, after calling onReduced.
      start() {
        if (a.running) return true;
        if (reduced()) { if (opts.onReduced) opts.onReduced(); return false; }
        a.running = true; last = null;
        if (!manualMode) id = raf(frame);
        return true;
      },
      stop() {
        if (!a.running) return;
        a.running = false; if (id !== null) caf(id); id = null; last = null;
        if (opts.onStop) opts.onStop();
      },
      reset() { a.stop(); a.time = 0; },
      setScale(s) { a.scale = s > 0 ? s : 1; },
      // Move simulation time by `simSeconds` in steps no longer than one 60 Hz frame.
      advance(simSeconds) {
        let left = simSeconds;
        while (a.running && left > 1e-12) {
          const dt = Math.min(left, 1 / 60);
          left -= dt; tick(dt);
        }
        return a.time;
      },
    };
    function tick(dtSim) {
      a.time += dtSim;
      const go = opts.step ? opts.step(dtSim, a.time) : true;
      if (go === false) a.stop();
    }
    function frame(ts) {
      id = null;
      if (!a.running || manualMode) return;
      const t = typeof ts === 'number' ? ts : now();
      if (last !== null) tick(Math.min(MAX_DT, Math.max(0, (t - last) / 1000)) * a.scale);
      last = t;
      if (a.running && !manualMode) id = raf(frame);
    }
    a._resume = () => { if (a.running && id === null && !manualMode) { last = null; id = raf(frame); } };
    a._pause = () => { if (id !== null) caf(id); id = null; last = null; };
    all.push(a);
    return a;
  }

  if (hasWin && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => all.forEach(a => document.hidden ? a._pause() : a._resume()));
  }

  return {
    create, prefersReduced,
    all: () => all.slice(),
    // Tests: take every clock off real time (true) or put it back (false).
    manual(on) { manualMode = !!on; all.forEach(a => on ? a._pause() : a._resume()); },
    advanceAll(simSeconds) { all.forEach(a => a.advance(simSeconds)); },
    isManual: () => manualMode,
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Anim;
