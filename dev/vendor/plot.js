// ecosystem/plot.js v1.0.0
// Small SVG chart helpers for the tools: nice tick steps, linear scales, axes with
// a grid, points, lines and reference lines. Every helper returns an SVG string, so
// charts can be built and tested in Node. Colours come from the caller's palette
// (app.pal()), so charts follow the theme and print ink on paper. Every ID is
// prefixed with the caller's `idp`, because the report embeds a second copy of each
// drawing (the clipPath lesson from the Shaft and Beam Workbench).
const Plot = (function () {
  'use strict';
  const isNum = v => typeof v === 'number' && isFinite(v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = v => Math.round(v * 100) / 100;              // SVG coordinates to 0.01 px

  // A 1, 2 or 5 × 10ⁿ step that gives about `count` intervals over `span`.
  function niceStep(span, count) {
    count = count || 5;
    if (!(span > 0) || !isNum(span)) return 1;
    const raw = span / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // Widen [lo, hi] to whole steps and list the ticks. Handles lo = hi and reversed input.
  // opts: { count, includeZero }
  function niceDomain(lo, hi, opts) {
    opts = opts || {};
    if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
    if (lo > hi) [lo, hi] = [hi, lo];
    if (opts.includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (lo === hi) { const d = lo === 0 ? 1 : Math.abs(lo) * 0.1; lo -= d; hi += d; }
    const step = niceStep(hi - lo, opts.count);
    const min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let i = 0, v = min; v <= max + step * 1e-6 && i < 1000; i++, v = min + i * step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { min, max, step, ticks };
  }

  // Linear map from data [d0, d1] to pixels [p0, p1], with .invert.
  function scale(d0, d1, p0, p1) {
    const k = d1 === d0 ? 0 : (p1 - p0) / (d1 - d0);
    const f = v => p0 + (v - d0) * k;
    f.invert = p => k === 0 ? d0 : d0 + (p - p0) / k;
    f.domain = [d0, d1]; f.range = [p0, p1];
    return f;
  }

  // Tick label with just enough decimals for the step, a true minus sign and no "-0".
  function fmtTick(v, step) {
    const dec = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
    let s = (Math.abs(v) < step * 1e-9 ? 0 : v).toFixed(dec);
    if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
    return s.replace(/^-/, '−');
  }

  // A plot frame: the plotting box, both scales and the axes, grid, tick labels and
  // axis titles. o: { width, height, margin: {l, r, t, b}, x: [lo, hi], y: [lo, hi],
  // xLabel, yLabel, pal, idp, xCount, yCount, includeZeroY, grid (default true), font }
  function frame(o) {
    const m = Object.assign({ l: 52, r: 14, t: 12, b: 40 }, o.margin || {});
    const W = o.width, H = o.height, p = o.pal || {};
    const ink = p.ink || '#23272C', soft = p.inkSoft || '#555', line = p.line || '#bbb', font = o.font || p.fontUi || 'sans-serif';
    const xd = niceDomain(o.x[0], o.x[1], { count: o.xCount || 6, includeZero: o.includeZeroX });
    const yd = niceDomain(o.y[0], o.y[1], { count: o.yCount || 5, includeZero: o.includeZeroY });
    const box = { x: m.l, y: m.t, w: W - m.l - m.r, h: H - m.t - m.b };
    const sx = scale(xd.min, xd.max, box.x, box.x + box.w), sy = scale(yd.min, yd.max, box.y + box.h, box.y);
    const idp = o.idp || 'pl';
    let svg = '<g class="plot-axes" font-family="' + esc(font) + '" font-size="11">';
    if (o.grid !== false) {
      xd.ticks.forEach(v => { svg += '<line x1="' + r2(sx(v)) + '" y1="' + box.y + '" x2="' + r2(sx(v)) + '" y2="' + (box.y + box.h) + '" stroke="' + line + '" stroke-width="0.6"/>'; });
      yd.ticks.forEach(v => { svg += '<line x1="' + box.x + '" y1="' + r2(sy(v)) + '" x2="' + (box.x + box.w) + '" y2="' + r2(sy(v)) + '" stroke="' + line + '" stroke-width="0.6"/>'; });
    }
    svg += '<rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" fill="none" stroke="' + ink + '" stroke-width="1.2"/>';
    xd.ticks.forEach(v => { svg += '<text x="' + r2(sx(v)) + '" y="' + (box.y + box.h + 15) + '" text-anchor="middle" fill="' + soft + '">' + fmtTick(v, xd.step) + '</text>'; });
    yd.ticks.forEach(v => { svg += '<text x="' + (box.x - 6) + '" y="' + r2(sy(v) + 4) + '" text-anchor="end" fill="' + soft + '">' + fmtTick(v, yd.step) + '</text>'; });
    if (o.xLabel) svg += '<text x="' + r2(box.x + box.w / 2) + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + ink + '" font-size="12">' + esc(o.xLabel) + '</text>';
    if (o.yLabel) svg += '<text transform="translate(12 ' + r2(box.y + box.h / 2) + ') rotate(-90)" text-anchor="middle" fill="' + ink + '" font-size="12">' + esc(o.yLabel) + '</text>';
    svg += '</g>';
    const clipId = idp + '-clip';
    const clipDef = '<clipPath id="' + clipId + '"><rect x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '"/></clipPath>';
    return { svg, defs: clipDef, clip: 'url(#' + clipId + ')', clipId, box, sx, sy, xd, yd };
  }

  // Dots. pts: [[x, y]] (non-finite points are skipped). opts: { r, fill, stroke, shape: 'circle'|'square'|'diamond', title }
  function points(pts, sx, sy, opts) {
    opts = opts || {};
    const r = opts.r || 3.5, fill = opts.fill || '#23272C', stroke = opts.stroke || 'none';
    return pts.filter(q => isNum(q[0]) && isNum(q[1])).map(([x, y]) => {
      const X = r2(sx(x)), Y = r2(sy(y));
      const t = opts.title ? '<title>' + esc(opts.title(x, y)) + '</title>' : '';
      if (opts.shape === 'square') return '<rect x="' + r2(X - r) + '" y="' + r2(Y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" fill="' + fill + '" stroke="' + stroke + '">' + t + '</rect>';
      if (opts.shape === 'diamond') return '<polygon points="' + X + ',' + r2(Y - r * 1.3) + ' ' + r2(X + r * 1.3) + ',' + Y + ' ' + X + ',' + r2(Y + r * 1.3) + ' ' + r2(X - r * 1.3) + ',' + Y + '" fill="' + fill + '" stroke="' + stroke + '">' + t + '</polygon>';
      return '<circle cx="' + X + '" cy="' + Y + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '">' + t + '</circle>';
    }).join('');
  }

  // A polyline through pts, broken wherever a point is not finite. opts: { stroke, width, dash, clip }
  function line(pts, sx, sy, opts) {
    opts = opts || {};
    const runs = []; let cur = [];
    for (const [x, y] of pts) {
      if (isNum(x) && isNum(y)) cur.push(r2(sx(x)) + ',' + r2(sy(y)));
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs.filter(r => r.length > 1).map(r => '<polyline points="' + r.join(' ') + '" fill="none" stroke="' + (opts.stroke || '#23272C') + '" stroke-width="' + (opts.width || 2) + '"' +
      (opts.dash ? ' stroke-dasharray="' + opts.dash + '"' : '') + (opts.clip ? ' clip-path="' + opts.clip + '"' : '') + ' stroke-linejoin="round"/>').join('');
  }

  // Sample f over [x0, x1] for a smooth curve.
  function sample(f, x0, x1, n) {
    n = n || 120;
    const out = [];
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; out.push([x, f(x)]); }
    return out;
  }

  // Horizontal or vertical reference line across the box. o: { axis: 'x'|'y', value, box, sx, sy, stroke, dash, label }
  function refLine(o) {
    const s = o.stroke || '#23272C', d = o.dash || '5 4';
    if (o.axis === 'y') {
      const Y = r2(o.sy(o.value));
      return '<line x1="' + o.box.x + '" y1="' + Y + '" x2="' + (o.box.x + o.box.w) + '" y2="' + Y + '" stroke="' + s + '" stroke-width="1.2" stroke-dasharray="' + d + '"/>' +
        (o.label ? '<text x="' + (o.box.x + 4) + '" y="' + (Y - 4) + '" font-size="11" fill="' + s + '">' + esc(o.label) + '</text>' : '');
    }
    const X = r2(o.sx(o.value));
    return '<line x1="' + X + '" y1="' + o.box.y + '" x2="' + X + '" y2="' + (o.box.y + o.box.h) + '" stroke="' + s + '" stroke-width="1.2" stroke-dasharray="' + d + '"/>' +
      (o.label ? '<text x="' + (X + 4) + '" y="' + (o.box.y + 12) + '" font-size="11" fill="' + s + '">' + esc(o.label) + '</text>' : '');
  }

  // Extent of a list of values, ignoring non-finite ones. Returns [lo, hi] or null.
  function extent(vals) {
    const a = vals.filter(isNum);
    return a.length ? [Math.min.apply(null, a), Math.max.apply(null, a)] : null;
  }

  return { niceStep, niceDomain, scale, fmtTick, frame, points, line, sample, refLine, extent, esc };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Plot;
