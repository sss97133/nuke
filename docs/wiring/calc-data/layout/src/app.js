(function () {
'use strict';
const D = JSON.parse(document.getElementById('data').textContent);
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const WORD = {fixed_by_engine: 'Fixed by the engine', decided: 'Decided', proposed: 'Proposed', open: 'Open', flag: 'Breaks a maker rule'};
const ZONES = {engine: 'Engine bay', firewall: 'Firewall', cab: 'Cab', doors: 'Doors', rear: 'Rear body', underbody: 'Under the truck'};
const CONF = {exact_pn: 'exact part number', same_family_photo: 'sibling part', unknown: 'no photo that can be defended'};
const CONF_LONG = {exact_pn: 'The photo is of this exact part number.', same_family_photo: 'The photo is a sibling or family part, not this exact number.', unknown: 'No photo that can be defended.'};
const NOTDRAWN = {size: 'Size not read', loom: 'In the loom: drawn with the routes', grouped: 'Spot not set', unused: 'Not used'};
const FRONT_AXLE = -1.896, IN = 0.0254;
const items = D.items, byId = Object.fromEntries(items.map(i => [i.id, i]));
const W = D.wires;
const routes = D.routes && D.routes.segments && D.routes.segments.length ? D.routes : null;
const segById = routes ? Object.fromEntries(routes.segments.map(s => [s.id, s])) : {};
const nodeById = routes ? Object.fromEntries(routes.nodes.concat(routes.clips).map(n => [n.id, n])) : {};
const kids = {};
items.forEach(i => { if (i.piece_of) (kids[i.piece_of] = kids[i.piece_of] || []).push(i.id); });
items.forEach(i => { if (i.grouped && !i.piece_of) (kids[i.grouped] = kids[i.grouped] || []).push(i.id); });

// ---------------------------------------------------------------- state (view settings are remembered per viewer)
const S = {view: 'top', mode: '2d', sel: null, hov: null, tab: 'ends', layers: {parts: true, routes: true, clips: true, labels: false},
  op: {body: 45, mech: 70}, colorBy: 'product', f: {q: '', zone: '', sys: '', status: '', drawn: ''}, sort: {key: 'station', dir: 1}, xf: {}};
const KEEP = ['view', 'layers', 'op', 'colorBy', 'tab'];
try { const saved = JSON.parse(localStorage.getItem('k5layout') || '{}'); KEEP.forEach(k => { if (saved[k] != null) S[k] = typeof S[k] === 'object' ? Object.assign(S[k], saved[k]) : saved[k]; }); } catch (e) {}
function keep() { try { const o = {}; KEEP.forEach(k => o[k] = S[k]); localStorage.setItem('k5layout', JSON.stringify(o)); } catch (e) {} }
if (!D.views[S.view]) S.view = 'top';

// ---------------------------------------------------------------- helpers
const fmtIn = v => (v == null ? '?' : (Math.round(v * 10) / 10).toFixed(1));
const mmIn = mm => mm == null ? '' : `${Math.round(mm)} mm (${(mm / 25.4).toFixed(1)} in)`;
function sizeText(fp) {
  if (!fp) return '';
  if (fp.shape === 'disc') return `⌀${fp.d} × ${fp.t} mm`;
  return `${fp.dx} × ${fp.dy} × ${fp.dz} mm`;
}
function statusCell(s) { return `<span class="stt st-${esc(s)}"><i class="sq"></i>${esc(WORD[s] || s)}</span>`; }
function thumb(i, cls) {
  const ph = i.media && i.media.photo;
  return ph && ph.thumb ? `<img src="${ph.thumb}" alt="" loading="lazy" class="${cls || ''}">` : `<span class="noimg" title="no photo yet"></span>`;
}
function drawnWord(i) {
  if (i.drawn === 'own') return i.fp && i.fp.same_as ? 'same part as ' + i.fp.same_as : (i.fp.basis || 'drawn');
  if (i.drawn === 'piece') return 'on ' + i.piece_of;
  return NOTDRAWN[i.why_not] || 'not drawn';
}
function marginText(m) { return m && m.mm != null ? `±${m.mm} mm` : (m && m.cls === 'grouped' ? 'with its group' : 'not measured'); }
function effMargin(i) {
  if (i.margin && i.margin.mm != null) return i.margin;
  if (i.grouped && byId[i.grouped]) return byId[i.grouped].margin;
  return i.margin;
}

// ---------------------------------------------------------------- header
(function header() {
  const c = {}; items.forEach(i => c[i.status] = (c[i.status] || 0) + 1);
  $('#legend').innerHTML = Object.keys(WORD).map(k => `<span class="st-${k}"><i class="sq"></i>${WORD[k]} <b>${c[k] || 0}</b></span>`).join('');
  $('#k-drawn').innerHTML = `<b>${D.counts.drawn}</b> of <b>${D.counts.ends}</b> drawn to size`;
  const nseg = routes ? routes.segments.length : 0;
  $('#k-routes').innerHTML = routes ? `<b>${nseg}</b> route segments <span class="muted">(${esc((routes.scope || '').split(':')[0])}, proposal)</span>` : `<span class="muted">Routes: none yet</span>`;
})();

// ---------------------------------------------------------------- canvas
const vp = $('#vp'), world = $('#world'), ov = $('#ov'), tip = $('#tip');
const V = () => D.views[S.view];
function fitXf() {
  const r = vp.getBoundingClientRect(), v = V();
  const k = Math.max(0.02, Math.min(r.width / v.w, r.height / v.h)) * 0.98;
  return {k, tx: (r.width - v.w * k) / 2, ty: (r.height - v.h * k) / 2, fit: k};
}
function xf() { return S.xf[S.view] || (S.xf[S.view] = fitXf()); }
let settleT = 0;
function applyXf(settle) {
  const t = xf();
  world.style.transform = `translate(${t.tx}px,${t.ty}px) scale(${t.k})`;
  ov.style.setProperty('--k', t.k);
  const mmPerPx = 1000 / (V().ppm * t.k);
  $('#scale').textContent = `1 screen px = ${mmPerPx < 10 ? mmPerPx.toFixed(1) : Math.round(mmPerPx)} mm`;
  clearTimeout(settleT);
  if (settle !== false) settleT = setTimeout(drawSvg, 90);
}
function zoomAt(f, sx, sy) {
  const t = xf(), fit = fitXf().k;
  const k2 = Math.min(fit * 60, Math.max(fit * 0.6, t.k * f));
  const wx = (sx - t.tx) / t.k, wy = (sy - t.ty) / t.k;
  t.k = k2; t.tx = sx - wx * k2; t.ty = sy - wy * k2;
  applyXf();
}
function centreOn(u, v, minK) {
  const r = vp.getBoundingClientRect(), t = xf();
  if (minK && t.k < minK) t.k = minK;
  t.tx = r.width / 2 - u * t.k; t.ty = r.height / 2 - v * t.k;
  applyXf();
}
function inViewport(u, v) {
  const r = vp.getBoundingClientRect(), t = xf();
  const sx = u * t.k + t.tx, sy = v * t.k + t.ty;
  return sx > 30 && sy > 30 && sx < r.width - 30 && sy < r.height - 30;
}
function setView(v, keepSel) {
  S.view = v; keep();
  pressViews();
  const vw = V();
  world.style.width = vw.w + 'px'; world.style.height = vw.h + 'px';
  $('#lyr-body').src = vw.layers.body; $('#lyr-mech').src = vw.layers.mech;
  ov.setAttribute('viewBox', `0 0 ${vw.w} ${vw.h}`);
  $('#viewcap').textContent = vw.caption;
  applyOpacity(); applyXf(false); drawSvg();
}
function pressViews() {
  document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-pressed', S.mode === '3d' ? b.dataset.view === '3d' : b.dataset.view === S.view));
}
function setMode(m) {
  S.mode = m;
  world.hidden = m === '3d'; $('#v3d').hidden = m !== '3d'; tip.hidden = true;
  $('#viewcap').textContent = m === '3d' ? '3D engine bay, harness-cad sample (glTF from ' + (D.glb ? D.glb.from + ', ' + D.glb.made : '') + ').' : V().caption;
  pressViews();
  $('#scale').hidden = m === '3d'; $('#cursor').textContent = m === '3d' ? '3D bay: drag to turn, right-drag to pan, scroll to zoom' : '\u00a0';
  if (m === '3d') { T3.start(); T3.apply(); T3.loop(); }
}
function applyOpacity() {
  $('#lyr-body').style.opacity = S.op.body / 100; $('#lyr-mech').style.opacity = S.op.mech / 100;
  $('#op-body').value = S.op.body; $('#op-mech').value = S.op.mech;
  $('#op-body-o').textContent = S.op.body + '%'; $('#op-mech-o').textContent = S.op.mech + '%';
  if (typeof T3 !== 'undefined') T3.apply();
}
function toWorld(u, v) {
  const vw = V(), c = vw.cam, p = vw.ppm;
  const y = c.cy + (u - vw.w / 2) / p;
  if (S.view === 'side') return {y, z: c.cz - (v - vw.h / 2) / p};
  return {y, x: c.cx + (v - vw.h / 2) / p};
}

// ticks along the drawing edges: stations every 10 in (5 in in the bay), labels every other tick
function ticksSvg(vw, k) {
  const p = vw.ppm, L1 = 14 / k, L2 = 8 / k, T = 24 / k, X = 3 / k;
  const inScreen = IN * p * k;                      // screen px per inch at this zoom
  const step = [1, 2, 5, 10, 20, 50].find(s => s * 2 * inScreen >= 46) || 100, lab = step * 2;
  let o = '<g class="tick">';
  const u0 = vw.w / 2 + (FRONT_AXLE - vw.cam.cy) * p;
  const inPx = IN * p;
  for (let s = Math.ceil(-u0 / inPx / step) * step; u0 + s * inPx <= vw.w; s += step) {
    const u = u0 + s * inPx, big = s % lab === 0;
    o += `<line x1="${u}" y1="0" x2="${u}" y2="${big ? L1 : L2}"/>`;
    if (big) o += `<text x="${u + X}" y="${T}">${s}</text>`;
  }
  if (S.view === 'side') {
    const v0 = vw.h / 2 + vw.cam.cz * p;
    for (let s = 0; v0 - s * inPx >= 0; s += step) {
      const v = v0 - s * inPx, big = s % lab === 0;
      o += `<line x1="0" y1="${v}" x2="${big ? L1 : L2}" y2="${v}"/>`;
      if (big) o += `<text x="${17 / k}" y="${v + 4 / k}">${s}</text>`;
    }
  } else {
    const v0 = vw.h / 2 - vw.cam.cx * p;
    for (let s = Math.ceil(-v0 / inPx / step) * step; v0 + s * inPx <= vw.h; s += step) {
      const v = v0 + s * inPx, big = s % lab === 0;
      o += `<line x1="0" y1="${v}" x2="${big ? L1 : L2}" y2="${v}"/>`;
      if (big) o += `<text x="${17 / k}" y="${v + 4 / k}">${s === 0 ? 'CL' : (s > 0 ? s + ' D' : -s + ' P')}</text>`;
    }
  }
  return o + '</g>';
}
function shape(g, cls, extra) {
  const e = extra || '';
  if (g.round) return `<ellipse class="${cls}" cx="${g.cx}" cy="${g.cy}" rx="${g.w / 2}" ry="${g.h / 2}" ${e}/>`;
  const r = Math.min(g.w, g.h) * 0.12;
  return `<rect class="${cls}" x="${g.cx - g.w / 2}" y="${g.cy - g.h / 2}" width="${g.w}" height="${g.h}" rx="${r}" ${e}/>`;
}
function selectedItem() { return S.sel && byId[S.sel] ? byId[S.sel] : null; }
function drawnTarget(i) { return i ? (i.drawn === 'piece' ? byId[i.piece_of] : (i.drawn === 'own' ? i : null)) : null; }

function drawSvg() {
  const vw = V(), t = xf(), k = t.k, v = S.view;
  const sel = selectedItem(), selDrawn = drawnTarget(sel);
  let o = ticksSvg(vw, k) + '<g class="axis">';
  vw.axes.forEach((a, ix) => {
    o += `<line x1="${a.u}" y1="${30 / k}" x2="${a.u}" y2="${vw.h}"/><text x="${a.u + 4 / k}" y="${vw.h - (ix % 2 ? 24 : 8) / k}">${esc(a.label)} ${a.station_in} IN</text>`;
  });
  o += '</g>';
  (D.context || []).forEach(c => {
    const g = c.draw[v]; if (!g) return;
    const isSel = S.sel === c.id;
    o += `<g class="ctx${isSel ? ' sel' : ''}" data-ctx="${esc(c.id)}">${shape(g, 'b', 'style="pointer-events:all"')}<text x="${g.cx - g.w / 2 + 6 / k}" y="${g.cy - g.h / 2 + 14 / k}">${esc(c.label.toUpperCase())}${c.calls && c.calls.length ? ' \u00b7 OPEN CALL' : ''}</text></g>`;
  });
  if (S.layers.parts) {
    const list = items.filter(i => i.drawn === 'own' && i.draw && i.draw[v]).sort((a, b) => b.draw[v].w * b.draw[v].h - a.draw[v].w * a.draw[v].h);
    list.forEach(i => {
      const g = i.draw[v];
      const byStatus = S.colorBy === 'status';
      const fill = byStatus ? 'var(--c)' : (g.fill || 'var(--faint)');
      const isSel = selDrawn && selDrawn.id === i.id;
      const twin = i.fp && /twin|model/.test(i.fp.basis || '');
      const hitR = Math.max(g.w, g.h, 12 / k) / 2;
      o += `<g class="part st-${i.status}${isSel ? ' sel' : ''}${twin ? ' twin' : ''}${S.hov === i.id ? ' hov' : ''}" data-id="${esc(i.id)}">`
        + `<circle cx="${g.cx}" cy="${g.cy}" r="${hitR}" fill="transparent"/>`
        + shape(g, 'b', `style="fill:${fill}${byStatus ? ';fill-opacity:.85' : ''}"`) + '</g>';
    });
  }
  if (routes && S.layers.routes) {
    const offsetPts = (pts, d) => pts.map((p, ix) => {               // a copy of a polyline moved sideways by d image px
      const a = pts[Math.max(0, ix - 1)], b = pts[Math.min(pts.length - 1, ix + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [p[0] - dy / L * d, p[1] + dx / L * d];
    });
    routes.segments.forEach(s => {
      const P = s.px[v] || []; if (P.length < 2) return;
      const wpx = Math.max((s.od_mm || 6) / 1000 * vw.ppm, 0.4);
      const isSel = S.sel === 'seg:' + s.id;
      const bad = s.conflict || s.checks_failed > 0 || /conflict/i.test(s.why || '');
      const off = ((s.od_mm || 6) / 2 + 2) / 1000 * vw.ppm;
      const lines = (s.parallel || 1) > 1 ? [offsetPts(P, off), offsetPts(P, -off)] : [P];
      const col = /DC PRIMARY|POWER/i.test(s.bundle || '') ? 'var(--rt-dc)' : 'var(--rt-eng)';
      let g = '';
      lines.forEach(L => {
        const pts = L.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        g += `<polyline class="core" points="${pts}" style="stroke:${col}" stroke-width="${wpx}"/><polyline class="ctr" points="${pts}"/>`;
        if (bad) g += `<polyline class="flagln" points="${pts}"/>`;
      });
      const hit = P.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      o += `<g class="rt${isSel ? ' sel' : ''}${bad ? ' bad' : ''}" data-seg="${esc(s.id)}">${g}<polyline points="${hit}" fill="none" stroke="transparent" stroke-width="${Math.max(wpx * 2, 12 / k)}"/></g>`;
    });
    // where harness-cad's route lands away from the end's own spot, draw the gap
    routes.nodes.forEach(n => {
      const p = n.px[v], e = n.ep && byId[n.ep]; if (!p || !e || n.gap_mm == null) return;
      const m = effMargin(e), lim = Math.max(50, (m && m.mm) || 0);
      const t = drawnTarget(e), g = t && t.draw && t.draw[v];
      const q = g ? [g.cx, g.cy] : e.px[v];
      if (n.gap_mm > lim && q) o += `<line class="gapln" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"><title>${esc(n.id)}: route lands ${n.gap_mm} mm from ${esc(e.id)}'s spot</title></line>`;
    });
  }
  if (routes && S.layers.clips) {
    routes.nodes.concat(routes.clips).forEach(n => {
      const p = n.px[v]; if (!p) return;
      const r = 3.5 / k, isSel = S.sel === 'node:' + n.id;
      const kind = n.kind || (n.segment ? 'clip' : 'node');
      let g;
      const sz = n.size_mm || (n.d_mm ? [n.d_mm, n.d_mm, n.d_mm] : null);
      if (sz) {                                         // true size when harness-cad gives one: [dx, dy, dz] mm
        const pp = vw.ppm / 1000, w = sz[1] * pp, h = (v === 'side' ? sz[2] : sz[0]) * pp;
        g = n.d_mm ? `<ellipse class="b" cx="${p[0]}" cy="${p[1]}" rx="${w / 2}" ry="${h / 2}" style="fill:var(--panel)"/>`
                   : `<rect class="b" x="${p[0] - w / 2}" y="${p[1] - h / 2}" width="${w}" height="${h}" style="fill:var(--panel)"/>`;
      } else if (kind === 'clip') g = `<rect class="b" x="${p[0] - r}" y="${p[1] - r}" width="${2 * r}" height="${2 * r}" style="fill:var(--panel)"/>`;
      else if (kind === 'splice') g = `<circle class="b" cx="${p[0]}" cy="${p[1]}" r="${r}" style="fill:var(--ink)"/>`;
      else if (kind === 'grommet') g = `<circle class="b" cx="${p[0]}" cy="${p[1]}" r="${r * 1.3}" fill="none" stroke-width="2"/>`;
      else g = `<path class="b" d="M${p[0]} ${p[1] - r * 1.3}L${p[0] + r * 1.3} ${p[1]}L${p[0]} ${p[1] + r * 1.3}L${p[0] - r * 1.3} ${p[1]}Z" style="fill:var(--panel)"/>`;
      o += `<g class="nd${isSel ? ' sel' : ''}" data-node="${esc(n.id)}"><circle cx="${p[0]}" cy="${p[1]}" r="${8 / k}" fill="transparent"/>${g}</g>`;
    });
  }
  if (S.layers.labels && S.layers.parts) {
    items.filter(i => i.drawn === 'own' && i.draw && i.draw[v]).forEach(i => {
      const g = i.draw[v];
      o += `<text class="lbl" x="${g.cx + g.w / 2 + 3 / k}" y="${g.cy + 3.5 / k}">${esc(i.id)}</text>`;
    });
  }
  // selection: glow and pulse on the part, its margin, or a crosshair where an undrawn end sits
  if (sel) {
    const m = effMargin(sel), mpx = m && m.mm != null ? m.mm / 1000 * vw.ppm : null;
    const g = selDrawn && selDrawn.draw && selDrawn.draw[v];
    const pos = sel.px[v];
    if (g) {
      const pad = 5 / k;
      o += shape({cx: g.cx, cy: g.cy, w: g.w + 2 * pad, h: g.h + 2 * pad, round: g.round}, 'halo', '');
      if (mpx) o += `<circle class="mg" cx="${g.cx}" cy="${g.cy}" r="${mpx}"/>`;
    } else if (pos) {
      const L = Math.max(mpx || 0, 60 / 1000 * vw.ppm) * 1.35;
      o += `<line class="xh" x1="${pos[0] - L}" y1="${pos[1]}" x2="${pos[0] + L}" y2="${pos[1]}"/><line class="xh" x1="${pos[0]}" y1="${pos[1] - L}" x2="${pos[0]}" y2="${pos[1] + L}"/>`;
      if (mpx) o += `<circle class="mg" cx="${pos[0]}" cy="${pos[1]}" r="${mpx}"/>`;
      o += `<text class="lbl" x="${pos[0] + 6 / k}" y="${pos[1] - 6 / k}">${esc(sel.id)} (not drawn)</text>`;
    }
  }
  ov.innerHTML = o;
  ov.classList.toggle('has-sel', !!S.sel);
}

// pointer: drag pans, wheel zooms, two fingers pinch; a click without a drag selects
const ptrs = new Map();
let drag = null, pinch = null;
vp.addEventListener('pointerdown', e => {
  if (S.mode === '3d') return;
  vp.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (ptrs.size === 1) { const t = xf(); drag = {x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty, moved: false, target: e.target}; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = {d: Math.hypot(a.x - b.x, a.y - b.y)}; drag = null; }
});
vp.addEventListener('pointermove', e => {
  if (S.mode === '3d') return;
  const r = vp.getBoundingClientRect(), t = xf();
  const u = (e.clientX - r.left - t.tx) / t.k, v = (e.clientY - r.top - t.ty) / t.k;
  const w = toWorld(u, v), sta = (w.y - FRONT_AXLE) / IN;
  $('#cursor').textContent = S.view === 'side'
    ? `STA ${fmtIn(sta)} in   Z ${fmtIn(w.z / IN)} in`
    : `STA ${fmtIn(sta)} in   ${fmtIn(Math.abs(w.x / IN))} in ${w.x > 0.0005 ? 'driver' : w.x < -0.0005 ? 'passenger' : 'CL'}`;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d; return;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; vp.classList.add('panning'); tip.hidden = true; }
    if (drag.moved) { t.tx = drag.tx + dx; t.ty = drag.ty + dy; applyXf(false); return; }
  }
  hover(e);
});
function endPtr(e) {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (drag && !drag.moved && e.type === 'pointerup') {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const p = hit && hit.closest && hit.closest('.part, .rt, .nd, .ctx');
    if (p) {
      if (p.dataset.id) select(p.dataset.id, 'canvas');
      else if (p.dataset.seg) select('seg:' + p.dataset.seg, 'canvas');
      else if (p.dataset.ctx) select(p.dataset.ctx, 'canvas');
      else { const n = nodeById[p.dataset.node]; select(n && n.ep && byId[n.ep] ? n.ep : 'node:' + p.dataset.node, 'canvas'); }
    }
  }
  if (drag && drag.moved) applyXf();
  drag = null; vp.classList.remove('panning');
}
vp.addEventListener('pointerup', endPtr);
vp.addEventListener('pointercancel', endPtr);
vp.addEventListener('pointerleave', () => { tip.hidden = true; setHov(null); });
vp.addEventListener('wheel', e => { if (S.mode === '3d') return; e.preventDefault(); const r = vp.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, {passive: false});
vp.addEventListener('dblclick', e => { if (S.mode === '3d') return; const r = vp.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
function hover(e) {
  const el = e.target.closest && e.target.closest('.part, .rt, .nd, .ctx');
  if (!el) { tip.hidden = true; setHov(null); return; }
  const r = vp.getBoundingClientRect();
  let html = '';
  if (el.dataset.id) {
    const i = byId[el.dataset.id];
    html = `<b>${esc(i.what)}</b><span class="mono">${esc(i.id)} · ${esc(sizeText(i.fp))}</span>`;
    setHov(i.id);
  } else if (el.dataset.seg) {
    const s = segById[el.dataset.seg];
    html = `<b>${esc(s.id)} · ${esc(s.bundle || '')}</b><span class="mono">${(s.wires || []).length} wires · ⌀${esc(s.od_mm)} mm${(s.parallel || 1) > 1 ? ' ×' + s.parallel : ''} · ${esc(s.length_m)} m ±${esc(s.margin_mm)} mm${s.checks_failed ? ' · ' + s.checks_failed + ' check not passed' : ''}</span>`;
  } else if (el.dataset.ctx) {
    const c = (D.context || []).find(x => x.id === el.dataset.ctx);
    html = `<b>${esc(c ? c.label : '')}</b><span class="mono">context from the body model${c && c.calls && c.calls.length ? ' · open call' : ''}</span>`;
  } else {
    const n = nodeById[el.dataset.node];
    html = `<b>${esc((n.kind || 'clip') + ' ' + n.id)}</b><span class="mono">${esc(n.pn || 'part number not set')}${n.ep ? ' · lands on ' + esc(n.ep) : ''}${n.gap_mm != null ? ' · ' + n.gap_mm + ' mm from its spot' : ''}</span>`;
  }
  tip.innerHTML = html; tip.hidden = false;
  const x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  tip.style.left = Math.min(x, r.width - 310) + 'px'; tip.style.top = Math.min(y, r.height - 60) + 'px';
}
function setHov(id) {
  if (S.hov === id) return;
  S.hov = id;
  ov.querySelectorAll('.part.hov').forEach(n => n.classList.remove('hov'));
  if (id) { const n = ov.querySelector(`.part[data-id="${CSS.escape(id)}"]`); if (n) n.classList.add('hov'); }
}
new ResizeObserver(() => { const t = S.xf[S.view]; if (!t || Math.abs(t.k - t.fit) < 1e-9) { S.xf[S.view] = fitXf(); } applyXf(); }).observe(vp);

// toolbar
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => { if (b.dataset.view === '3d') setMode('3d'); else { if (S.mode === '3d') setMode('2d'); setView(b.dataset.view); } }));
[['parts', '#ly-parts'], ['routes', '#ly-routes'], ['clips', '#ly-clips'], ['labels', '#ly-labels']].forEach(([k, s]) => {
  const el = $(s); el.checked = S.layers[k];
  el.addEventListener('change', () => { S.layers[k] = el.checked; keep(); drawSvg(); if (typeof T3 !== 'undefined') T3.apply(); });
});
if (!routes) {
  ['#ly-routes', '#ly-clips'].forEach(s => { $(s).disabled = true; $(s).checked = false; });
  ['#ly-routes-l', '#ly-clips-l'].forEach(s => { $(s).classList.add('off'); $(s).title = 'No routes yet: harness-cad is routing every bundle in Blender. They show here when they land.'; });
}
['body', 'mech'].forEach(k => $('#op-' + k).addEventListener('input', e => { S.op[k] = +e.target.value; applyOpacity(); keep(); }));
document.querySelectorAll('#colorby button').forEach(b => b.addEventListener('click', () => {
  S.colorBy = b.dataset.c; keep();
  document.querySelectorAll('#colorby button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawSvg();
}));
document.querySelectorAll('#colorby button').forEach(x => x.setAttribute('aria-pressed', x.dataset.c === S.colorBy));
$('#z-in').addEventListener('click', () => { if (S.mode === '3d') return T3.zoom(1.4); const r = vp.getBoundingClientRect(); zoomAt(1.6, r.width / 2, r.height / 2); });
$('#z-out').addEventListener('click', () => { if (S.mode === '3d') return T3.zoom(1 / 1.4); const r = vp.getBoundingClientRect(); zoomAt(1 / 1.6, r.width / 2, r.height / 2); });
$('#z-fit').addEventListener('click', () => { if (S.mode === '3d') return T3.fit(); S.xf[S.view] = fitXf(); applyXf(); });
$('#z-sel').addEventListener('click', () => S.mode === '3d' ? T3.frame() : frameSel());
function frameSel() {
  if (S.sel && (S.sel.startsWith('seg:') || S.sel.startsWith('node:'))) {
    const pts = S.sel.startsWith('seg:') ? ((segById[S.sel.slice(4)] || {}).px || {})[S.view] || [] : [((nodeById[S.sel.slice(5)] || {}).px || {})[S.view]].filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), r = vp.getBoundingClientRect(), vw = V();
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.3 * vw.ppm) * 1.6;
    const t = xf(); t.k = Math.min(Math.max(Math.min(r.width, r.height) / span, fitXf().k), fitXf().k * 60);
    centreOn((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2); return;
  }
  const i = selectedItem(); if (!i) return;
  const tgt = drawnTarget(i), g = tgt && tgt.draw && tgt.draw[S.view], p = i.px[S.view];
  if (!g && !p) return;
  const r = vp.getBoundingClientRect(), m = effMargin(i), vw = V();
  const span = Math.max(g ? Math.max(g.w, g.h) : 0, (m && m.mm ? m.mm * 2 : 300) / 1000 * vw.ppm) * 3.2;
  const k = Math.min(r.width, r.height) / span;
  const t = xf(); t.k = Math.min(Math.max(k, fitXf().k), fitXf().k * 60);
  centreOn(g ? g.cx : p[0], g ? g.cy : p[1]);
}
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
  if (e.key === 'Escape') select(null);
  else if (e.key === 'f' || e.key === 'F') (S.mode === '3d' ? T3.frame() : frameSel());
  else if (e.key === '1') setView('top'); else if (e.key === '2') setView('side'); else if (e.key === '3') setView('bay');
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...document.querySelectorAll('#grid tbody tr[data-id]')];
    if (!rows.length) return;
    const ix = rows.findIndex(r => r.dataset.id === S.sel);
    const nx = rows[Math.max(0, Math.min(rows.length - 1, ix + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (nx) { e.preventDefault(); select(nx.dataset.id, 'grid'); }
  }
});

// ---------------------------------------------------------------- selection
function select(id, from) {
  S.sel = id;
  if (id && !/^(seg|node|ctx):/.test(id)) {
    const i = byId[id];
    if (i) {
      const tgt = drawnTarget(i);
      const has = v => (tgt && tgt.draw && tgt.draw[v]) || i.px[v];
      if (!has(S.view)) { const nv = ['bay', 'top', 'side'].find(v => has(v) && (v !== 'bay' || i.zone === 'engine' || i.zone === 'firewall')) || ['top', 'side'].find(has); if (nv) setView(nv, true); }
      const g = tgt && tgt.draw && tgt.draw[S.view], p = i.px[S.view];
      const c = g ? [g.cx, g.cy] : p;
      if (c && !inViewport(c[0], c[1])) centreOn(c[0], c[1]);
    }
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
  }
  drawSvg(); renderInspector(); markRow(from);
  if (S.mode === '3d') T3.apply();
}
function markRow(from) {
  const wrap = $('#gridwrap');
  wrap.querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel', 'flash'));
  if (!S.sel) return;
  const row = wrap.querySelector(`tr[data-id="${CSS.escape(S.sel)}"]`);
  if (!row) return;
  row.classList.add('sel');
  void row.offsetWidth; row.classList.add('flash');
  if (from !== 'grid') {
    const th = wrap.querySelector('thead'), top = row.offsetTop - (th ? th.offsetHeight : 0);
    if (top < wrap.scrollTop || top + row.offsetHeight > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = top - wrap.clientHeight / 3;
  }
}

// ---------------------------------------------------------------- inspector
function linkEnd(id) { return byId[id] ? `<button type="button" class="linkish mono" data-go="${esc(id)}">${esc(id)}</button>` : `<span class="mono">${esc(id)}</span>`; }
function extLink(u, label) { return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label)}</a>` : ''; }
function wireRows(i) {
  if (!i.w || !i.w.length) return '<p class="muted" style="margin:0">No wires recorded on this end in the registry.</p>';
  const rows = i.w.map(x => {
    const w = W[x.id] || {id: x.id};
    const other = (w.ends || []).filter(e => e !== i.id);
    const otherTxt = other.length ? other.map(linkEnd).join(' ') : `<span class="muted">${esc(w.frm && !String(w.frm).startsWith(i.id) ? w.frm : w.to || '')}</span>`;
    const cav = x.cav ? String(x.cav).split(' — ')[0] : '';
    return `<tr class="${w.kind === 'implied' ? 'imp' : ''}"><td class="mono">${esc(cav)}</td><td class="mono">${esc(x.id)}</td><td class="mono">${esc(w.gauge || (w.awg ? w.awg + ' AWG' : ''))}</td>`
      + `<td class="mono">${esc(w.spec || '')}</td><td>${esc(w.color || '')}</td><td>${otherTxt}</td></tr>`;
  }).join('');
  const nImp = i.w.filter(x => (W[x.id] || {}).kind === 'implied').length;
  return `<div class="wtwrap"><table class="wt"><thead><tr><th>Cav</th><th>Wire</th><th>Gauge</th><th>Spec</th><th>Colour</th><th>Other end</th></tr></thead><tbody>${rows}</tbody></table></div>`
    + (nImp ? `<p class="fine">${nImp} of ${i.w.length} are implied wires (required by a decision after cut list v4.2, not yet in a wire list), shown lighter.</p>` : '');
}
function photoBlock(i) {
  const m = i.media || {}, ph = m.photo;
  const conf = m.confidence || 'unknown';
  if (ph && ph.src) {
    return `<div class="photo"><img src="${esc(ph.src)}" alt="${esc(m.what || i.what)}"></div>`
      + `<div class="pcap"><span class="conf ${esc(conf)}">${esc(CONF[conf] || conf)}</span> ${esc(CONF_LONG[conf] || '')} ${extLink(ph.page, 'Photo page')}${ph.fetched ? ' · fetched ' + esc(ph.fetched) : ''}${m.photo_note ? '<span class="src">' + esc(m.photo_note) + '</span>' : ''}</div>`;
  }
  if (ph && ph.url) return `<div class="photo none">Photo not downloaded: its host blocks scripted downloads</div><div class="pcap">${extLink(ph.page || ph.url, 'Open the photo page')}</div>`;
  return `<div class="photo none">No photo yet</div>`;
}
function sizeBlock(i) {
  const fp = i.fp;
  if (i.drawn === 'piece') {
    const p = byId[i.piece_of];
    return `<dl class="kv"><dt>Drawn as</dt><dd>part of ${linkEnd(i.piece_of)} (${esc(p.what)})</dd><dt>Size</dt><dd class="mono">${esc(sizeText(p.fp))}</dd><dt>Size from</dt><dd>${esc(p.fp.size)}</dd></dl>`;
  }
  if (!fp) {
    return `<dl class="kv"><dt>Drawn</dt><dd>No. ${esc(NOTDRAWN[i.why_not] || '')}.</dd><dt>Why</dt><dd>${esc(i.why_not_text || '')}</dd></dl>`;
  }
  const col = [fp.top, fp.side].filter((c, ix, a) => c && a.indexOf(c) === ix).map(c => `<i class="sw" style="background:${esc(c)}"></i> <span class="mono">${esc(c)}</span>`).join(' ');
  return `<dl class="kv"><dt>Envelope</dt><dd class="mono">${esc(sizeText(fp))}${fp.shape === 'disc' ? ' (round face looks along ' + esc(fp.axis) + ')' : ' (across, along, up)'}</dd>`
    + `<dt>Size from</dt><dd>${esc(fp.size || '')}${fp.same_as ? ' (same part as ' + esc(fp.same_as) + ')' : ''}</dd>`
    + `<dt>Colour</dt><dd>${col || 'not read'} <span class="src">${esc(fp.color || '')}</span></dd>`
    + `<dt>Orientation</dt><dd>${esc(fp.orient || 'drawn, not decided')}</dd><dt>Record</dt><dd class="muted">${esc(fp.from || '')}</dd></dl>`;
}
const usd = v => '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
function staleWord(p) { return p.age == null ? 'date not recorded' : (p.age > D.stale_days ? `stale, ${p.age} days old` : `${p.age} ${p.age === 1 ? 'day' : 'days'} old`); }
function routeBlock(i) {
  if (!routes) return '';
  const rn = i.route_nodes || [];
  if (!rn.length) return `<div class="sect"><h3>Route</h3><p class="fine" style="margin:0">No route lands on this end yet. harness-cad's routes cover the ${esc(routes.scope || 'first part of the truck')}.</p></div>`;
  const segs = (i.route_segs || []).map(sid => `<button type="button" class="linkish mono" data-go="seg:${esc(sid)}">${esc(sid)}</button>`).join(' ');
  const m = effMargin(i), lim = Math.max(50, (m && m.mm) || 0);
  return `<div class="sect"><h3>Route</h3><dl class="kv"><dt>Segments</dt><dd>${segs || '<span class="muted">none</span>'}</dd>
    <dt>Lands at</dt><dd>${rn.map(n => `<button type="button" class="linkish mono" data-go="node:${esc(n.id)}">${esc(n.id)}</button> <span class="${n.gap_mm > lim ? 'warn' : 'muted'}">${n.gap_mm} mm from the drawn spot</span>`).join('<br>')}</dd></dl>
    ${rn.some(n => n.gap_mm > lim) ? `<p class="fine warn">harness-cad's route and the pieces lane's pos.py put this end more than its margin apart. One of them needs to move.</p>` : ''}</div>`;
}
function costBlock(i) {
  const c = i.cost || {}, b = i.buy || {};
  const list = (c.list || []).map(p => `<span class="mono">${usd(p.usd)}</span> ${esc(p.unit)} at ${p.url ? extLink(p.url, p.vendor) : esc(p.vendor)} <span class="${p.age > D.stale_days ? 'warn' : 'muted'}">${esc(staleWord(p))}</span><span class="src">${esc(p.src)}</span>`).join('<br>');
  const kit = c.kit || [];
  const kitTot = kit.reduce((s, k) => s + (k.usd != null ? k.usd * k.qty : 0), 0), kitKnown = kit.filter(k => k.usd != null).length;
  const kitHtml = kit.length ? kit.map(k => `<span class="mono">${esc(k.code)}</span> × ${esc(k.qty)} ${k.usd != null ? '<span class="mono">' + usd(k.usd) + '</span> each' : '<span class="muted">price not read</span>'}`).join('<br>')
    + (kitKnown ? `<span class="src">${kitKnown} of ${kit.length} priced, ${usd(kitTot)} (parts.yaml prices)</span>` : '') : '<span class="muted">none in the registry</span>';
  const pages = [...new Set((c.list || []).map(p => p.url).filter(Boolean).concat(i.media && i.media.photo && i.media.photo.page ? [i.media.photo.page] : []))];
  return `<div class="sect"><h3>Cost and ordering</h3><dl class="kv">
    <dt>Status</dt><dd>${esc(b.status || 'unknown')}${b.evidence ? `<span class="src">"${esc(b.evidence.text)}" (${esc(b.evidence.src)})</span>` : '<span class="src">no record says</span>'}</dd>
    <dt>List price</dt><dd>${list || '<span class="muted">no public price on file</span>'}</dd>
    <dt>You paid</dt><dd>${c.paid ? esc(c.paid.shown) + '<span class="src">the amount stays in the database and shows masked here</span>' : '<span class="muted">no order record on file</span>'}</dd>
    <dt>Plug kit</dt><dd>${kitHtml}</dd>
    <dt>Buy</dt><dd>${pages.length ? pages.map(u => extLink(u, u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])).join(' · ') : '<span class="muted">no vendor page on file</span>'}<span class="src">${esc(D.referral)}</span></dd></dl></div>`;
}
function workBlock(i) {
  const w = i.work || {};
  const st = (w.stages || []).map(s => `<tr><td>${esc(s.stage)}</td><td class="mono ${s.state === 'done' || s.state === 'owner call' ? 'ok' : s.state === 'not yet' ? 'warn' : 'muted'}">${esc(s.state)}</td><td>${esc(s.ev)}</td></tr>`).join('');
  return `<div class="sect"><h3>Who is on it</h3><dl class="kv">
    <dt>Design</dt><dd>${(w.design || []).map(d => `<span class="mono">${esc(d.who)}</span> ${esc(d.what)}<span class="src">${esc(d.file || '')}</span>`).join('')}</dd>
    <dt>Build</dt><dd>${esc(w.build || 'unassigned')}<span class="src">${esc(D.builder_note)}</span></dd></dl>
    <div class="wtwrap" style="margin-top:6px"><table class="wt"><thead><tr><th>Stage</th><th>State</th><th>On file</th></tr></thead><tbody>${st}</tbody></table></div>
    <p class="fine">Read from the records' own words; "unknown" where no record says. Talk to the agents about this part in the note box below.</p></div>`;
}
function renderInspector() {
  const el = $('#insp-body');
  if (S.sel && S.sel.startsWith('seg:')) { renderSeg(el, segById[S.sel.slice(4)]); renderFoot(); return; }
  if (S.sel && S.sel.startsWith('node:')) { renderNode(el, nodeById[S.sel.slice(5)]); renderFoot(); return; }
  if (S.sel && S.sel.startsWith('ctx:')) { renderCtx(el, (D.context || []).find(c => c.id === S.sel)); renderFoot(); return; }
  const i = selectedItem();
  if (!i) { el.innerHTML = `<div class="sect"><h3>Nothing selected</h3><p class="muted" style="margin:0">Pick a part on the drawing or a row in the table.</p></div>`; renderFoot(); return; }
  const m = i.media || {}, reg = i.reg || {}, st = i.st, mg = effMargin(i);
  const mates = (m.mates_with || []).map(x => linkEnd(String(x))).join(' ');
  const links = [m.drawing && extLink(m.drawing.url || m.drawing.page, 'Maker drawing'), m.datasheet && extLink(m.datasheet, 'Datasheet'),
    m.instructions && extLink(typeof m.instructions === 'string' ? m.instructions : (m.instructions.url || ''), 'Instructions'),
    m.cad && extLink(m.cad.url, '3D model (' + (m.cad.format || 'CAD') + ')')].filter(Boolean).join(' · ');
  const kidsHtml = kids[i.id] ? `<dt>Sits with it</dt><dd>${kids[i.id].map(linkEnd).join(' ')}</dd>` : '';
  const cc = reg.cavity_count;
  const cavTxt = cc == null ? '' : (typeof cc === 'object' ? Object.keys(cc).length + ' cavities mapped' : cc + ' cavities');
  const why = (i.why || []).map(w => `<li>${esc(w.text)}<span class="src">${esc(w.source)}</span></li>`).join('');
  const open = (i.open || []).concat((reg.open || []).map(o => 'Registry: ' + o));
  const srcs = (reg.sources || []).map(s => `<li>${esc(s)}</li>`).join('');
  el.innerHTML = `
  <div class="sect">${photoBlock(i)}</div>
  <div class="sect">
    <div class="idline"><span class="mono">${esc(i.id)}</span><span class="stword st-${esc(i.status)}"><i class="sq"></i>${esc(WORD[i.status] || i.status)}</span><span class="muted">${esc(ZONES[i.zone] || i.zone)} · ${esc(i.sys)}</span></div>
    <h2>${esc(i.what)}</h2>
    <dl class="kv" style="margin-top:8px"><dt>Maker</dt><dd>${esc(m.maker || 'not recorded')}</dd><dt>Part number</dt><dd class="mono">${esc(m.maker_pn || 'unknown')}</dd>
    ${reg.device ? `<dt>Registry</dt><dd>${esc(reg.device)}</dd>` : ''}${reg.family ? `<dt>Plug family</dt><dd class="mono">${esc(reg.family)}</dd>` : ''}
    ${cavTxt ? `<dt>Cavities</dt><dd>${esc(cavTxt)}</dd>` : ''}${m.note ? `<dt>Media note</dt><dd>${esc(m.note)}</dd>` : ''}
    ${mates ? `<dt>Mates with</dt><dd class="chips">${mates}</dd>` : ''}${links ? `<dt>Documents</dt><dd>${links}</dd>` : ''}</dl>
  </div>
  <div class="sect"><h3>Where it is</h3>
    <dl class="kv"><dt>Where</dt><dd>${esc(i.where)}</dd>
    <dt>Station</dt><dd class="mono">${fmtIn(st.station_in)} in behind the front axle</dd>
    <dt>Lateral</dt><dd class="mono">${fmtIn(Math.abs(st.lateral_in))} in ${st.lateral_in > 0 ? 'driver side' : st.lateral_in < 0 ? 'passenger side' : ''} of centre</dd>
    <dt>Height</dt><dd class="mono">${fmtIn(st.height_in)} in above the ground</dd>
    <dt>Placed from</dt><dd>${esc(i.basis)}</dd>
    <dt>Margin</dt><dd><span class="mono">${esc(marginText(mg))}</span><span class="src">${esc(mg ? mg.text : '')}</span></dd>${kidsHtml}</dl>
  </div>
  <div class="sect"><h3>Size and colour</h3>${sizeBlock(i)}</div>
  <div class="sect"><h3>Pins and wires${i.w && i.w.length ? ` (${i.w.length})` : ''}</h3>${wireRows(i)}${reg.note ? `<p class="fine">${esc(reg.note)}</p>` : ''}</div>
  ${routeBlock(i)}
  <div class="sect"><h3>Why it is there</h3><ul class="why">${why || '<li class="muted">No reason recorded.</li>'}</ul></div>
  ${(i.calls || []).length ? `<div class="sect"><h3>Open call</h3><ul class="openl">${i.calls.map(x => `<li>${esc(x.text)}<span class="src">${esc(x.source)}</span></li>`).join('')}</ul></div>` : ''}
  ${costBlock(i)}
  ${workBlock(i)}
  ${open.length ? `<div class="sect"><h3>Still open (${open.length})</h3><ul class="openl">${open.map(o => `<li>${esc(o)}</li>`).join('')}</ul></div>` : ''}
  ${srcs ? `<div class="sect"><h3>Registry sources</h3><ul class="openl" style="list-style:square">${srcs}</ul></div>` : ''}
  <div class="sect" id="notes-sect" hidden></div>`;
  renderNoteBox(); renderFoot();
}
function wireLine(id) {
  const w = W[id];
  if (!w) return `<tr><td class="mono">${esc(id)}</td><td colspan="4" class="muted">not in the registry</td></tr>`;
  return `<tr class="${w.kind === 'implied' ? 'imp' : ''}"><td class="mono">${esc(id)}</td><td class="mono">${esc(w.gauge || (w.awg ? w.awg + ' AWG' : ''))}</td><td>${esc(w.color || '')}</td><td>${esc(w.label || '')}</td><td>${(w.ends || []).map(linkEnd).join(' ')}</td></tr>`;
}
function nodeLink(nid) {
  const n = nodeById[nid];
  if (n && n.ep && byId[n.ep]) return linkEnd(n.ep) + (n.gap_mm != null && n.gap_mm > 50 ? ` <span class="warn">${n.gap_mm} mm off its spot</span>` : '');
  return `<button type="button" class="linkish mono" data-go="node:${esc(nid)}">${esc(nid)}</button>`;
}
function checksTable(cs) {
  if (!cs || !cs.length) return '<p class="muted" style="margin:0">No checks recorded.</p>';
  return `<div class="wtwrap"><table class="wt"><thead><tr><th>Rule</th><th>Result</th><th>Why</th></tr></thead><tbody>${cs.map(c =>
    `<tr><td>${esc(c.rule)}<span class="src">${esc(c.source || ((routes.check_sources || [])[c.s]) || '')}</span></td><td class="mono ${/pass|ok/i.test(c.result || '') ? 'ok' : 'warn'}">${esc(c.result)}</td><td>${esc(c.why || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderSeg(el, s) {
  if (!s) { el.innerHTML = ''; return; }
  const clips = (routes.clips || []).filter(c => c.segment === s.id);
  const fw = s.firewall_shift_mm ? Object.entries(s.firewall_shift_mm).map(([k, v]) => `${k} mm: ${v} mm`).join(', ') : '';
  el.innerHTML = `<div class="sect"><div class="idline"><span class="mono">${esc(s.id)}</span><span class="stword"><i class="sq" style="--c:var(--s-proposed)"></i>${esc(s.status || '')}</span></div>
  <h2>${esc(s.bundle || 'Bundle')}</h2>
  <dl class="kv" style="margin-top:8px"><dt>From</dt><dd>${nodeLink(s.from_node)}</dd><dt>To</dt><dd>${nodeLink(s.to_node)}</dd>
  <dt>Length</dt><dd><span class="mono">${esc(s.length_m)} m ± ${esc(s.margin_mm)} mm</span><span class="src">${esc(s.margin_basis || '')}</span></dd>
  <dt>Outer dia.</dt><dd><span class="mono">${esc(s.od_mm)} mm${(s.parallel || 1) > 1 ? ' × ' + s.parallel + ', side by side' : ''}</span><span class="src">${esc(s.od_basis || '')}</span>${(s.od_unknowns || []).map(u => `<span class="src warn">${esc(u)}</span>`).join('')}</dd>
  <dt>Cables</dt><dd class="mono">${esc(s.cables)}</dd>
  <dt>Covering</dt><dd>${esc(s.covering || 'not set')}</dd>
  <dt>Clips</dt><dd>${clips.length ? clips.map(c => `<span class="mono">${esc(c.pn || c.id)}</span> ${esc(c.type || '')}${c.fixed_to ? ', to ' + esc(c.fixed_to) : ''}`).join('<br>') : 'none on this segment'}${s.clip_spacing_mm ? `<span class="src">spacing ${esc(s.clip_spacing_mm)} mm (${esc((routes.sources || {}).clamp || 'routes.json')})</span>` : ''}</dd>
  <dt>Ties</dt><dd class="mono">${esc(s.ties == null ? '' : s.ties)}${s.tie_spacing_mm ? ' at ' + esc(s.tie_spacing_mm) + ' mm' : ''}</dd>
  ${fw ? `<dt>Firewall shift</dt><dd class="mono">${esc(fw)}</dd>` : ''}
  <dt>Why this way</dt><dd>${esc(s.why || '')}</dd><dt>Basis</dt><dd>${esc(s.basis || '')}</dd></dl></div>
  <div class="sect"><h3>Wires inside (${(s.wires || []).length})</h3><div class="wtwrap"><table class="wt"><thead><tr><th>Wire</th><th>Gauge</th><th>Colour</th><th>Circuit</th><th>Ends</th></tr></thead><tbody>${(s.wires || []).map(wireLine).join('')}</tbody></table></div></div>
  <div class="sect"><h3>Checks (${(s.checks || []).length}${s.checks_failed ? ', ' + s.checks_failed + ' not passed' : ''})</h3>${checksTable(s.checks)}</div>
  <div class="sect"><h3>Where this comes from</h3><p class="fine" style="margin:0">harness-cad, ${esc(routes.generated_by || '')}; ${esc(routes.scope || '')}. ${esc(routes.status || '')}.</p></div>`;
}
function renderNode(el, n) {
  if (!n) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sect"><div class="idline"><span class="mono">${esc(n.id)}</span><span class="muted">${esc(n.kind || 'clip')}</span></div><h2>${esc(n.pn || 'Part number not set')}</h2>
  <dl class="kv" style="margin-top:8px"><dt>Station</dt><dd class="mono">${fmtIn(n.st.station_in)} in</dd><dt>Type</dt><dd>${esc(n.type || n.kind || '')}</dd>
  ${n.ep ? `<dt>Lands on</dt><dd>${linkEnd(n.ep)}${n.gap_mm != null ? ` <span class="${n.gap_mm > 50 ? 'warn' : 'muted'}">${n.gap_mm} mm from that end's spot in pos.py</span>` : ''}</dd>` : ''}
  ${n.segment ? `<dt>On segment</dt><dd><button type="button" class="linkish mono" data-go="seg:${esc(n.segment)}">${esc(n.segment)}</button>${n.fixed_to ? ', fixed to ' + esc(n.fixed_to) : ''}</dd>` : ''}
  ${(n.segments || []).length ? `<dt>Segments</dt><dd>${n.segments.map(sid => `<button type="button" class="linkish mono" data-go="seg:${esc(sid)}">${esc(sid)}</button>`).join(' ')}</dd>` : ''}
  <dt>Wires</dt><dd class="mono">${esc((n.wires || []).join(' '))}</dd>
  ${n.size_mm || n.d_mm ? `<dt>Size</dt><dd class="mono">${esc(n.size_mm ? n.size_mm.join(' × ') : '⌀' + n.d_mm)} mm</dd>` : '<dt>Size</dt><dd>not given, so drawn as a symbol</dd>'}
  <dt>Note</dt><dd>${esc(n.note || '')}${n.basis ? `<span class="src">${esc(n.basis)}</span>` : ''}</dd></dl></div>`;
}
function renderCtx(el, c) {
  if (!c) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sect"><div class="idline"><span class="mono">${esc(c.id.replace(/^ctx:/, ''))}</span><span class="muted">context, not a wiring end</span></div><h2>${esc(c.label)}</h2>
  <dl class="kv" style="margin-top:8px"><dt>What</dt><dd>${esc(c.note || '')}</dd><dt>Station</dt><dd class="mono">${fmtIn(c.st.station_in)} in behind the front axle</dd></dl></div>
  ${(c.calls || []).length ? `<div class="sect"><h3>Open call</h3><ul class="openl">${c.calls.map(x => `<li>${esc(x.text)}<span class="src">${esc(x.source)}</span></li>`).join('')}</ul></div>` : ''}`;
}
$('#insp-body').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) select(b.dataset.go, 'insp'); });

// ---------------------------------------------------------------- tables
const zoneOpts = [''].concat(Object.keys(ZONES).filter(z => items.some(i => i.zone === z)));
const sysOpts = [''].concat([...new Set(items.map(i => i.sys))].sort());
function fillSel(id, opts, label, word) {
  $(id).innerHTML = opts.map(o => `<option value="${esc(o)}">${o ? esc(word ? word(o) : o) : esc(label)}</option>`).join('');
}
fillSel('#f-zone', zoneOpts, 'All zones', z => ZONES[z]);
fillSel('#f-sys', sysOpts, 'All systems');
fillSel('#f-status', [''].concat(Object.keys(WORD)), 'All statuses', s => WORD[s]);
fillSel('#f-drawn', ['', 'drawn', 'notdrawn', 'size', 'loom', 'grouped'], 'Drawn or not', d => ({drawn: 'Drawn to size', notdrawn: 'Not drawn', size: 'Not drawn: size not read', loom: 'Not drawn: in the loom', grouped: 'Not drawn: spot not set'}[d]));
[['q', '#f-q', 'input'], ['zone', '#f-zone', 'change'], ['sys', '#f-sys', 'change'], ['status', '#f-status', 'change'], ['drawn', '#f-drawn', 'change']]
  .forEach(([k, s, ev]) => $(s).addEventListener(ev, e => { S.f[k] = e.target.value; renderGrid(); }));
function passes(i) {
  const f = S.f;
  if (f.zone && i.zone !== f.zone) return false;
  if (f.sys && i.sys !== f.sys) return false;
  if (f.status && i.status !== f.status) return false;
  if (f.drawn === 'drawn' && !i.drawn) return false;
  if (f.drawn === 'notdrawn' && i.drawn) return false;
  if (['size', 'loom', 'grouped'].includes(f.drawn) && (i.drawn || i.why_not !== f.drawn)) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [i.id, i.what, i.where, (i.media || {}).maker_pn, (i.media || {}).maker, (i.reg || {}).device].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
const COLS = {
  ends: [
    {k: 'th', h: '', ns: 1, td: i => `<td class="th">${thumb(i)}</td>`},
    {k: 'id', h: 'ID', v: i => i.id, td: i => `<td class="id">${esc(i.id)}</td>`},
    {k: 'what', h: 'End', v: i => i.what, td: i => `<td class="what">${esc(i.what)}<div class="small">${esc(i.where)}</div></td>`},
    {k: 'zone', h: 'Zone', v: i => ZONES[i.zone], td: i => `<td>${esc(ZONES[i.zone] || i.zone)}</td>`},
    {k: 'sys', h: 'System', v: i => i.sys, td: i => `<td>${esc(i.sys)}</td>`},
    {k: 'status', h: 'Status', v: i => Object.keys(WORD).indexOf(i.status), td: i => `<td>${statusCell(i.status)}</td>`},
    {k: 'drawn', h: 'Drawn', v: i => i.drawn ? 0 : 1, td: i => `<td class="small">${esc(drawnWord(i))}</td>`},
    {k: 'size', h: 'Size mm', v: i => i.fp ? (i.fp.dx || i.fp.d || 0) * (i.fp.dy || i.fp.d || 0) * (i.fp.dz || i.fp.t || 0) : -1, td: i => `<td class="num">${esc(i.drawn === 'piece' ? '' : sizeText(i.fp).replace(' mm', ''))}</td>`},
    {k: 'margin', h: 'Margin', v: i => (effMargin(i) || {}).mm ?? 9999, td: i => `<td class="num">${esc(marginText(effMargin(i)))}</td>`},
    {k: 'station', h: 'Sta in', v: i => i.st.station_in, td: i => `<td class="num">${fmtIn(i.st.station_in)}</td>`},
  ],
  notdrawn: [
    {k: 'th', h: '', ns: 1, td: i => `<td class="th">${thumb(i)}</td>`},
    {k: 'id', h: 'ID', v: i => i.id, td: i => `<td class="id">${esc(i.id)}</td>`},
    {k: 'what', h: 'End', v: i => i.what, td: i => `<td class="what">${esc(i.what)}</td>`},
    {k: 'why', h: 'Why not drawn', v: i => i.why_not, td: i => `<td>${esc(NOTDRAWN[i.why_not] || '')}<div class="small">${esc(i.why_not_text || '')}</div></td>`},
    {k: 'pn', h: 'Part number', v: i => (i.media || {}).maker_pn || '', td: i => `<td class="mono">${esc((i.media || {}).maker_pn || 'unknown')}</td>`},
    {k: 'zone', h: 'Zone', v: i => ZONES[i.zone], td: i => `<td>${esc(ZONES[i.zone] || i.zone)}</td>`},
    {k: 'margin', h: 'Margin', v: i => (effMargin(i) || {}).mm ?? 9999, td: i => `<td class="num">${esc(marginText(effMargin(i)))}</td>`},
    {k: 'station', h: 'Sta in', v: i => i.st.station_in, td: i => `<td class="num">${fmtIn(i.st.station_in)}</td>`},
  ],
  parts: [
    {k: 'th', h: '', ns: 1, td: i => `<td class="th">${thumb(i)}</td>`},
    {k: 'id', h: 'ID', v: i => i.id, td: i => `<td class="id">${esc(i.id)}</td>`},
    {k: 'what', h: 'Part', v: i => i.what, td: i => `<td class="what">${esc(i.what)}<div class="small mono">${esc(((i.media || {}).maker_pn) || '')}</div></td>`},
    {k: 'size', h: 'Envelope mm', v: i => (i.fp.dx || i.fp.d || 0) * (i.fp.dy || i.fp.d || 0) * (i.fp.dz || i.fp.t || 0), td: i => `<td class="num">${esc(sizeText(i.fp).replace(' mm', ''))}</td>`},
    {k: 'basis', h: 'Size basis', v: i => i.fp.basis || '', td: i => `<td>${esc(i.fp.basis || '')}<div class="small">${esc(i.fp.size || '')}</div></td>`},
    {k: 'color', h: 'Colour', ns: 1, td: i => `<td>${i.fp.top ? `<i class="sw" style="background:${esc(i.fp.top)}"></i>` : '<span class="small">not read</span>'}</td>`},
    {k: 'from', h: 'Record', v: i => i.fp.from || '', td: i => `<td class="small">${esc(i.fp.from || '')}</td>`},
  ],
};
function renderGrid() {
  const tab = S.tab, grid = $('#grid');
  $('#filters').hidden = tab === 'routes' || tab === 'notes';
  if (tab === 'routes') return renderRoutesTab(grid);
  if (tab === 'notes') return renderNotesTab(grid);
  if (tab === 'cost') return renderCostTab(grid);
  if (tab === 'work') return renderWorkTab(grid);
  let list = items.filter(passes);
  if (tab === 'notdrawn') list = list.filter(i => !i.drawn);
  if (tab === 'parts') list = list.filter(i => i.drawn === 'own' && i.fp);
  const cols = COLS[tab];
  const sc = cols.find(c => c.k === S.sort.key && c.v) || cols.find(c => c.k === 'station') || cols[1];
  list.sort((a, b) => { const x = sc.v(a), y = sc.v(b); return (x > y ? 1 : x < y ? -1 : 0) * S.sort.dir || a.st.station_in - b.st.station_in; });
  const head = '<thead><tr>' + cols.map(c => `<th data-k="${c.k}" class="${c.ns ? 'nosort' : ''}"${c.k === sc.k ? ` aria-sort="${S.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(c.h)}</th>`).join('') + '</tr></thead>';
  const body = list.length ? list.map(i => `<tr data-id="${esc(i.id)}" tabindex="0" class="${i.id === S.sel ? 'sel' : ''}">${cols.map(c => c.td(i)).join('')}</tr>`).join('')
    : `<tr class="empty"><td colspan="${cols.length}">No end matches these filters.</td></tr>`;
  grid.innerHTML = head + '<tbody>' + body + '</tbody>';
  $('#f-count').textContent = `${list.length} shown`;
}
function renderRoutesTab(grid) {
  if (!routes) {
    grid.innerHTML = `<tbody><tr class="empty"><td>No routes yet. Agent harness-cad is routing every bundle in Blender in the same axes as this drawing. When its routes land, each bundle is drawn at its true outer diameter and every segment is clickable: the wires inside it, the covering, the length with its margin, the clips with part number and spacing, and the splices, breakouts and grommets as parts. Nothing is sketched in the meantime.</td></tr></tbody>`;
    return;
  }
  const cols = ['Segment', 'From', 'To', 'Wires', 'OD mm', 'Covering', 'Length m', '± mm', 'Clips', 'Checks'];
  const head = '<thead><tr>' + cols.map(c => `<th class="nosort">${esc(c)}</th>`).join('') + '</tr></thead>';
  const groups = {};
  routes.segments.forEach(s => (groups[s.bundle || 'Other'] = groups[s.bundle || 'Other'] || []).push(s));
  const ep = nid => { const n = nodeById[nid]; return n && n.ep ? n.ep : nid; };
  let rows = '';
  Object.entries(groups).forEach(([bn, segs]) => {
    const L = segs.reduce((a, s) => a + (s.length_m || 0), 0);
    rows += `<tr class="grp"><td colspan="${cols.length}">${esc(bn)} <span class="muted">${segs.length} segments, ${L.toFixed(2)} m of path, ${esc(routes.status || '')}</span></td></tr>`;
    rows += segs.map(s => `<tr data-id="seg:${esc(s.id)}" tabindex="0" class="${S.sel === 'seg:' + s.id ? 'sel' : ''}"><td class="id">${esc(s.id)}</td><td class="mono">${esc(ep(s.from_node))}</td><td class="mono">${esc(ep(s.to_node))}</td>`
      + `<td class="num">${(s.wires || []).length}</td><td class="num">${esc(s.od_mm)}${(s.parallel || 1) > 1 ? ' ×' + s.parallel : ''}</td><td class="small">${esc((s.covering || '').split(';')[0])}</td>`
      + `<td class="num">${esc(s.length_m)}</td><td class="num">${esc(s.margin_mm)}</td><td class="num">${(routes.clips || []).filter(c => c.segment === s.id).length}</td>`
      + `<td class="${s.checks_failed ? 'warn' : 'ok'} small">${(s.checks || []).length - (s.checks_failed || 0)} of ${(s.checks || []).length} pass${/conflict/i.test(s.why || '') || s.conflict ? ', conflict noted' : ''}</td></tr>`).join('');
  });
  grid.innerHTML = head + '<tbody>' + rows + '</tbody>';
  $('#f-count').textContent = `${routes.segments.length} segments`;
}
function renderCostTab(grid) {
  const r = D.roll || {systems: {}};
  const sys = Object.entries(r.systems).sort((a, b) => b[1].usd - a[1].usd);
  const head = '<thead><tr><th class="nosort">System or end</th><th class="nosort">Pieces or status</th><th class="nosort">Priced or vendor</th><th class="nosort">List price</th></tr></thead>';
  let rows = `<tr class="grp"><td colspan="4">Whole harness: ${r.priced} of ${r.pieces} pieces have a public list price on file, ${usd(r.total)} for those. Your paid amounts stay in the database and show as $•••. Prices older than ${D.stale_days} days are marked stale.</td></tr>`;
  rows += sys.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.pieces}</td><td class="num">${v.priced}</td><td class="num">${v.priced ? usd(v.usd) : '<span class="muted">none on file</span>'}</td></tr>`).join('');
  (D.carts || []).forEach(c => { rows += `<tr><td colspan="3">${esc(c.vendor || 'Cart')} cart, ${esc(c.line_count)} lines of harness plugs, terminals and wire, captured ${esc(c.captured)}: ${esc(c.status)}</td><td class="num">${usd(c.total)}</td></tr>`; });
  rows += `<tr class="grp"><td colspan="4">Per end, filtered like the other tabs</td></tr>`;
  const list = items.filter(passes).filter(i => i.drawn !== 'piece');
  rows += list.map(i => {
    const p = (i.cost.list || [])[0];
    return `<tr data-id="${esc(i.id)}" tabindex="0" class="${i.id === S.sel ? 'sel' : ''}"><td><span class="mono">${esc(i.id)}</span> <span class="small">${esc(i.what)}</span></td><td class="small">${esc(i.buy.status)}</td>`
      + `<td class="small">${p ? esc(p.vendor) + ', ' + esc(staleWord(p)) : ''}</td><td class="num">${p ? usd(p.usd) + (p.unit !== 'each' ? ' ' + esc(p.unit) : '') : ''}${i.cost.paid ? ' <span class="muted">paid $•••</span>' : ''}</td></tr>`;
  }).join('');
  grid.innerHTML = head + '<tbody>' + rows + '</tbody>';
  $('#f-count').textContent = `${list.length} shown`;
}
function renderWorkTab(grid) {
  const head = '<thead><tr><th class="nosort">End</th><th class="nosort">Design</th><th class="nosort">Build</th><th class="nosort">Furthest stage on file</th></tr></thead>';
  const order = ['researched', 'designed', 'audited', 'approved by Skylar', 'ordered', 'built', 'verified on the truck'];
  const list = items.filter(passes);
  const rows = list.map(i => {
    const w = i.work || {}, done = (w.stages || []).filter(s => s.state === 'done' || s.state === 'owner call').map(s => s.stage);
    const far = order.filter(s => done.includes(s)).pop() || 'none';
    return `<tr data-id="${esc(i.id)}" tabindex="0" class="${i.id === S.sel ? 'sel' : ''}"><td><span class="mono">${esc(i.id)}</span> <span class="small">${esc(i.what)}</span></td>`
      + `<td class="small">${(w.design || []).map(d => esc(d.who) + ' (' + esc(d.what) + ')').join(', ')}</td><td class="small">${esc(w.build || 'unassigned')}</td><td class="small">${esc(far)}</td></tr>`;
  }).join('');
  grid.innerHTML = head + `<tbody><tr class="grp"><td colspan="4">${esc(D.builder_note)}</td></tr>` + rows + '</tbody>';
  $('#f-count').textContent = `${list.length} shown`;
}
$('#grid').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (th && !th.classList.contains('nosort')) { const k = th.dataset.k; S.sort = {key: k, dir: S.sort.key === k ? -S.sort.dir : 1}; renderGrid(); markRow('grid'); return; }
  const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id, 'grid');
});
$('#grid').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); select(tr.dataset.id, 'grid'); } } });
$('#grid').addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-id]'); if (tr && byId[tr.dataset.id]) setHov(tr.dataset.id); });
$('#grid').addEventListener('mouseleave', () => setHov(null));
function setTab(t) {
  S.tab = t; keep();
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  renderGrid(); markRow();
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function tabCounts() {
  $('#n-ends').textContent = items.length;
  $('#n-notdrawn').textContent = items.filter(i => !i.drawn).length;
  $('#n-parts').textContent = items.filter(i => i.drawn === 'own').length;
  $('#n-routes').textContent = routes ? routes.segments.length : 0;
  $('#n-cost').textContent = (D.roll || {}).priced || 0;
  $('#n-notes').textContent = notes.length;
}

// ---------------------------------------------------------------- below: layout calls, margins, sources
(function below() {
  $('#calls').innerHTML = (D.boxes || []).map(b => {
    const why = (b.why || []).map(w => `<li>${esc(w.text)} <span class="src">${esc(w.source)}</span></li>`).join('');
    const inst = (b.instead || []).map(x => `<li><b>${esc(x.where)}:</b> ${esc(x.why_not)}</li>`).join('');
    const open = (b.open || []).map(o => `<li>${esc(o)}</li>`).join('');
    const nodes = (b.nodes || []).filter(n => byId[n]).map(linkEnd).join(' ');
    return `<article class="call"><h3><span class="mono">${esc(b.id)}</span><span class="stword st-${esc(b.status)}"><i class="sq"></i>${esc(WORD[b.status] || b.status)}</span></h3>
      <p><b>${esc(b.what)}.</b> ${esc(b.where)}</p>${why ? `<ul>${why}</ul>` : ''}${inst ? `<p class="muted">Other spots considered</p><ul>${inst}</ul>` : ''}
      ${open ? `<p class="muted">Open</p><ul>${open}</ul>` : ''}${nodes ? `<p>Ends: ${nodes}</p>` : ''}</article>`;
  }).join('');
  $('#calls').addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { select(b.dataset.go, 'calls'); $('#work').scrollIntoView({behavior: 'smooth'}); } });
  const cls = {};
  items.forEach(i => { const m = i.margin || {}; (cls[m.cls] = cls[m.cls] || {n: 0, m}).n++; });
  const CL = {engine: 'On the LS3 (twin engine anchor)', body: 'On the body model', described: 'Placed from a spot named in words', candidate: 'Candidate spot, not decided', stated: 'Margin stated in the placement note', grouped: 'Sits with another end', unknown: 'No rule'};
  $('#margins').innerHTML = '<thead><tr><th>Placed</th><th>Ends</th><th>Margin</th><th>Where the number comes from</th></tr></thead><tbody>'
    + Object.entries(cls).map(([k, v]) => `<tr><td>${esc(CL[k] || k)}</td><td class="mono">${v.n}</td><td class="mono">${esc(marginText(v.m))}</td><td>${esc(k === 'engine' ? v.m.text.split(';')[0] : v.m.text)}</td></tr>`).join('') + '</tbody>';
  $('#sources').innerHTML = '<tbody>' + Object.entries(D.sources).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="mono" style="font-size:11.5px">${esc(v)}</td></tr>`).join('')
    + `<tr><th>built</th><td class="mono" style="font-size:11.5px">${esc(D.built)} from main ${esc(D.main)}</td></tr></tbody>`;
})();

// ---------------------------------------------------------------- ask Claude about the selected end (sample capability)
let sampleFn = null, sampleState = 'loading', toolsOk = false, askCtl = null;
function compact(id) {
  const i = byId[id]; if (!i) return null;
  const m = i.media || {};
  return {id: i.id, what: i.what, where: i.where, zone: ZONES[i.zone] || i.zone, system: i.sys, status: WORD[i.status], why: i.why, still_open: (i.open || []).concat(((i.reg || {}).open) || []),
    position: {station_in_behind_front_axle: i.st.station_in, lateral_in_positive_driver: i.st.lateral_in, height_in_above_ground: i.st.height_in, placed_from: i.basis, margin: effMargin(i)},
    size: i.fp ? {envelope_mm: sizeText(i.fp), source: i.fp.size, colour: i.fp.top, colour_source: i.fp.color, orientation: i.fp.orient || 'drawn, not decided'} : (i.drawn === 'piece' ? {drawn_as_part_of: i.piece_of} : {not_drawn: NOTDRAWN[i.why_not], why: i.why_not_text}),
    part: {maker: m.maker, part_number: m.maker_pn, photo_confidence: m.confidence, note: m.note, mates_with: m.mates_with, drawing: m.drawing && (m.drawing.url || m.drawing.page), datasheet: m.datasheet},
    registry: i.reg, wires: (i.w || []).map(x => { const w = W[x.id] || {}; return {id: x.id, cavity: x.cav, label: w.label, gauge: w.gauge || w.awg, spec: w.spec, colour: w.color, length_ft: w.len_ft, length_basis: w.len_basis, from: w.frm, to: w.to, other_ends: (w.ends || []).filter(e => e !== id), status: w.kind}; }),
    sits_with: kids[i.id] || [], grouped_with: i.grouped || null};
}
const SAMPLE_COPY = {rate_limited: 'Too many questions at once. Wait a minute and ask again.', session_expired: 'Sign in to claude.ai again, then ask.',
  refused: 'Claude declined that question. Ask it another way.', empty_completion: 'No answer came back. Ask it another way.',
  prompt_too_large: 'That was too much to send. Ask a shorter question.', upstream_error: 'The answer was cut off. Ask again.'};
const HIDE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
// the footer of the properties panel stays put while the selection changes: ask Claude, or leave a note
const F = {mode: 'ask', q: '', note: '', ans: {}, busy: false};
function footHtml() {
  const i = selectedItem(), id = i ? i.id : '';
  const tabs = `<div class="ftabs" role="group" aria-label="Talk to the system"><button type="button" data-f="ask" aria-pressed="${F.mode === 'ask'}">Ask about this part</button><button type="button" data-f="note" aria-pressed="${F.mode === 'note'}">Note to the build agents</button></div>`;
  if (!i) return tabs + `<p class="fine">Select a part first.</p>`;
  if (F.mode === 'ask') {
    if (sampleState === 'off') return tabs + `<p class="fine">Asking Claude works when this page is open on claude.ai by a signed-in viewer. It is not available in this view.</p>`;
    const a = F.ans[id] || {};
    return tabs + `<textarea class="ta" id="ask-q" placeholder="Ask about ${esc(id)}: what it plugs into, what is still open, what gauge feeds it..." aria-label="Question about ${esc(id)}">${esc(F.q)}</textarea>
      <div class="btnrow"><button type="button" class="btn" id="ask-go"${sampleState !== 'ready' || F.busy ? ' disabled' : ''}>Ask</button><button type="button" class="btn ghost" id="ask-stop"${F.busy ? '' : ' hidden'}>Stop</button><span class="fine" id="ask-msg" style="margin:0">${esc(a.msg || '')}</span></div>
      <div class="answer" id="ask-out">${esc(a.text || '')}</div>
      <p class="fine">Claude answers from this page's data for ${esc(id)} only. It runs on your own Claude plan; claude.ai asks you to allow it the first time. No API key is needed.</p>`;
  }
  let form;
  if (dbState === 'off') form = `<p class="fine">Notes are kept on claude.ai. Open this page there, signed in, to leave one.</p>`;
  else if (dbState === 'loading') form = `<p class="fine">Connecting to the page's note store...</p>`;
  else if (!myId) form = `<p class="fine">Sign in to claude.ai to leave a note: every note carries who wrote it.</p>`;
  else if (canWrite === false) form = `<p class="fine">You can read the notes here but not add them.</p>`;
  else form = `<textarea class="ta" id="note-t" placeholder="What should change at ${esc(id)}: the spot, the part, a size, a route..." aria-label="Note about ${esc(id)}">${esc(F.note)}</textarea>
    <div class="btnrow"><button type="button" class="btn" id="note-go">Save note</button><span class="fine" id="note-msg" style="margin:0"></span></div>
    <p class="fine">Saved with ${esc(id)}, the ${esc(S.view)} view, the time and your name. The build agents read these notes from the page's store.</p>`;
  return tabs + form;
}
function renderFoot() {
  const el = $('#insp-foot'); if (!el) return;
  el.innerHTML = footHtml();
  const q = $('#ask-q'); if (q) { q.addEventListener('input', () => { F.q = q.value; }); q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }); }
  const go = $('#ask-go'); if (go) go.addEventListener('click', ask);
  const st = $('#ask-stop'); if (st) st.addEventListener('click', () => askCtl && askCtl.abort());
  const t = $('#note-t'); if (t) t.addEventListener('input', () => { F.note = t.value; });
  const ng = $('#note-go'); if (ng) ng.addEventListener('click', saveNote);
}
$('#insp-foot').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { F.mode = b.dataset.f; renderFoot(); } });
function renderAsk() { renderFoot(); }
async function ask() {
  const i = selectedItem(), q = (F.q || '').trim();
  if (!q || !i || !sampleFn || F.busy) return;
  const id = i.id, a = F.ans[id] = {text: 'Thinking...', msg: ''};
  askCtl = new AbortController(); F.busy = true; renderFoot();
  const show = () => { if (selectedItem() && selectedItem().id === id && F.mode === 'ask') { const o = $('#ask-out'), m = $('#ask-msg'); if (o) o.textContent = a.text; if (m) m.textContent = a.msg; } };
  const prompt = 'You answer questions about one wiring end on a 1977 Chevrolet K5 Blazer harness build (LS3 engine, MoTeC M130 ECU, MoTeC PDM30 in the cab, PDM15 in the engine bay, one 61-pin D38999 connector through the firewall).\n'
    + 'Use ONLY the page data below. Quote numbers exactly, with their source. If the data does not answer the question, say so plainly and name the record or document that would settle it. Never guess a part number, size, pin or length. '
    + 'Stations are inches behind the front axle; lateral is inches off the centreline, positive toward the driver. Answer in plain text, at most 170 words.\n\n'
    + 'PAGE DATA for ' + id + ' (JSON):\n' + JSON.stringify(compact(id)) + '\n\nQUESTION: ' + q;
  const opts = {signal: askCtl.signal, onText: ({text}) => { a.text = text; show(); }};
  if (toolsOk) {
    opts.tools = [{name: 'get_end', description: 'Look up another wiring end on this page by its id, for example the other end of a wire or a part it mates with. Returns that end\'s page record as JSON.',
      inputSchema: {type: 'object', properties: {id: {type: 'string', description: 'the end id, for example M130-A'}}, required: ['id']},
      execute: input => { const r = compact(String(input.id || '')); if (!r) throw new Error('no end with id ' + input.id); a.msg = 'Reading ' + input.id + '...'; show(); return r; }}];
  }
  try {
    const r = await sampleFn(prompt, opts);
    a.text = r.text; a.msg = r.truncated ? 'The answer was cut short. Ask for less at a time.' : '';
  } catch (e) {
    const code = e && e.code;
    if (HIDE.includes(code)) { sampleState = 'off'; F.busy = false; delete F.ans[id]; renderFoot(); return; }
    a.text = code === 'refused' ? '' : (e.text || (a.text === 'Thinking...' ? '' : a.text));
    a.msg = code === 'cancelled' ? 'Stopped.' : (SAMPLE_COPY[code] || SAMPLE_COPY.upstream_error);
  }
  F.busy = false; renderFoot();
}
(async () => {
  if (!window.claude || !window.claude.use) { sampleState = 'off'; renderFoot(); return; }
  try { sampleFn = await window.claude.use('sample'); } catch (e) { sampleFn = null; }
  if (!sampleFn) { sampleState = 'off'; renderFoot(); return; }
  try { const lim = await sampleFn.limits(); toolsOk = !!(lim && lim.tools); } catch (e) { toolsOk = false; }
  sampleState = 'ready'; renderFoot();
})();

// ---------------------------------------------------------------- notes to the build agents (db + user capabilities)
let db = null, user = null, myId = null, canWrite = null, notes = [], names = {}, dbState = 'loading';
function when(iso) { try { const d = new Date(iso); return d.toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}); } catch (e) { return iso; } }
function who(id) { return (names[id] && names[id].name) || (id && id === myId ? 'you' : 'Someone'); }
function renderNoteBox() {
  const el = $('#notes-sect');
  if (el) {
    const i = selectedItem();
    const mine = i ? notes.filter(n => n.end === i.id) : [];
    el.hidden = !mine.length;
    el.innerHTML = mine.length ? `<h3>Notes to the build agents (${mine.length})</h3>` + mine.map(n => `<div class="note"><div class="meta">${esc(when(n.at))} · ${esc(who(n.by))} · ${esc(n.view || '')} view</div>${esc(n.text)}</div>`).join('') : '';
  }
  if (F.mode === 'note') renderFoot();
}
async function saveNote() {
  const i = selectedItem(), msg = $('#note-msg'), go = $('#note-go');
  const text = (F.note || '').trim();
  if (!text || !i) { if (msg) msg.textContent = 'Write the note first.'; return; }
  go.disabled = true; msg.textContent = 'Saving...';
  try {
    await db.collection('notes').add({end: i.id, what: i.what, view: S.view, at: new Date().toISOString(), by: myId, text: text.slice(0, 4000)});
    F.note = ''; renderFoot(); const m2 = $('#note-msg'); if (m2) m2.textContent = 'Saved.';
  } catch (e) {
    const code = e && e.code;
    if (code === 'invalid_argument') { canWrite = false; renderFoot(); return; }
    msg.textContent = code === 'quota_exceeded' ? 'The note store is full. Tell the build agents.' : 'Not saved. Try again.';
    go.disabled = false;
  }
}
function renderNotesTab(grid) {
  if (dbState !== 'ready') { grid.innerHTML = `<tbody><tr class="empty"><td>${dbState === 'off' ? 'Notes are kept on claude.ai. Open this page there, signed in, to read and leave them.' : 'Connecting to the note store...'}</td></tr></tbody>`; return; }
  if (!notes.length) { grid.innerHTML = `<tbody><tr class="empty"><td>No notes yet. Select a part, then use "Note to the build agents" at the bottom of the panel on the right. Each note is saved with the part, the view, the time and who wrote it.</td></tr></tbody>`; return; }
  grid.innerHTML = '<thead><tr><th class="nosort">When</th><th class="nosort">Who</th><th class="nosort">End</th><th class="nosort">View</th><th class="nosort">Note</th></tr></thead><tbody>'
    + notes.map(n => `<tr data-id="${esc(n.end)}"><td class="mono" style="white-space:nowrap">${esc(when(n.at))}</td><td>${esc(who(n.by))}</td><td class="id">${esc(n.end)}</td><td>${esc(n.view || '')}</td><td>${esc(n.text)}</td></tr>`).join('') + '</tbody>';
}
async function resolveNames() {
  if (!user) return;
  const ids = [...new Set(notes.map(n => n.by).filter(Boolean))];
  if (!ids.length) return;
  try { names = await user.profiles(ids); } catch (e) {}
  renderNoteBox(); if (S.tab === 'notes') renderGrid();
}
(async () => {
  const off = () => { dbState = 'off'; renderNoteBox(); renderFoot(); if (S.tab === 'notes') renderGrid(); };
  if (!window.claude || !window.claude.use) return off();
  try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch (e) {}
  if (!db) return off();
  if (user) { try { myId = await user.id(); canWrite = await user.can('data.write'); } catch (e) {} }
  dbState = 'ready';
  db.collection('notes').orderBy('at', 'desc').limit(500).onSnapshot(snap => {
    notes = snap.docs.map(d => Object.assign({id: d.id}, d.data()));
    tabCounts(); renderNoteBox(); if (S.tab === 'notes') renderGrid(); resolveNames();
  }, off);
  renderNoteBox(); renderFoot(); if (S.tab === 'notes') renderGrid();
})();

// ---------------------------------------------------------------- 3D: harness-cad's bay sample (three.js r128, loaded on demand)
const T3 = (function () {
  const box = $('#v3d'), msg = $('#v3d-msg');
  let started = false, ready = false, renderer, scene, camera, controls, root, raf = 0, marker = null;
  const metas = [];                      // {mesh, kind, id, base: {opacity, transparent, emissive}}
  const SCRIPTS = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/environments/RoomEnvironment.js'];
  const say = t => { msg.textContent = t; msg.hidden = !t; };
  const load = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('could not load ' + src.split('/').slice(-1)[0])); document.head.appendChild(s); });
  // what a node in the GLB stands for: an end, a route segment, a clip, the engine, or body context
  const E3 = [[/^E3_Coil_(\d)$/, m => 'COIL-' + m[1]], [/^E3_Injector_(\d)$/, m => 'INJ-' + m[1]], [/^E3_ThrottleBody/, () => 'TB'],
    [/^E3_Alternator_197/, () => 'ALTERNATOR-SENSE'], [/^E3_Starter_DFSR/, () => 'STARTER-S'], [/^E3_AC_(Clutch|Compressor)/, () => 'AC-CLUTCH']];
  function classify(o) {
    const name = o.name || '', ex = o.userData || {};
    if (segById[name]) return {kind: 'route', id: 'seg:' + name};
    const pair = name.match(/^(.+)_[ab]$/); if (pair && segById[pair[1]]) return {kind: 'route', id: 'seg:' + pair[1]};
    if (nodeById[name] && nodeById[name].segment) return {kind: 'clip', id: 'node:' + name};
    if (/^CTX-/.test(name)) return {kind: 'body', id: null};
    for (const [rx, f] of E3) { const m = name.match(rx); if (m && byId[f(m)]) return {kind: 'engine', id: f(m)}; }
    if (/^E3_/.test(name)) return {kind: 'engine', id: null};
    const ep = ex.endpoint || ex.id;
    if (ep && byId[ep]) return {kind: 'part', id: ep};
    const base = name.replace(/_seg\d+$/, '').replace(/_(post_pos|post_neg|stud_[AB]|top|fill)$/, '');
    if (byId[base]) return {kind: 'part', id: base};
    return {kind: 'part', id: null};
  }
  function start() {
    if (started) return; started = true;
    say('Loading the 3D model of the engine bay...');
    (async () => {
      for (const s of SCRIPTS) await load(s);
      if (!window.K5_BAY_GLB) await load(D.glb.src);
      if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls || !window.K5_BAY_GLB) throw new Error('the 3D libraries did not load');
      try { renderer = new THREE.WebGLRenderer({antialias: true}); } catch (e) { throw new Error('this browser has no WebGL'); }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      box.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim() || '#f5f6f7');
      try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; } catch (e) {}
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(0.6, 1, 0.8); scene.add(key);
      camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      new ResizeObserver(resize).observe(box); resize();
      const bin = atob(window.K5_BAY_GLB), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const gltf = await new Promise((ok, no) => new THREE.GLTFLoader().parse(bytes.buffer, '', ok, no));
      root = gltf.scene; scene.add(root);
      root.traverse(o => {
        if (!o.isMesh) return;
        let c = classify(o); if (!c.id && o.parent && o.parent !== root) { const p = classify(o.parent); if (p.id) c = p; }
        o.material = o.material.clone();
        const m = o.material;
        if (m.metalness > 0.9) m.metalness = 0.6;
        m.roughness = Math.max(m.roughness, 0.35);
        metas.push({mesh: o, kind: c.kind, id: c.id, base: {opacity: m.opacity, transparent: m.transparent, emissive: m.emissive ? m.emissive.clone() : null}});
      });
      fit(); ready = true; say('');
      apply();
      loop();
    })().catch(e => { say('The 3D view could not start here: ' + (e && e.message || e) + '. The top, side and bay drawings show the same parts.'); });
  }
  function resize() { if (!renderer) return; const w = box.clientWidth || 600, h = box.clientHeight || 400; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function fit(obj) {
    const bb = new THREE.Box3().setFromObject(obj || root), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z, obj ? 0.25 : 0);
    camera.position.set(c.x + r * 0.9, c.y + r * 0.75, c.z + r * 1.25);   // from the driver's front quarter, above
    camera.near = r / 200; camera.far = r * 60; camera.updateProjectionMatrix();
    controls.target.copy(c); controls.update();
  }
  function loop() { cancelAnimationFrame(raf); if (S.mode !== '3d' || !ready) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }
  function apply() {                     // layers, the two opacity sliders, and the selection glow
    if (!ready) return;
    const sel = S.sel, selEnd = sel && byId[sel] ? (drawnTarget(byId[sel]) || byId[sel]).id : null;
    let hit = false;
    metas.forEach(t => {
      const m = t.mesh.material, b = t.base;
      const vis = t.kind === 'route' ? S.layers.routes : t.kind === 'clip' ? S.layers.clips : t.kind === 'part' ? S.layers.parts : true;
      t.mesh.visible = vis;
      let op = b.opacity;
      if (t.kind === 'body') op *= S.op.body / 100;
      if (t.kind === 'engine') op *= S.op.mech / 100;
      const isSel = sel && (t.id === sel || (selEnd && t.id === selEnd));
      if (isSel) hit = true;
      if (sel && !isSel && t.kind !== 'body') op *= 0.3;
      m.opacity = op; m.transparent = b.transparent || op < 0.999; m.depthWrite = op > 0.5;
      if (m.emissive) { if (isSel) { m.emissive.set(0x2f7bff); m.emissiveIntensity = 0.7; } else if (b.emissive) { m.emissive.copy(b.emissive); m.emissiveIntensity = 1; } }
      m.needsUpdate = true;
    });
    if (marker) { scene.remove(marker); marker = null; }
    const i = sel && byId[sel];
    if (i && !hit) {                     // not in the model: mark its spot (glTF X, Y, Z = twin x, z, -y)
      const [x, y, z] = i.xyz, mg = effMargin(i), r = Math.max(0.012, (mg && mg.mm ? mg.mm : 30) / 1000);
      marker = new THREE.Group();
      marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.01, 16, 12), new THREE.MeshBasicMaterial({color: 0x2f7bff})));
      marker.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({color: 0x2f7bff, wireframe: true, transparent: true, opacity: 0.35})));
      marker.position.set(x, z, -y); scene.add(marker);
    }
  }
  function frame() {
    if (!ready) return;
    const sel = S.sel, selEnd = sel && byId[sel] ? (drawnTarget(byId[sel]) || byId[sel]).id : null;
    const ms = metas.filter(t => t.id && (t.id === sel || t.id === selEnd)).map(t => t.mesh);
    if (ms.length) { const g = new THREE.Box3(); ms.forEach(m => g.expandByObject(m)); const c = g.getCenter(new THREE.Vector3()), s = g.getSize(new THREE.Vector3()); const r = Math.max(s.x, s.y, s.z, 0.25); camera.position.set(c.x + r * 1.1, c.y + r * 0.9, c.z + r * 1.4); controls.target.copy(c); controls.update(); }
    else if (marker) { const c = marker.position.clone(); camera.position.set(c.x + 0.5, c.y + 0.45, c.z + 0.7); controls.target.copy(c); controls.update(); }
  }
  function zoom(f) { if (!ready) return; const d = camera.position.clone().sub(controls.target).multiplyScalar(1 / f); camera.position.copy(controls.target).add(d); controls.update(); }
  // pointer: hover names the part, a click without a drag selects it
  const ray = () => new THREE.Raycaster(), ptr = {x: 0, y: 0};
  let down = null;
  function pick(ev) {
    const rc = renderer.domElement.getBoundingClientRect(), rr = ray();
    rr.setFromCamera(new THREE.Vector2(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1), camera);
    const hits = rr.intersectObjects(metas.filter(t => t.mesh.visible && t.kind !== 'body').map(t => t.mesh), false);
    return hits.length ? metas.find(t => t.mesh === hits[0].object) : null;
  }
  box.addEventListener('pointerdown', ev => { down = {x: ev.clientX, y: ev.clientY}; });
  box.addEventListener('pointerup', ev => {
    if (!ready || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) { down = null; return; }
    down = null; const t = pick(ev); if (t && t.id) select(t.id, 'canvas');
  });
  box.addEventListener('pointermove', ev => {
    if (!ready || down) return;
    const t = pick(ev), r = vp.getBoundingClientRect();
    if (!t) { tip.hidden = true; $('#cursor').textContent = '3D bay: drag to turn, right-drag to pan, scroll to zoom'; return; }
    const i = t.id && byId[t.id], s = t.id && t.id.startsWith('seg:') && segById[t.id.slice(4)];
    tip.innerHTML = i ? `<b>${esc(i.what)}</b><span class="mono">${esc(i.id)}</span>` : s ? `<b>${esc(s.id)}</b><span class="mono">${esc(s.bundle || '')}</span>` : `<b>${esc(t.mesh.name.replace(/_/g, ' '))}</b><span class="mono">${esc(t.kind)}</span>`;
    tip.hidden = false; tip.style.left = Math.min(ev.clientX - r.left + 14, r.width - 310) + 'px'; tip.style.top = Math.min(ev.clientY - r.top + 14, r.height - 60) + 'px';
    $('#cursor').textContent = t.mesh.name;
  });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
  return {start, apply, frame, zoom, fit: () => ready && fit(), loop, get ready() { return ready; }};
})();

// ---------------------------------------------------------------- start: the owner's own example, the 6L90 case connector
if (!D.glb) $('#v3d-btn').hidden = true;
setView(S.view);
tabCounts();
setTab(S.tab);
const start = (location.hash || '').slice(1);
select(byId[start] ? start : (byId['TRANS-CASE'] ? 'TRANS-CASE' : items[0].id), 'start');
if (start === '3d' && D.glb) setMode('3d');
})();
