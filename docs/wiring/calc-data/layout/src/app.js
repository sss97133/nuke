(function () {
'use strict';
const D = JSON.parse(document.getElementById('data').textContent);
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const natCmp = (a, b) => String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, {numeric: true, sensitivity: 'base'});
const uniq = a => [...new Set(a)];
const WORD = {fixed_by_engine: 'Fixed by the engine', decided: 'Decided', proposed: 'Proposed', open: 'Open', flag: 'Breaks a maker rule'};
const ZONES = {engine: 'Engine bay', firewall: 'Firewall', cab: 'Cab', doors: 'Doors', rear: 'Rear body', underbody: 'Under the truck'};
const CONF = {exact_pn: 'exact part number', same_family_photo: 'sibling part', unknown: 'no photo that can be defended'};
const NOTDRAWN = {size: 'Size not read', loom: 'Part of the loom', grouped: 'Spot not set', unused: 'Not used'};
const FRONT_AXLE = -1.896, IN = 0.0254;

// ---------------------------------------------------------------- indexes
const items = D.items, byId = Object.fromEntries(items.map(i => [i.id, i]));
const W = D.wires, PINS = D.pins || {}, DEVS = D.devs || {};
const SYS = Object.fromEntries((D.sys || []).map(s => [s.id, s]));
const routes = D.routes && D.routes.segments && D.routes.segments.length ? D.routes : null;
const segById = routes ? Object.fromEntries(routes.segments.map(s => [s.id, s])) : {};
const nodeById = routes ? Object.fromEntries(routes.nodes.concat(routes.clips).map(n => [n.id, n])) : {};
const OPEN = D.open || [], openById = Object.fromEntries(OPEN.map(o => [o.id, o]));
const LIB = D.lib || [], libByKey = Object.fromEntries(LIB.map(l => [l.key, l]));
const ctxById = Object.fromEntries((D.context || []).map(c => [c.id, c]));
const pinByKey = {};
Object.entries(PINS).forEach(([ep, ps]) => ps.forEach(p => { pinByKey[ep + '|' + p.c] = p; }));
const kids = {};
items.forEach(i => { if (i.piece_of) (kids[i.piece_of] = kids[i.piece_of] || []).push(i.id); });
items.forEach(i => { if (i.grouped && !i.piece_of) (kids[i.grouped] = kids[i.grouped] || []).push(i.id); });
const devName = d => (DEVS[d] || {}).name || d;
const sysName = y => (SYS[y] || {}).name || y;
const wiresOf = ep => uniq((PINS[ep] || []).flatMap(p => p.w));

// wire insulation colours: the registry's words, drawn as base plus tracer
const WCOL = {black: '#1d1d1d', white: '#f4f4f1', red: '#cf2f2a', green: '#2e8540', blue: '#2b5fc0', yellow: '#e8c417', orange: '#ef7c1b',
  brown: '#7a4b27', violet: '#7b4bb4', purple: '#7b4bb4', gray: '#8b939a', grey: '#8b939a', pink: '#ee8fb4', tan: '#d2b48c', natural: '#e8dfc9',
  silver: '#b8bec4', clear: '#e3e7ea', 'light blue': '#86bde9', 'lt blue': '#86bde9', 'dark blue': '#1f3c87', 'dk blue': '#1f3c87',
  'light green': '#7fcf8c', 'lt green': '#7fcf8c', 'dark green': '#1e5a2e', 'dk green': '#1e5a2e'};
function wcol(name) {
  const s = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
  if (!s) return null;
  const [a, b] = s.split('/').map(x => x.trim());
  const base = WCOL[a], stripe = b ? WCOL[b] : null;
  return base ? {base, stripe} : null;
}
function wswatch(name) {
  const c = wcol(name);
  if (!c) return '';
  const bg = c.stripe ? `linear-gradient(180deg,${c.base} 0 33%,${c.stripe} 33% 67%,${c.base} 67%)` : c.base;
  return `<i class="wc" style="background:${bg}" title="${esc(name)}"></i>`;
}
const gaugeOf = w => w ? (w.awg != null && w.awg !== '' ? w.awg + ' AWG' : (w.gauge || '')) : '';
const mm = v => v == null ? '' : String(Math.round(v));
const fmtIn = v => (v == null ? '?' : (Math.round(v * 10) / 10).toFixed(1));
const usd = v => '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
function wireLen(w) {
  if (!w) return {mm: null, pm: null, basis: ''};
  if (w.rl) return {mm: w.rl * 1000, pm: w.rm, basis: 'routed'};
  if (w.len_ft) return {mm: w.len_ft * 304.8, pm: null, basis: w.len_kind === 'measured' ? 'measured' : 'cut list'};
  return {mm: null, pm: null, basis: ''};
}
function endTxt(c) { return c ? c[0] + (c[1] ? ':' + c[1] : '') : ''; }
function sizeText(fp) { if (!fp) return ''; if (fp.shape === 'disc') return `⌀${fp.d} × ${fp.t} mm`; return `${fp.dx} × ${fp.dy} × ${fp.dz} mm`; }
function effMargin(i) { if (!i) return null; if (i.margin && i.margin.mm != null) return i.margin; if (i.grouped && byId[i.grouped]) return byId[i.grouped].margin; return i.margin; }
function marginText(m) { return m && m.mm != null ? `±${m.mm} mm` : (m && m.cls === 'grouped' ? 'with its group' : 'not measured'); }
function drawnTarget(i) { return i ? (i.drawn === 'piece' ? byId[i.piece_of] : (i.drawn === 'own' ? i : null)) : null; }
function drawnWord(i) {
  if (i.drawn === 'own') return i.fp && i.fp.same_as ? 'same part as ' + i.fp.same_as : 'to size';
  if (i.drawn === 'piece') return 'on ' + i.piece_of;
  return NOTDRAWN[i.why_not] || 'not drawn';
}
function thumb(i) { const ph = i.media && i.media.photo; return ph && ph.thumb ? `<img src="${ph.thumb}" alt="" loading="lazy">` : '<span class="noimg" title="no photo yet"></span>'; }

// ---------------------------------------------------------------- state (view settings are remembered per viewer)
const S = {view: 'vehicle', v2: 'top', mode: '2d', sel: null, R: null, hov: null, tab: 'wires', treeMode: 'sys',
  layers: {body: true, mech: true, parts: true, looms: true, clips: true, labels: false}, op: {body: 15, mech: 35}, loomCol: 'neutral',
  conn: null, sch: null, lib: null, xf: {}, onlySel: false, gq: {}, chip: {}, sort: {}, bomBy: 'kind', prov: false, texp: new Set(), shut: new Set(), faceText: 'wire'};
const KEEP = ['view', 'v2', 'tab', 'layers', 'op', 'loomCol', 'treeMode', 'prov', 'bomBy', 'faceText'];
try { const s = JSON.parse(localStorage.getItem('k5ws1') || '{}'); KEEP.forEach(k => { if (s[k] != null) S[k] = typeof S[k] === 'object' && !Array.isArray(S[k]) ? Object.assign(S[k], s[k]) : s[k]; }); } catch (e) {}
function keep() { try { const o = {}; KEEP.forEach(k => o[k] = S[k]); localStorage.setItem('k5ws1', JSON.stringify(o)); } catch (e) {} }
if (!D.views[S.v2]) S.v2 = 'top';
S.opened = new Set();
let db = null, user = null, myId = null, canWrite = null, notes = [], names = {}, dbState = 'loading';
if (S.mode === '3d' && !D.glb) S.mode = '2d';

// ---------------------------------------------------------------- relations: what a selection links to, in every pane
function relOf(id) {
  const R = {c: new Set(), w: new Set(), s: new Set(), p: new Set(), d: new Set(), y: new Set(), n: new Set()};
  if (!id) return R;
  const addWire = (wid, segs) => {
    const w = W[wid]; if (!w) return;
    R.w.add(wid); if (w.sub) R.y.add(w.sub);
    (w.ch || []).forEach(([ep, c]) => { R.c.add(ep); R.p.add(ep + '|' + c); if (byId[ep]) R.d.add(byId[ep].dev); });
    if (segs !== false) (w.segs || []).forEach(s => R.s.add(s));
  };
  const addConn = ep => {
    R.c.add(ep); const it = byId[ep]; if (it) R.d.add(it.dev);
    (PINS[ep] || []).forEach(p => { R.p.add(ep + '|' + p.c); p.w.forEach(x => addWire(x)); });
    ((it && it.route_segs) || []).forEach(s => R.s.add(s));
  };
  const ix = id.indexOf(':'), k = id.slice(0, ix), v = id.slice(ix + 1);
  if (k === 'c') addConn(v);
  else if (k === 'w') addWire(v);
  else if (k === 'p') { const ep = v.split('|')[0]; R.p.add(v); R.c.add(ep); ((pinByKey[v] || {}).w || []).forEach(x => addWire(x)); if (byId[ep]) R.d.add(byId[ep].dev); }
  else if (k === 's') { const s = segById[v]; if (s) { R.s.add(v); (s.wires || []).forEach(x => addWire(x, false)); [s.from_node, s.to_node].forEach(nid => { const n = nodeById[nid]; if (n) { R.n.add(nid); if (n.ep) R.c.add(n.ep); } }); } }
  else if (k === 'n') { const n = nodeById[v]; if (n) { R.n.add(v); if (n.ep) R.c.add(n.ep); (n.segments || []).forEach(s => R.s.add(s)); if (n.segment) R.s.add(n.segment); (n.wires || []).forEach(x => R.w.add(x)); } }
  else if (k === 'd') { const d = DEVS[v]; if (d) { R.d.add(v); d.conns.forEach(addConn); } }
  else if (k === 'y') { const y = SYS[v]; if (y) { R.y.add(v); y.wires.forEach(x => addWire(x)); } }
  else if (k === 'o') { const o = openById[v]; if (o) o.rel.forEach(r => { const q = relOf(r); Object.keys(R).forEach(key => q[key].forEach(x => R[key].add(x))); }); }
  return R;
}
const kindOf = id => !id ? null : id.startsWith('ctx:') ? 'ctx' : id.slice(0, id.indexOf(':'));
const valOf = id => id.startsWith('ctx:') ? id : id.slice(id.indexOf(':') + 1);
function priConn(ep) {
  if (!S.sel) return false;
  const k = kindOf(S.sel), v = valOf(S.sel);
  return (k === 'c' && v === ep) || (k === 'p' && v.split('|')[0] === ep) || (k === 'd' && DEVS[v] && DEVS[v].conns.includes(ep)) || (k === 'n' && nodeById[v] && nodeById[v].ep === ep);
}
function focusConn(id) {
  const k = kindOf(id), v = id && valOf(id);
  if (k === 'c') return v;
  if (k === 'p') return v.split('|')[0];
  if (k === 'd') return (DEVS[v] || {}).conns ? DEVS[v].conns[0] : null;
  if (k === 'w') { const ch = (W[v] || {}).ch || []; const f = ch.find(c => byId[c[0]] && byId[c[0]].conn && byId[c[0]].conn.face); return (f || ch[0] || [null])[0]; }
  if (k === 'n') return (nodeById[v] || {}).ep || null;
  if (k === 'o') { const r = ((openById[v] || {}).rel || []).find(x => x.startsWith('c:')); return r ? r.slice(2) : null; }
  return null;
}
function majSub(wids) { const c = {}; wids.forEach(x => { const s = (W[x] || {}).sub; if (s) c[s] = (c[s] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null; }
function focusSys(id) {
  const k = kindOf(id), v = id && valOf(id);
  if (k === 'y') return v;
  if (k === 'w') return (W[v] || {}).sub || null;
  if (k === 'c') { const ws = wiresOf(v); return ws.some(x => (W[x] || {}).sub === S.sch) ? S.sch : majSub(ws); }
  if (k === 'p') { const ws = (pinByKey[v] || {}).w || []; return ws.some(x => (W[x] || {}).sub === S.sch) ? S.sch : majSub(ws); }
  if (k === 'd') return (DEVS[v] || {}).sys || null;
  if (k === 's') return majSub((segById[v] || {}).wires || []);
  return null;
}
function focusLib(id) {
  const k = kindOf(id), v = id && valOf(id);
  if (k === 'c' || k === 'p') { const i = byId[k === 'p' ? v.split('|')[0] : v]; return i && i.lib ? i.lib : null; }
  if (k === 'd') return (DEVS[v] || {}).lib || null;
  if (k === 'L') return v;
  return null;
}
function labelOf(id) {
  const k = kindOf(id), v = valOf(id);
  if (k === 'c') return v; if (k === 'w') return 'wire ' + v; if (k === 'p') return v.replace('|', ':'); if (k === 's') return 'segment ' + v;
  if (k === 'n') return v; if (k === 'd') return devName(v); if (k === 'y') return sysName(v); if (k === 'o') return 'open item';
  if (k === 'ctx') return (ctxById[id] || {}).label || id; return id;
}
function goLink(id, text, cls) { return `<button type="button" class="linkish ${cls || 'mono'}" data-go="${esc(id)}">${esc(text == null ? labelOf(id) : text)}</button>`; }
function endLink(c) { return c ? (byId[c[0]] ? goLink('p:' + c[0] + '|' + c[1], endTxt(c)) : `<span class="mono">${esc(endTxt(c))}</span>`) : ''; }

// ---------------------------------------------------------------- header and summary strip
$('#built').textContent = `Built ${D.built} from main ${D.main}`;
function renderStrip() {
  $('#decs').innerHTML = (D.dec || []).map(d => `<button type="button" class="dec" data-sel="o:${esc(d.open)}" aria-pressed="${S.sel === 'o:' + d.open}" title="${esc(d.text)}"><b>${d.n}</b>${esc(d.title)}</button>`).join('');
  const c = D.cov || {};
  $('#cov').innerHTML = [
    ['drawn', `<b>${c.drawn}</b>/<b>${c.ends}</b> ends drawn to size`, ''],
    ['cad', `<b>${c.cad}</b> parts in true CAD`, ''],
    ['segs', `<b>${c.segs}</b> route segments`, ''],
    ['routed', `<b>${c.routed}</b>/<b>${c.wires}</b> wires routed`, ''],
    ['off', `<b>${c.off}</b> route landings outside margin`, c.off ? 'w' : ''],
    ['open', `<b>${c.open}</b> open items`, ''],
  ].map(([k, h, cls]) => `<button type="button" data-cov="${k}" class="${cls}">${h}</button>`).join('');
}
$('#decs').addEventListener('click', e => { const b = e.target.closest('[data-sel]'); if (b) { select(b.dataset.sel, 'strip'); setTab('open'); } });
$('#cov').addEventListener('click', e => {
  const b = e.target.closest('[data-cov]'); if (!b) return;
  const k = b.dataset.cov;
  if (k === 'drawn') { S.chip.conns = 'notdrawn'; setTab('conns'); }
  else if (k === 'cad') setView('lib');
  else if (k === 'segs') { S.treeMode = 'bun'; keep(); renderTree(); setView('vehicle'); openTree(); }
  else if (k === 'routed') { S.chip.wires = 'unrouted'; setTab('wires'); }
  else if (k === 'off') { S.chip.open = 'Route landing'; setTab('open'); }
  else if (k === 'open') { S.chip.open = ''; setTab('open'); }
});

// ---------------------------------------------------------------- project tree: systems > devices > connectors > pins, or bundles > segments > wires
const TREE = {sys: [], bun: []};
(function buildTree() {
  D.sys.forEach(y => {
    const devs = {};
    y.wires.forEach(wid => (W[wid].ch || []).forEach(([ep, c]) => {
      const dev = byId[ep] ? byId[ep].dev : ep;
      const d = devs[dev] = devs[dev] || {};
      const pins = d[ep] = d[ep] || new Set(); pins.add(c);
    }));
    const dnodes = Object.keys(devs).sort((a, b) => natCmp(devName(a), devName(b))).map(dev => ({
      id: 'd:' + dev, key: 'y:' + y.id + '/d:' + dev, label: devName(dev), kind: 'dev', count: Object.keys(devs[dev]).length,
      kids: Object.keys(devs[dev]).sort(natCmp).map(ep => ({
        id: 'c:' + ep, key: 'y:' + y.id + '/d:' + dev + '/c:' + ep, ti: ep, label: byId[ep] ? byId[ep].what : 'not in the ends list', kind: 'conn',
        count: devs[dev][ep].size,
        kids: [...devs[dev][ep]].sort(natCmp).map(c => {
          const p = pinByKey[ep + '|' + c] || {w: []};
          const ws = p.w.filter(x => (W[x] || {}).sub === y.id || y.id === 'NONE');
          return {id: 'p:' + ep + '|' + c, key: 'y:' + y.id + '/c:' + ep + '/p:' + c, ti: c, label: [p.n, ws.join(' ')].filter(Boolean).join(' · '), kind: 'pin'};
        })
      }))
    }));
    TREE.sys.push({id: 'y:' + y.id, key: 'y:' + y.id, label: y.name, ti: '', kind: 'sys', count: y.wires.length, cword: 'wires', kids: dnodes});
  });
  const unwired = items.filter(i => !wiresOf(i.id).length).map(i => i.id).sort(natCmp);
  if (unwired.length) TREE.sys.push({id: null, key: 'none', label: 'Unwired ends', kind: 'sys', count: unwired.length, cword: 'ends',
    kids: unwired.map(ep => ({id: 'c:' + ep, key: 'none/c:' + ep, ti: ep, label: byId[ep].what, kind: 'conn', kids: []}))});
  if (routes) {
    const g = {};
    routes.segments.forEach(s => (g[s.bundle || 'Other'] = g[s.bundle || 'Other'] || []).push(s));
    Object.entries(g).forEach(([b, segs]) => TREE.bun.push({id: null, key: 'b:' + b, label: b, kind: 'sys', count: segs.length, cword: 'segments',
      kids: segs.map(s => ({id: 's:' + s.id, key: 'b:' + b + '/s:' + s.id, ti: s.id, label: `${(s.wires || []).length} wires · ⌀${s.od_mm} mm`, kind: 'seg', count: (s.wires || []).length,
        kids: (s.wires || []).map(x => ({id: 'w:' + x, key: 'b:' + b + '/s:' + s.id + '/w:' + x, ti: x, label: (W[x] || {}).label || '', kind: 'wire'}))}))}));
  }
})();
function treeRows() {
  const q = ($('#tq').value || '').trim().toLowerCase();
  const roots = TREE[S.treeMode] || [];
  const out = [];
  if (q) {
    const hit = n => ((n.ti || '') + ' ' + n.label).toLowerCase().includes(q);
    const walk = (n, depth, trail) => {
      const self = hit(n), sub = [];
      (n.kids || []).forEach(k => walk(k, depth + 1, trail.concat([n])).forEach(r => sub.push(r)));
      if (self || sub.length) return [{n, depth, open: true}].concat(sub);
      return [];
    };
    roots.forEach(r => walk(r, 0, []).forEach(x => out.push(x)));
    return out.slice(0, 600);
  }
  const walk = (n, depth) => {
    const open = S.texp.has(n.key);
    out.push({n, depth, open});
    if (open) (n.kids || []).forEach(k => walk(k, depth + 1));
  };
  roots.forEach(r => walk(r, 0));
  return out;
}
function renderTree() {
  document.querySelectorAll('#treemode button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === S.treeMode));
  const rows = treeRows(), R = S.R || relOf(null);
  const relHit = n => {
    if (!n.id || !S.sel) return false;
    const k = kindOf(n.id), v = valOf(n.id);
    return (k === 'c' && R.c.has(v)) || (k === 'd' && R.d.has(v)) || (k === 'y' && R.y.has(v)) || (k === 'p' && R.p.has(v)) || (k === 's' && R.s.has(v)) || (k === 'w' && R.w.has(v));
  };
  $('#tlist').innerHTML = rows.length ? rows.map(({n, depth, open}) => {
    const has = n.kids && n.kids.length;
    const spare = n.kind === 'pin' && !(pinByKey[valOf(n.id)] || {w: []}).w.length;
    return `<div class="tn k-${n.kind}${n.id && n.id === S.sel ? ' sel' : ''}${relHit(n) && n.id !== S.sel ? ' rel' : ''}${spare ? ' spare' : ''}" role="treeitem" aria-level="${depth + 1}"${has ? ` aria-expanded="${open}"` : ''} data-key="${esc(n.key)}"${n.id ? ` data-id="${esc(n.id)}"` : ''} style="padding-left:${6 + depth * 14}px">`
      + `<span class="tw" data-tw="1">${has ? (open ? '▾' : '▸') : ''}</span>${n.ti ? `<span class="ti">${esc(n.ti)}</span>` : ''}<span class="tl">${esc(n.label)}</span>${n.count != null ? `<span class="tc">${n.count}${n.cword ? ' ' + n.cword : ''}</span>` : ''}</div>`;
  }).join('') + (rows.length >= 600 ? '<div class="tmore">First 600 matches shown. Type more to narrow it.</div>' : '') : '<div class="tmore">Nothing matches.</div>';
}
function revealInTree(id) {
  if (!id) return;
  const k = kindOf(id), v = valOf(id);
  if (S.treeMode === 'sys') {
    const y = focusSys(id), conn = focusConn(id);
    if (k === 'y') { S.texp.add('y:' + v); return; }
    if (!y && conn && !wiresOf(conn).length) { S.texp.add('none'); return; }
    if (!y) return;
    S.texp.add('y:' + y);
    if (k === 'w') { (W[v].ch || []).forEach(([ep]) => { const dev = byId[ep] ? byId[ep].dev : ep; S.texp.add('y:' + y + '/d:' + dev); }); return; }
    if (conn) { const dev = byId[conn] ? byId[conn].dev : conn; S.texp.add('y:' + y + '/d:' + dev); if (k === 'p') S.texp.add('y:' + y + '/d:' + dev + '/c:' + conn); }
    if (k === 'd') S.texp.add('y:' + y + '/d:' + v);
  } else if (k === 's') { const s = segById[v]; if (s) S.texp.add('b:' + (s.bundle || 'Other')); }
}
$('#tlist').addEventListener('click', e => {
  const row = e.target.closest('.tn'); if (!row) return;
  const key = row.dataset.key;
  if (e.target.closest('[data-tw]') || !row.dataset.id) { S.texp.has(key) ? S.texp.delete(key) : S.texp.add(key); renderTree(); return; }
  if (!S.texp.has(key)) S.texp.add(key);
  select(row.dataset.id, 'tree');
  if (window.matchMedia('(max-width:1320px)').matches && /^(c|p|w|s):/.test(row.dataset.id)) closeTree();
});
$('#tq').addEventListener('input', renderTree);
document.querySelectorAll('#treemode button').forEach(b => b.addEventListener('click', () => { S.treeMode = b.dataset.m; keep(); renderTree(); }));
function openTree() { if (window.matchMedia('(max-width:1320px)').matches) { $('#tree').classList.add('open'); $('#treebtn').setAttribute('aria-expanded', 'true'); } }
function closeTree() { $('#tree').classList.remove('open'); $('#treebtn').setAttribute('aria-expanded', 'false'); }
$('#treebtn').addEventListener('click', () => $('#tree').classList.contains('open') ? closeTree() : openTree());
function scrollTreeToSel() { const r = $('#tlist .tn.sel'); if (r) r.scrollIntoView({block: 'nearest'}); }

// ---------------------------------------------------------------- views
function setView(v) {
  S.view = v; keep();
  document.querySelectorAll('#vtabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
  ['vehicle', 'conn', 'sch', 'lib'].forEach(x => { $('#v-' + x).hidden = x !== v; });
  renderTools(); renderView();
}
document.querySelectorAll('#vtabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
function renderView() {
  $('#scale').textContent = ''; $('#cursor').textContent = ' ';
  if (S.view === 'vehicle') { if (S.mode === '3d') { T3.start(); T3.apply(); T3.loop(); $('#vcap').textContent = T3cap(); } else if (S.mode === 'renders') { if (!$('#vren').innerHTML) setMode('renders'); } else { setV2(S.v2, true); } renderLegend(); }
  else if (S.view === 'conn') renderConn();
  else if (S.view === 'sch') renderSch();
  else if (S.view === 'lib') renderLib();
  $('#vctx').textContent = S.sel ? labelOf(S.sel) : '';
}
function renderTools() {
  const t = $('#vtools');
  if (S.view === 'vehicle') {
    const lyr = [['body', 'Body'], ['mech', 'Engine, frame'], ['parts', 'Parts'], ['looms', 'Looms'], ['clips', 'Clips'], ['labels', 'Labels']];
    t.innerHTML = `<div class="grp"><div class="seg" id="v2seg">${[['top', 'Top'], ['side', 'Side'], ['bay', 'Bay']].map(([k, l]) => `<button type="button" data-v2="${k}" aria-pressed="${S.mode === '2d' && S.v2 === k}">${l}</button>`).join('')}${D.glb ? `<button type="button" data-v2="3d" aria-pressed="${S.mode === '3d'}">3D bay</button>` : ''}${(D.renders || []).length ? `<button type="button" data-v2="renders" aria-pressed="${S.mode === 'renders'}">Renders</button>` : ''}</div></div>`
      + `<div class="grp">${lyr.map(([k, l]) => `<button type="button" class="tg" data-ly="${k}" aria-pressed="${!!S.layers[k]}"${(k === 'looms' || k === 'clips') && !routes ? ' disabled' : ''}>${l}</button>`).join('')}</div>`
      + `<div class="grp"><label class="lab" for="op-body">Body</label><input type="range" id="op-body" min="0" max="100" step="5" value="${S.op.body}"><output id="op-body-o">${S.op.body}%</output></div>`
      + `<div class="grp"><button type="button" class="tg" data-lc="${S.loomCol === 'bundle' ? 'neutral' : 'bundle'}" aria-pressed="${S.loomCol === 'bundle'}" title="Colour each loom by its bundle">Colour by bundle</button></div>`;
  } else if (S.view === 'conn') {
    const ep = S.conn, dev = ep && byId[ep] ? DEVS[byId[ep].dev] : null;
    t.innerHTML = `<div class="grp"><span class="lab">Connector</span>${dev && dev.conns.length > 1 ? `<div class="seg">${dev.conns.map(c => `<button type="button" data-cn="${esc(c)}" aria-pressed="${c === ep}">${esc(c)}</button>`).join('')}</div>` : `<span class="mono">${esc(ep || 'none selected')}</span>`}</div>`
      + `<div class="grp"><span class="lab">Label</span><div class="seg" id="ftxt"><button type="button" data-ft="wire" aria-pressed="${S.faceText === 'wire'}">Wire</button><button type="button" data-ft="name" aria-pressed="${S.faceText === 'name'}">Pin name</button></div></div>`
      + `<span class="sp"></span><span class="muted">Viewed from the wire side</span>`;
  } else if (S.view === 'sch') {
    const opts = D.sys.map(y => `<option value="${esc(y.id)}"${y.id === S.sch ? ' selected' : ''}>${esc(y.name)} (${y.wires.length})</option>`).join('');
    t.innerHTML = `<div class="grp"><label class="lab" for="schsel">Circuit</label><select class="inp" id="schsel" style="width:auto">${opts}</select></div>`
      + `<span class="sp"></span><div class="grp"><button type="button" class="btn" data-sz="out" aria-label="Zoom out">−</button><button type="button" class="btn" data-sz="in" aria-label="Zoom in">+</button><button type="button" class="btn" data-sz="fit">Fit</button></div>`;
  } else {
    t.innerHTML = `<div class="grp"><div class="seg" id="libseg">${LIB.map(l => `<button type="button" data-lib="${esc(l.key)}" aria-pressed="${l.key === S.lib}">${esc(l.tab)}</button>`).join('')}</div></div>`
      + `<span class="sp"></span><div class="grp"><button type="button" class="btn" id="l-front">Front</button><button type="button" class="btn" id="l-wires">Wire side</button><button type="button" class="tg" id="l-plugs" aria-pressed="true">Plugs</button><button type="button" class="tg" id="l-keep" aria-pressed="false">Keep-out</button></div>`;
  }
}
$('#vtools').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.v2) { if (b.dataset.v2 === '3d' || b.dataset.v2 === 'renders') setMode(b.dataset.v2); else { setMode('2d'); setV2(b.dataset.v2); } renderTools(); return; }
  if (b.dataset.ly) { S.layers[b.dataset.ly] = !S.layers[b.dataset.ly]; b.setAttribute('aria-pressed', S.layers[b.dataset.ly]); keep(); applyOpacity(); drawSvg(); T3.apply(); return; }
  if (b.dataset.lc) { S.loomCol = b.dataset.lc; keep(); renderTools(); drawSvg(); renderLegend(); return; }
  if (b.dataset.cn) { select('c:' + b.dataset.cn, 'view'); return; }
  if (b.dataset.ft) { S.faceText = b.dataset.ft; keep(); renderTools(); renderConn(); return; }
  if (b.dataset.sz) { schZoom(b.dataset.sz); return; }
  if (b.dataset.lib) { S.lib = b.dataset.lib; renderTools(); renderLib(); return; }
  if (b.id === 'l-front') L3.front(); else if (b.id === 'l-wires') L3.wires();
  else if (b.id === 'l-plugs' || b.id === 'l-keep') { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); L3.toggle(b.id === 'l-plugs' ? 'plugs' : 'keep', on); }
});
function zoomCmd(z) {
  const r = vp.getBoundingClientRect();
  if (S.mode === '3d') { if (z === 'in') T3.zoom(1.4); else if (z === 'out') T3.zoom(1 / 1.4); else if (z === 'fit') T3.fit(); else T3.frame(); return; }
  if (z === 'in') zoomAt(1.6, r.width / 2, r.height / 2); else if (z === 'out') zoomAt(1 / 1.6, r.width / 2, r.height / 2); else if (z === 'fit') { S.xf[S.v2] = fitXf(); applyXf(); } else frameSel();
}
$('#zbar').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) zoomCmd(b.dataset.z); });
$('#vtools').addEventListener('input', e => { if (e.target.id === 'op-body') { S.op.body = +e.target.value; $('#op-body-o').textContent = S.op.body + '%'; applyOpacity(); keep(); } });
$('#vtools').addEventListener('change', e => { if (e.target.id === 'schsel') { S.sch = e.target.value; renderSch(); } });

// ---------------------------------------------------------------- vehicle, 2D: true-size parts and looms over the body model
const vp = $('#vp'), world = $('#world'), ov = $('#ov'), tip = $('#tip');
const V = () => D.views[S.v2];
function fitXf() { const r = vp.getBoundingClientRect(), v = V(); const k = Math.max(0.02, Math.min(r.width / v.w, r.height / v.h)) * 0.98; return {k, tx: (r.width - v.w * k) / 2, ty: (r.height - v.h * k) / 2, fit: k}; }
function xf() { return S.xf[S.v2] || (S.xf[S.v2] = fitXf()); }
let settleT = 0;
function applyXf(settle) {
  const t = xf();
  world.style.transform = `translate(${t.tx}px,${t.ty}px) scale(${t.k})`;
  ov.style.setProperty('--k', t.k);
  const mmPerPx = 1000 / (V().ppm * t.k);
  if (S.view === 'vehicle' && S.mode === '2d') $('#scale').textContent = `1 px = ${mmPerPx < 10 ? mmPerPx.toFixed(1) : Math.round(mmPerPx)} mm`;
  clearTimeout(settleT);
  if (settle !== false) settleT = setTimeout(drawSvg, 90);
}
function zoomAt(f, sx, sy) { const t = xf(), fit = fitXf().k; const k2 = Math.min(fit * 60, Math.max(fit * 0.6, t.k * f)); const wx = (sx - t.tx) / t.k, wy = (sy - t.ty) / t.k; t.k = k2; t.tx = sx - wx * k2; t.ty = sy - wy * k2; applyXf(); }
function centreOn(u, v) { const r = vp.getBoundingClientRect(), t = xf(); t.tx = r.width / 2 - u * t.k; t.ty = r.height / 2 - v * t.k; applyXf(); }
function inViewport(u, v) { const r = vp.getBoundingClientRect(), t = xf(); const sx = u * t.k + t.tx, sy = v * t.k + t.ty; return sx > 30 && sy > 30 && sx < r.width - 30 && sy < r.height - 30; }
function setV2(v, quiet) {
  S.v2 = v; keep();
  const vw = V();
  world.style.width = vw.w + 'px'; world.style.height = vw.h + 'px';
  if ($('#lyr-body').getAttribute('src') !== vw.layers.body) $('#lyr-body').src = vw.layers.body;
  if ($('#lyr-mech').getAttribute('src') !== vw.layers.mech) $('#lyr-mech').src = vw.layers.mech;
  ov.setAttribute('viewBox', `0 0 ${vw.w} ${vw.h}`);
  $('#vcap').textContent = vw.caption + ' Parts at true size and colour; looms at true outer diameter.';
  applyOpacity(); applyXf(false); drawSvg();
  if (!quiet) document.querySelectorAll('#v2seg button').forEach(b => b.setAttribute('aria-pressed', S.mode === '2d' && b.dataset.v2 === v));
}
function setMode(m) {
  S.mode = m;
  world.hidden = m !== '2d'; vp.hidden = m !== '2d'; $('#v3d').hidden = m !== '3d'; $('#vren').hidden = m !== 'renders'; $('#zbar').hidden = m === 'renders'; tip.hidden = true;
  if (m === '3d') { T3.start(); T3.apply(); T3.loop(); $('#vcap').textContent = T3cap(); $('#scale').textContent = ''; }
  else if (m === 'renders') { $('#vren').innerHTML = (D.renders || []).map(r => `<figure><img src="${esc(r.src)}" alt="${esc(r.cap)}" loading="lazy"><figcaption>${esc(r.cap)} <span class="faint">${esc(r.from)}</span></figcaption></figure>`).join(''); $('#vcap').textContent = "harness-cad's labelled renders of the engine-bay sample. Every route is a proposal; nothing is tape-measured."; $('#scale').textContent = ''; }
  else setV2(S.v2);
  renderLegend();
}
function T3cap() { return D.glb ? `3D engine bay: harness-cad's sample (${D.glb.made}). Drag to turn, right-drag to pan, scroll to zoom.` : ''; }
function applyOpacity() {
  $('#lyr-body').style.opacity = S.layers.body ? S.op.body / 100 : 0;
  $('#lyr-mech').style.opacity = S.layers.mech ? S.op.mech / 100 : 0;
  T3.apply();
}
function toWorld(u, v) { const vw = V(), c = vw.cam, p = vw.ppm; const y = c.cy + (u - vw.w / 2) / p; if (S.v2 === 'side') return {y, z: c.cz - (v - vw.h / 2) / p}; return {y, x: c.cx + (v - vw.h / 2) / p}; }
function ticksSvg(vw, k) {
  const p = vw.ppm, L1 = 14 / k, L2 = 8 / k, T = 24 / k, X = 3 / k;
  const inScreen = IN * p * k;
  const step = [1, 2, 5, 10, 20, 50].find(s => s * 2 * inScreen >= 46) || 100, lab = step * 2;
  let o = '<g class="tick">';
  const u0 = vw.w / 2 + (FRONT_AXLE - vw.cam.cy) * p, inPx = IN * p;
  for (let s = Math.ceil(-u0 / inPx / step) * step; u0 + s * inPx <= vw.w; s += step) {
    const u = u0 + s * inPx, big = s % lab === 0;
    o += `<line x1="${u}" y1="0" x2="${u}" y2="${big ? L1 : L2}"/>`;
    if (big) o += `<text x="${u + X}" y="${T}">${s}</text>`;
  }
  if (S.v2 === 'side') {
    const v0 = vw.h / 2 + vw.cam.cz * p;
    for (let s = 0; v0 - s * inPx >= 0; s += step) { const v = v0 - s * inPx, big = s % lab === 0; o += `<line x1="0" y1="${v}" x2="${big ? L1 : L2}" y2="${v}"/>`; if (big) o += `<text x="${17 / k}" y="${v + 4 / k}">${s}</text>`; }
  } else {
    const v0 = vw.h / 2 - vw.cam.cx * p;
    for (let s = Math.ceil(-v0 / inPx / step) * step; v0 + s * inPx <= vw.h; s += step) { const v = v0 + s * inPx, big = s % lab === 0; o += `<line x1="0" y1="${v}" x2="${big ? L1 : L2}" y2="${v}"/>`; if (big) o += `<text x="${17 / k}" y="${v + 4 / k}">${s === 0 ? 'CL' : (s > 0 ? s + ' D' : -s + ' P')}</text>`; }
  }
  return o + '</g>';
}
function shape(g, cls, extra) {
  const e = extra || '';
  if (g.round) return `<ellipse class="${cls}" cx="${g.cx}" cy="${g.cy}" rx="${g.w / 2}" ry="${g.h / 2}" ${e}/>`;
  const r = Math.min(g.w, g.h) * 0.12;
  return `<rect class="${cls}" x="${g.cx - g.w / 2}" y="${g.cy - g.h / 2}" width="${g.w}" height="${g.h}" rx="${r}" ${e}/>`;
}
const BUNDLE_COL = {};
['#2f6f9f', '#9a4a1f', '#5a7a2a', '#7a4d9a', '#a07a12', '#2f8a86', '#8a3d5c'].forEach((c, ix) => { const b = routes ? uniq(routes.segments.map(s => s.bundle || 'Other'))[ix] : null; if (b) BUNDLE_COL[b] = c; });
function drawSvg() {
  if (S.view !== 'vehicle' || S.mode !== '2d') return;
  const vw = V(), t = xf(), k = t.k, v = S.v2, R = S.R || relOf(null), has = !!S.sel;
  let o = ticksSvg(vw, k) + '<g class="axis">';
  vw.axes.forEach((a, ix) => { o += `<line x1="${a.u}" y1="${30 / k}" x2="${a.u}" y2="${vw.h}"/><text x="${a.u + 4 / k}" y="${vw.h - (ix % 2 ? 24 : 8) / k}">${esc(a.label)} ${a.station_in} IN</text>`; });
  o += '</g>';
  (D.context || []).forEach(c => {
    const g = c.draw[v]; if (!g) return;
    o += `<g class="ctx${S.sel === c.id ? ' pri' : ''}" data-ctx="${esc(c.id)}">${shape(g, 'b', 'style="pointer-events:all"')}<text x="${g.cx - g.w / 2 + 6 / k}" y="${g.cy - g.h / 2 + 14 / k}">${esc(c.label.toUpperCase())}${c.calls && c.calls.length ? ' · OPEN CALL' : ''}</text></g>`;
  });
  const partCls = i => {
    const ids = [i.id].concat(kids[i.id] || []);
    if (!has) return '';
    if (ids.some(priConn)) return ' pri';
    if (ids.some(x => R.c.has(x))) return ' rel';
    return ' dim';
  };
  if (S.layers.parts) {
    items.filter(i => i.drawn === 'own' && i.draw && i.draw[v]).sort((a, b) => b.draw[v].w * b.draw[v].h - a.draw[v].w * a.draw[v].h).forEach(i => {
      const g = i.draw[v];
      const hitR = Math.max(g.w, g.h, 12 / k) / 2;
      o += `<g class="part${partCls(i)}${S.hov === i.id ? ' hov' : ''}" data-id="${esc(i.id)}"><circle cx="${g.cx}" cy="${g.cy}" r="${hitR}" fill="transparent"/>${shape(g, 'b', `style="fill:${g.fill || 'var(--part-dim)'}"`)}</g>`;
    });
  }
  if (routes && S.layers.looms) {
    const offsetPts = (pts, d) => pts.map((p, ix) => { const a = pts[Math.max(0, ix - 1)], b = pts[Math.min(pts.length - 1, ix + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [p[0] - dy / L * d, p[1] + dx / L * d]; });
    const segs = routes.segments.slice().sort((a, b) => (R.s.has(a.id) ? 1 : 0) - (R.s.has(b.id) ? 1 : 0));
    segs.forEach(s => {
      const P = s.px[v] || []; if (P.length < 2) return;
      const wpx = Math.max((s.od_mm || 6) / 1000 * vw.ppm, 1.6 / k);
      const cls = !has ? '' : (S.sel === 's:' + s.id ? ' pri' : R.s.has(s.id) ? ' rel' : ' dim');
      const bad = s.checks_failed > 0;
      const off = ((s.od_mm || 6) / 2 + 2) / 1000 * vw.ppm;
      const lines = (s.parallel || 1) > 1 ? [offsetPts(P, off), offsetPts(P, -off)] : [P];
      const col = S.loomCol === 'bundle' ? (BUNDLE_COL[s.bundle || 'Other'] || 'var(--loom)') : 'var(--loom)';
      let g = '';
      lines.forEach(L => {
        const pts = L.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
        g += `<polyline class="edge" points="${pts}" stroke-width="${wpx + 1.6 / k}"/><polyline class="core" points="${pts}" style="stroke:${col}" stroke-width="${wpx}"/>`;
        if (bad) g += `<polyline class="flagln" points="${pts}"/>`;
      });
      const hit = P.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      o += `<g class="rt${cls}" data-seg="${esc(s.id)}">${g}<polyline points="${hit}" fill="none" stroke="transparent" stroke-width="${Math.max(wpx * 2, 12 / k)}"/></g>`;
    });
    routes.nodes.forEach(n => {
      const p = n.px[v], e = n.ep && byId[n.ep]; if (!p || !e || !n.off) return;
      const tg = drawnTarget(e), g = tg && tg.draw && tg.draw[v]; const q = g ? [g.cx, g.cy] : e.px[v];
      if (q) o += `<line class="gapln${has && R.c.has(e.id) ? ' rel' : ''}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"><title>${esc(n.id)}: route lands ${n.gap_mm} mm from ${esc(e.id)}'s spot</title></line>`;
    });
  }
  if (routes && S.layers.clips) {
    routes.nodes.concat(routes.clips).forEach(n => {
      const p = n.px[v]; if (!p) return;
      const r = 3.2 / k, kind = n.kind || (n.segment ? 'clip' : 'node');
      const cls = !has ? '' : (S.sel === 'n:' + n.id ? ' pri' : (R.n.has(n.id) || (n.segment && R.s.has(n.segment)) || (n.ep && R.c.has(n.ep))) ? ' rel' : ' dim');
      let g;
      const sz = n.size_mm || (n.d_mm ? [n.d_mm, n.d_mm, n.d_mm] : null);
      if (sz && kind !== 'clip') return;                    // a sized node is the part itself, drawn above
      if (kind === 'clip') g = `<rect class="b" x="${p[0] - r}" y="${p[1] - r}" width="${2 * r}" height="${2 * r}" style="fill:var(--panel)"/>`;
      else if (kind === 'splice') g = `<rect class="b" x="${p[0] - r * 1.4}" y="${p[1] - r * 0.7}" width="${2.8 * r}" height="${1.4 * r}" style="fill:var(--loom)"/>`;
      else if (kind === 'grommet') g = `<ellipse class="b" cx="${p[0]}" cy="${p[1]}" rx="${r * 1.4}" ry="${r * 1.4}" fill="none" stroke-width="${2 / k}"/>`;
      else if (kind === 'breakout') g = `<path class="b" d="M${p[0]} ${p[1] - r * 1.2}L${p[0] + r * 1.2} ${p[1]}L${p[0]} ${p[1] + r * 1.2}L${p[0] - r * 1.2} ${p[1]}Z" style="fill:var(--panel)"/>`;
      else return;
      o += `<g class="nd${cls}" data-node="${esc(n.id)}"><circle cx="${p[0]}" cy="${p[1]}" r="${8 / k}" fill="transparent"/>${g}</g>`;
    });
  }
  if (S.layers.labels && S.layers.parts) {
    items.filter(i => i.drawn === 'own' && i.draw && i.draw[v]).forEach(i => { const g = i.draw[v]; o += `<text class="lbl" x="${g.cx + g.w / 2 + 3 / k}" y="${g.cy + 3.5 / k}">${esc(i.id)}</text>`; });
  }
  // the selection: a halo on the part, its margin ring, or a crosshair where an undrawn end sits
  const selEnd = S.sel && (kindOf(S.sel) === 'c' || kindOf(S.sel) === 'p') ? byId[focusConn(S.sel)] : null;
  if (selEnd) {
    const m = effMargin(selEnd), mpx = m && m.mm != null ? m.mm / 1000 * vw.ppm : null;
    const tg = drawnTarget(selEnd), g = tg && tg.draw && tg.draw[v], pos = selEnd.px[v];
    if (g) {
      const pad = 5 / k;
      o += shape({cx: g.cx, cy: g.cy, w: g.w + 2 * pad, h: g.h + 2 * pad, round: g.round}, 'halo', '');
      if (mpx) o += `<circle class="mg" cx="${g.cx}" cy="${g.cy}" r="${mpx}"/>`;
      o += `<text class="lbl pri" x="${g.cx + g.w / 2 + 7 / k}" y="${g.cy - g.h / 2 - 5 / k}">${esc(selEnd.id)}</text>`;
    } else if (pos) {
      const L = Math.max(mpx || 0, 60 / 1000 * vw.ppm) * 1.35;
      o += `<line class="xh" x1="${pos[0] - L}" y1="${pos[1]}" x2="${pos[0] + L}" y2="${pos[1]}"/><line class="xh" x1="${pos[0]}" y1="${pos[1] - L}" x2="${pos[0]}" y2="${pos[1] + L}"/>`;
      if (mpx) o += `<circle class="mg" cx="${pos[0]}" cy="${pos[1]}" r="${mpx}"/>`;
      o += `<text class="lbl pri" x="${pos[0] + 6 / k}" y="${pos[1] - 6 / k}">${esc(selEnd.id)} (not drawn to size)</text>`;
    }
  }
  ov.innerHTML = o;
  ov.classList.toggle('has-sel', has);
}
function renderLegend() {
  const el = $('#legend');
  if (S.view !== 'vehicle' || S.mode === 'renders') { el.hidden = true; return; }
  el.hidden = false;
  const loom = S.loomCol === 'bundle' ? Object.entries(BUNDLE_COL).map(([b, c]) => `<span><i style="--c:${c}"></i>${esc(b.split(' (')[0].toLowerCase())}</span>`).join('') : `<span><i style="--c:var(--loom)"></i>loom, at true outer diameter</span>`;
  el.innerHTML = loom + (S.mode === '2d' ? `<span><i class="bx" style="--c:var(--part-edge);--f:#b9bfc5"></i>part, true size and colour</span>` : '')
    + `<span><i style="--c:var(--accent)"></i>selected and linked</span>` + (S.mode === '2d' ? `<span><i class="ds" style="--c:var(--warn)"></i>route landing outside margin</span>` : '')
    + (S.mode === '2d' && routes && S.layers.clips ? `<span><i class="bx" style="--c:var(--loom);width:8px;height:8px"></i>clip</span><span><i class="bx" style="--c:var(--loom);width:8px;height:8px;transform:rotate(45deg)"></i>breakout</span>` : '');
}
// pointer: drag pans, wheel zooms, two fingers pinch; a click without a drag selects
const ptrs = new Map();
let drag = null, pinch = null;
vp.addEventListener('pointerdown', e => {
  vp.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (ptrs.size === 1) { const t = xf(); drag = {x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty, moved: false}; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = {d: Math.hypot(a.x - b.x, a.y - b.y)}; drag = null; }
});
vp.addEventListener('pointermove', e => {
  const r = vp.getBoundingClientRect(), t = xf();
  const u = (e.clientX - r.left - t.tx) / t.k, v = (e.clientY - r.top - t.ty) / t.k;
  const w = toWorld(u, v), sta = (w.y - FRONT_AXLE) / IN;
  $('#cursor').textContent = S.v2 === 'side' ? `STA ${fmtIn(sta)} in   Z ${fmtIn(w.z / IN)} in` : `STA ${fmtIn(sta)} in   ${fmtIn(Math.abs(w.x / IN))} in ${w.x > 0.0005 ? 'driver' : w.x < -0.0005 ? 'passenger' : 'CL'}`;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, {x: e.clientX, y: e.clientY});
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d; return; }
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
      if (p.dataset.id) select('c:' + p.dataset.id, 'canvas');
      else if (p.dataset.seg) select('s:' + p.dataset.seg, 'canvas');
      else if (p.dataset.ctx) select(p.dataset.ctx, 'canvas');
      else { const n = nodeById[p.dataset.node]; select(n && n.ep && byId[n.ep] ? 'c:' + n.ep : 'n:' + p.dataset.node, 'canvas'); }
    }
  }
  if (drag && drag.moved) applyXf();
  drag = null; vp.classList.remove('panning');
}
vp.addEventListener('pointerup', endPtr);
vp.addEventListener('pointercancel', endPtr);
vp.addEventListener('pointerleave', () => { tip.hidden = true; setHov(null); });
vp.addEventListener('wheel', e => { e.preventDefault(); const r = vp.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, {passive: false});
vp.addEventListener('dblclick', e => { const r = vp.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
function showTip(html, e, box) { const r = box.getBoundingClientRect(); tip.innerHTML = html; tip.hidden = false; tip.style.left = Math.min(e.clientX - r.left + 14, r.width - 310) + 'px'; tip.style.top = Math.min(e.clientY - r.top + 14, r.height - 60) + 'px'; }
function hover(e) {
  const el = e.target.closest && e.target.closest('.part, .rt, .nd, .ctx');
  if (!el) { tip.hidden = true; setHov(null); return; }
  let html = '';
  if (el.dataset.id) { const i = byId[el.dataset.id]; html = `<b>${esc(i.what)}</b><span class="mono">${esc(i.id)} · ${esc(sizeText(i.fp))}</span>`; setHov(i.id); }
  else if (el.dataset.seg) { const s = segById[el.dataset.seg]; html = `<b>${esc(s.id)} · ${esc((s.bundle || '').split(' (')[0])}</b><span class="mono">${(s.wires || []).length} wires · ⌀${esc(s.od_mm)} mm${(s.parallel || 1) > 1 ? ' ×' + s.parallel : ''} · ${mm((s.length_m || 0) * 1000)} ± ${esc(s.margin_mm)} mm</span>`; }
  else if (el.dataset.ctx) { const c = ctxById[el.dataset.ctx]; html = `<b>${esc(c ? c.label : '')}</b><span class="mono">body model context${c && c.calls && c.calls.length ? ' · open call' : ''}</span>`; }
  else { const n = nodeById[el.dataset.node]; html = `<b>${esc((n.kind || 'clip') + ' ' + n.id)}</b><span class="mono">${esc(n.pn || 'part number not set')}${n.ep ? ' · lands on ' + esc(n.ep) : ''}</span>`; }
  showTip(html, e, $('#v-vehicle'));
}
function setHov(id) {
  if (S.hov === id) return;
  S.hov = id;
  ov.querySelectorAll('.part.hov').forEach(n => n.classList.remove('hov'));
  if (id) { const n = ov.querySelector(`.part[data-id="${CSS.escape(id)}"]`); if (n) n.classList.add('hov'); }
}
new ResizeObserver(() => { const t = S.xf[S.v2]; if (!t || Math.abs(t.k - t.fit) < 1e-9) S.xf[S.v2] = fitXf(); applyXf(); }).observe(vp);
function frameSel() {
  const k = kindOf(S.sel), v = S.sel && valOf(S.sel), vw = V(), r = vp.getBoundingClientRect();
  let pts = [];
  if (k === 's') pts = ((segById[v] || {}).px || {})[S.v2] || [];
  else if (k === 'n') pts = [((nodeById[v] || {}).px || {})[S.v2]].filter(Boolean);
  else if (k === 'w' || k === 'y' || k === 'o' || k === 'd') {
    const R = S.R;
    R.s.forEach(sid => { ((segById[sid] || {}).px || {})[S.v2] && segById[sid].px[S.v2].forEach(p => pts.push(p)); });
    R.c.forEach(ep => { const i = byId[ep], tg = drawnTarget(i), g = tg && tg.draw && tg.draw[S.v2]; const p = g ? [g.cx, g.cy] : i && i.px[S.v2]; if (p) pts.push(p); });
  }
  if (pts.length) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.3 * vw.ppm) * 1.4;
    const t = xf(); t.k = Math.min(Math.max(Math.min(r.width, r.height) / span, fitXf().k), fitXf().k * 60);
    centreOn((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2); return;
  }
  const i = byId[focusConn(S.sel)]; if (!i) return;
  const tg = drawnTarget(i), g = tg && tg.draw && tg.draw[S.v2], p = i.px[S.v2];
  if (!g && !p) return;
  const m = effMargin(i);
  const span = Math.max(g ? Math.max(g.w, g.h) : 0, (m && m.mm ? m.mm * 2 : 300) / 1000 * vw.ppm) * 3.2;
  const t = xf(); t.k = Math.min(Math.max(Math.min(r.width, r.height) / span, fitXf().k), fitXf().k * 60);
  centreOn(g ? g.cx : p[0], g ? g.cy : p[1]);
}
function ensureVisible() {
  const ep = focusConn(S.sel), i = ep && byId[ep];
  if (!i || S.mode !== '2d') return;
  const tg = drawnTarget(i), has = v => (tg && tg.draw && tg.draw[v]) || i.px[v];
  if (!has(S.v2)) { const nv = ['bay', 'top', 'side'].find(v => has(v) && (v !== 'bay' || i.zone === 'engine' || i.zone === 'firewall')) || ['top', 'side'].find(has); if (nv) { S.v2 = nv; setV2(nv); renderTools(); } }
  const g = tg && tg.draw && tg.draw[S.v2], p = i.px[S.v2], c = g ? [g.cx, g.cy] : p;
  if (c && !inViewport(c[0], c[1])) centreOn(c[0], c[1]);
}

// ---------------------------------------------------------------- vehicle, 3D: harness-cad's bay sample (three.js r128, loaded on demand)
const THREE_SRC = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/environments/RoomEnvironment.js'];
const loadScript = src => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('could not load ' + src.split('/').slice(-1)[0])); document.head.appendChild(s); });
let threeP = null;
function three() { if (!threeP) threeP = (async () => { for (const s of THREE_SRC) await loadScript(s); if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls) throw new Error('the 3D libraries did not load'); })(); return threeP; }
function b64bytes(b64) { const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return bytes; }
function sheetColor() { return getComputedStyle(document.documentElement).getPropertyValue('--sheet').trim() || '#fbfbfc'; }
const T3 = (function () {
  const box = $('#v3d'), msg = $('#v3d-msg');
  let started = false, ready = false, renderer, scene, camera, controls, root, raf = 0, marker = null;
  const metas = [];
  const say = t => { msg.textContent = t; msg.hidden = !t; };
  const E3 = [[/^E3_Coil_(\d)$/, m => 'COIL-' + m[1]], [/^E3_Injector_(\d)$/, m => 'INJ-' + m[1]], [/^E3_ThrottleBody/, () => 'TB'],
    [/^E3_Alternator_197/, () => 'ALTERNATOR-SENSE'], [/^E3_Starter_DFSR/, () => 'STARTER-S'], [/^E3_AC_(Clutch|Compressor)/, () => 'AC-CLUTCH']];
  function classify(o) {
    const name = o.name || '', ex = o.userData || {};
    if (segById[name]) return {kind: 'route', id: 's:' + name};
    const pair = name.match(/^(.+)_[ab]$/); if (pair && segById[pair[1]]) return {kind: 'route', id: 's:' + pair[1]};
    if (nodeById[name] && nodeById[name].segment) return {kind: 'clip', id: 'n:' + name};
    if (/^CTX-/.test(name)) return {kind: 'body', id: null};
    for (const [rx, f] of E3) { const m = name.match(rx); if (m && byId[f(m)]) return {kind: 'engine', id: 'c:' + f(m)}; }
    if (/^E3_/.test(name)) return {kind: 'engine', id: null};
    const ep = ex.endpoint || ex.id;
    if (ep && byId[ep]) return {kind: 'part', id: 'c:' + ep};
    const base = name.replace(/_seg\d+$/, '').replace(/_(post_pos|post_neg|stud_[AB]|top|fill)$/, '');
    if (byId[base]) return {kind: 'part', id: 'c:' + base};
    return {kind: 'part', id: null};
  }
  function start() {
    if (started || !D.glb) return; started = true;
    say('Loading the 3D model of the engine bay...');
    (async () => {
      await three();
      if (!window.K5_BAY_GLB) await loadScript(D.glb.src);
      try { renderer = new THREE.WebGLRenderer({antialias: true}); } catch (e) { throw new Error('this browser has no WebGL'); }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE.sRGBEncoding;
      box.appendChild(renderer.domElement);
      scene = new THREE.Scene(); scene.background = new THREE.Color(sheetColor());
      try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; } catch (e) {}
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(0.6, 1, 0.8); scene.add(key);
      camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
      controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
      new ResizeObserver(resize).observe(box); resize();
      const gltf = await new Promise((ok, no) => new THREE.GLTFLoader().parse(b64bytes(window.K5_BAY_GLB).buffer, '', ok, no));
      root = gltf.scene; scene.add(root);
      root.traverse(o => {
        if (!o.isMesh) return;
        let c = classify(o); if (!c.id && o.parent && o.parent !== root) { const p = classify(o.parent); if (p.id) c = p; }
        o.material = o.material.clone();
        const m = o.material; if (m.metalness > 0.9) m.metalness = 0.6; m.roughness = Math.max(m.roughness, 0.35);
        metas.push({mesh: o, kind: c.kind, id: c.id, base: {opacity: m.opacity, transparent: m.transparent, emissive: m.emissive ? m.emissive.clone() : null, color: m.color ? m.color.clone() : null}});
      });
      fit(); ready = true; say(''); apply(); loop();
    })().catch(e => { say('The 3D view could not start here: ' + (e && e.message || e) + '. The top, side and bay drawings show the same parts.'); });
  }
  function resize() { if (!renderer) return; const w = box.clientWidth || 600, h = box.clientHeight || 400; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function fit(obj) {
    const bb = new THREE.Box3().setFromObject(obj || root), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z, obj ? 0.25 : 0);
    camera.position.set(c.x + r * 0.9, c.y + r * 0.75, c.z + r * 1.25); camera.near = r / 200; camera.far = r * 60; camera.updateProjectionMatrix();
    controls.target.copy(c); controls.update();
  }
  function loop() { cancelAnimationFrame(raf); if (S.view !== 'vehicle' || S.mode !== '3d' || !ready) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }
  const grey = new (function () { this.set = () => {}; })();
  function apply() {
    if (!ready) return;
    const R = S.R || relOf(null), has = !!S.sel;
    let hit = false;
    metas.forEach(t => {
      const m = t.mesh.material, b = t.base;
      t.mesh.visible = t.kind === 'route' ? S.layers.looms : t.kind === 'clip' ? S.layers.clips : t.kind === 'part' ? S.layers.parts : t.kind === 'body' ? S.layers.body : t.kind === 'engine' ? S.layers.mech : true;
      let op = b.opacity;
      if (t.kind === 'body') op *= S.op.body / 100 * 2;
      if (t.kind === 'engine') op *= S.op.mech / 100 * 1.6;
      const id = t.id, k = id ? kindOf(id) : null, v = id ? valOf(id) : null;
      const pri = has && id && (id === S.sel || (k === 'c' && priConn(v)));
      const rel = has && id && !pri && ((k === 'c' && R.c.has(v)) || (k === 's' && R.s.has(v)) || (k === 'n' && R.n.has(v)));
      if (pri || rel) hit = true;
      if (has && !pri && !rel && t.kind !== 'body' && t.kind !== 'engine') op *= 0.85;
      m.opacity = Math.min(1, op); m.transparent = b.transparent || op < 0.999; m.depthWrite = op > 0.5;
      if (m.color && b.color) { if (rel) m.color.set(0x6f9fe6); else if (has && !pri && t.kind !== 'body') { m.color.copy(b.color); const hsl = {}; m.color.getHSL(hsl); m.color.setHSL(hsl.h, hsl.s * 0.12, Math.min(0.62, hsl.l * 0.85)); } else m.color.copy(b.color); }
      if (m.emissive) { if (pri) { m.emissive.set(0x1f6fe0); m.emissiveIntensity = 0.85; } else if (rel) { m.emissive.set(0x0b3f99); m.emissiveIntensity = 0.35; } else if (b.emissive) { m.emissive.copy(b.emissive); m.emissiveIntensity = 1; } }
      m.needsUpdate = true;
    });
    if (marker) { scene.remove(marker); marker = null; }
    const i = byId[focusConn(S.sel) || ''];
    if (i && !hit) {                        // not in the model: mark its spot (glTF X, Y, Z = twin x, z, -y)
      const [x, y, z] = i.xyz, mg = effMargin(i), r = Math.max(0.012, (mg && mg.mm ? mg.mm : 30) / 1000);
      marker = new THREE.Group();
      marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 12), new THREE.MeshBasicMaterial({color: 0x1f6fe0})));
      marker.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({color: 0x1f6fe0, wireframe: true, transparent: true, opacity: 0.35})));
      marker.position.set(x, z, -y); scene.add(marker);
    }
  }
  function frame() {
    if (!ready) return;
    const ms = metas.filter(t => t.id && (t.id === S.sel || (kindOf(t.id) === 'c' && priConn(valOf(t.id))))).map(t => t.mesh);
    if (ms.length) { const g = new THREE.Box3(); ms.forEach(m => g.expandByObject(m)); const c = g.getCenter(new THREE.Vector3()), s = g.getSize(new THREE.Vector3()); const r = Math.max(s.x, s.y, s.z, 0.25); camera.position.set(c.x + r * 1.1, c.y + r * 0.9, c.z + r * 1.4); controls.target.copy(c); controls.update(); }
    else if (marker) { const c = marker.position.clone(); camera.position.set(c.x + 0.5, c.y + 0.45, c.z + 0.7); controls.target.copy(c); controls.update(); }
  }
  function zoom(f) { if (!ready) return; const d = camera.position.clone().sub(controls.target).multiplyScalar(1 / f); camera.position.copy(controls.target).add(d); controls.update(); }
  let down = null;
  function pick(ev) {
    const rc = renderer.domElement.getBoundingClientRect(), rr = new THREE.Raycaster();
    rr.setFromCamera(new THREE.Vector2(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1), camera);
    const hits = rr.intersectObjects(metas.filter(t => t.mesh.visible && t.kind !== 'body').map(t => t.mesh), false);
    return hits.length ? metas.find(t => t.mesh === hits[0].object) : null;
  }
  box.addEventListener('pointerdown', ev => { down = {x: ev.clientX, y: ev.clientY}; });
  box.addEventListener('pointerup', ev => { if (!ready || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) { down = null; return; } down = null; const t = pick(ev); if (t && t.id) select(t.id, 'canvas'); });
  box.addEventListener('pointermove', ev => {
    if (!ready || down) return;
    const t = pick(ev);
    if (!t) { tip.hidden = true; return; }
    const i = t.id && kindOf(t.id) === 'c' && byId[valOf(t.id)], s = t.id && kindOf(t.id) === 's' && segById[valOf(t.id)];
    showTip(i ? `<b>${esc(i.what)}</b><span class="mono">${esc(i.id)}</span>` : s ? `<b>${esc(s.id)}</b><span class="mono">${esc((s.bundle || '').split(' (')[0])} · ${(s.wires || []).length} wires</span>` : `<b>${esc(t.mesh.name.replace(/_/g, ' '))}</b><span class="mono">${esc(t.kind)}</span>`, ev, $('#v-vehicle'));
    $('#cursor').textContent = t.mesh.name;
  });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
  return {start, apply, frame, zoom, fit: () => ready && fit(), loop};
})();

// ---------------------------------------------------------------- connector view: the face from the wire side, pins in their wire colours
function renderConn() {
  const el = $('#v-conn'), ep = S.conn, it = ep && byId[ep];
  $('#vcap').textContent = '';
  if (!it) { el.innerHTML = `<div class="vmsg">Select a connector, a pin or a wire to see its connector face.</div>`; return; }
  const pins = PINS[ep] || [], c = it.conn || {}, R = S.R || relOf(null), has = !!S.sel;
  const selPin = kindOf(S.sel) === 'p' ? valOf(S.sel) : null;
  const pcls = p => { const key = ep + '|' + p.c; if (!has) return ''; if (key === selPin) return ' pri'; if (R.p.has(key) && (kindOf(S.sel) !== 'c' || p.w.length)) return kindOf(S.sel) === 'c' ? '' : ' rel'; return kindOf(S.sel) === 'c' ? '' : ' dim'; };
  const head = `<div class="chd"><h2 class="mono">${esc(ep)}</h2><span>${esc(it.what)}</span><span class="muted">${esc(c.family_word || '')}${c.cav_n != null ? ` · ${c.cav_n} cavities` : ''} · ${c.used || 0} used</span></div>`;
  const face = pins.filter(p => p.xy);
  if (face.length >= 2) {
    const xs = face.map(p => p.xy[0]), ys = face.map(p => p.xy[1]);
    let pitch = Infinity;
    face.forEach((a, ia) => face.forEach((b, ib) => { if (ia < ib) { const d = Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]); if (d > 0.01 && d < pitch) pitch = d; } }));
    if (!isFinite(pitch)) pitch = 5;
    const r = pitch * 0.34, pad = pitch * 1.1;
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = -Math.max(...ys) - pad, y1 = -Math.min(...ys) + pad + pitch * 0.9;
    const fs = pitch * 0.3;
    let s = `<rect class="fframe" x="${x0 + pad * 0.45}" y="${y0 + pad * 0.45}" width="${x1 - x0 - pad * 0.9}" height="${y1 - y0 - pad * 0.9}" rx="${pitch * 0.4}"/>`;
    const lum = hex => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255 : 1; };
    face.forEach(p => {
      const cx = p.xy[0], cy = -p.xy[1], w = W[p.w[0]], col = w ? wcol(w.color) : null;
      const fill = col ? col.base : 'var(--panel)';
      const lab = S.faceText === 'name' ? (p.n || '') : p.w.join(' ');
      const ink = col && lum(col.base) < 0.55 ? '#ffffff' : '#111418';
      s += `<g class="cav${p.w.length ? '' : ' spare'}${pcls(p)}" data-pin="${esc(ep + '|' + p.c)}"><title>${esc(p.c + (p.n ? ' ' + p.n : '') + (p.f ? ' · ' + p.f : '') + (p.w.length ? ' · wire ' + p.w.join(', ') : ' · spare'))}</title>`
        + `<circle class="c" cx="${cx}" cy="${cy}" r="${r}" style="fill:${fill}"/>`
        + (col && col.stripe ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.8}" fill="none" stroke="${col.stripe}" stroke-width="${r * 0.3}"/>` : '')
        + `<circle class="ring" cx="${cx}" cy="${cy}" r="${r * 1.22}"/>`
        + `<text x="${cx}" y="${cy}" style="font-size:${fs * (String(p.c).length > 2 ? 0.78 : 0.95)}px;fill:${p.w.length ? ink : 'var(--faint)'}">${esc(p.c)}</text>`
        + (lab ? `<text class="nm" x="${cx}" y="${cy + r * 1.22 + fs * 0.95}" style="font-size:${fs * 0.72}px">${esc(lab.length > 11 ? lab.slice(0, 10) + '…' : lab)}</text>` : '') + '</g>';
    });
    const src = it.pins_src || {};
    el.innerHTML = `<div class="cface">${head}<div class="fsvg"><svg viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" preserveAspectRatio="xMidYMid meet">${s}</svg></div></div>`;
    $('#vcap').textContent = `Cavity centres at true pitch from ${src.file || 'pins.json'}, wire side, row 1 on top and cavity 1 on the left as the maker numbers them. Fill is the wire's insulation colour, the ring its tracer; dashed is spare.`;
  } else {
    const cells = pins.map(p => { const w = W[p.w[0]]; return `<div class="cc${pcls(p)}" data-pin="${esc(ep + '|' + p.c)}"><span class="k">${esc(p.c || '(no cavity)')}</span><span class="v">${wswatch(w && w.color)} ${esc(p.w.join(' ') || 'spare')}</span><span class="v">${esc(p.n || (w ? gaugeOf(w) + ' ' + (w.color || '') : ''))}</span></div>`; }).join('');
    el.innerHTML = `<div class="clist">${head.replace('class="chd"', 'class="chd" style="padding:0 0 8px"')}<p class="fine" style="margin:0 0 10px">No cavity layout is on file for this connector, so its cavities are listed in order instead of drawn on a face. The face is drawn once its maker's cavity drawing is read into pins.json.</p><div class="cgrid">${cells || '<span class="muted">No cavities terminated in the registry.</span>'}</div></div>`;
  }
}
$('#v-conn').addEventListener('click', e => { const g = e.target.closest('[data-pin]'); if (g) select('p:' + g.dataset.pin, 'view'); });

// ---------------------------------------------------------------- schematic: a block diagram of one circuit, generated from the registry's terminations
const SCH = {cache: {}, xf: null, sys: null};
function schLayout(sysId) {
  if (SCH.cache[sysId]) return SCH.cache[sysId];
  const y = SYS[sysId]; if (!y) return null;
  const PASSRX = /^(FIREWALL-|SPL-|RAIL-)|PASS/;
  const devOf = ep => byId[ep] ? byId[ep].dev : ep;
  const isPass = ep => PASSRX.test(ep);
  const rowKey = (ep, c) => isPass(ep) ? devOf(ep) + '|' + c : ep + '|' + c;   // a pass-through's two sides share one row
  const score = {}, rows = {};
  y.wires.forEach(wid => {
    const ch = W[wid].ch || [];
    ch.forEach(([ep, c], ix) => {
      const dev = devOf(ep), key = rowKey(ep, c);
      const r = (rows[dev] = rows[dev] || {})[key] = (rows[dev] || {})[key] || {key, ep, c, wires: [], eps: new Set()};
      r.wires.push(wid); r.eps.add(ep);
      if (!isPass(ep)) score[dev] = (score[dev] || 0) + (ix === 0 ? 1 : ix === ch.length - 1 ? -1 : 0);
    });
  });
  const devs = Object.keys(rows);
  const isPassDev = d => (DEVS[d] ? DEVS[d].conns.every(isPass) : isPass(d));
  const cols = [[], [], []];
  devs.forEach(d => cols[isPassDev(d) ? 1 : (score[d] || 0) > 0 ? 0 : 2].push(d));
  if (!cols[0].length && cols[2].length) { cols[2].sort((a, b) => Object.keys(rows[b]).length - Object.keys(rows[a]).length); cols[0].push(cols[2].shift()); }
  const ROW = 17, HDR = 34, GAP = 22, BW = [236, 168, 236], laneW = 6;
  const place = {};
  const layCol = (ci, order) => { let yy = 40; order.forEach(d => { const rs = Object.values(rows[d]).sort((a, b) => natCmp(a.key, b.key)); const h = HDR + rs.length * ROW + 6; place[d] = {ci, y: yy, h, rows: rs}; rs.forEach((r, ix) => { r.y = yy + HDR + ix * ROW + ROW / 2; r.dev = d; }); yy += h + GAP; }); return yy; };
  const bary = d => { const ys = []; Object.values(rows[d]).forEach(r => r.wires.forEach(wid => (W[wid].ch || []).forEach(([ep, c]) => { const od = devOf(ep); if (od !== d && place[od]) { const rr = place[od].rows.find(x => x.key === rowKey(ep, c)); if (rr) ys.push(rr.y); } }))); return ys.length ? ys.reduce((p, q) => p + q, 0) / ys.length : 1e9; };
  cols[0].sort((a, b) => Object.keys(rows[b]).length - Object.keys(rows[a]).length);
  const hL = layCol(0, cols[0]);
  cols[1].sort((a, b) => bary(a) - bary(b)); const hM = layCol(1, cols[1]);
  cols[2].sort((a, b) => bary(a) - bary(b)); const hR = layCol(2, cols[2]);
  const has1 = cols[1].length > 0, has2 = cols[2].length > 0;
  // hops: each pair of neighbouring ends on a wire, between two pin rows
  const hops = [];
  y.wires.forEach(wid => {
    const ch = W[wid].ch || [];
    const rr = ch.map(([ep, c]) => { const p = place[devOf(ep)]; return p ? p.rows.find(r => r.key === rowKey(ep, c)) : null; });
    for (let ix = 0; ix < rr.length - 1; ix++) if (rr[ix] && rr[ix + 1] && rr[ix] !== rr[ix + 1]) hops.push({wid, a: rr[ix], b: rr[ix + 1]});
    if (ch.length === 1 && rr[0]) hops.push({wid, a: rr[0], b: null});
  });
  // channels: A right of column 0, B right of column 1, C right of column 2; each hop gets its own lane
  const chA = [], chB = [], chC = [], over = [];
  hops.forEach(h => {
    if (!h.b) return;
    const ca = place[h.a.dev].ci, cb = place[h.b.dev].ci, lo = Math.min(ca, cb), hi = Math.max(ca, cb);
    h.lo = lo; h.hi = hi;
    if (lo === hi) (lo === 0 ? chA : lo === 1 ? chB : chC).push(h);
    else if (lo === 0 && hi === 1) chA.push(h);
    else if (lo === 1 && hi === 2) chB.push(h);
    else if (!has1) chA.push(h);
    else { over.push(h); chA.push(h); chB.push(h); }
  });
  const byTop = (p, q) => Math.min(p.a.y, p.b.y) - Math.min(q.a.y, q.b.y);
  [chA, chB, chC].forEach(c => c.sort(byTop));
  const wA = Math.max(70, chA.length * laneW + 44), wB = Math.max(70, chB.length * laneW + 44);
  const X = [20, 0, 0];
  X[1] = X[0] + BW[0] + wA;
  X[2] = has1 ? X[1] + BW[1] + wB : X[1];
  Object.values(place).forEach(p => { p.x = X[p.ci]; p.w = BW[p.ci]; });
  const laneX = (c, h) => { const ix = c.indexOf(h); return c === chA ? X[0] + BW[0] + 22 + ix * laneW : c === chB ? X[1] + BW[1] + 22 + ix * laneW : X[2] + BW[2] + 22 + ix * laneW; };
  const bottom = Math.max(hL, hM, hR);
  over.sort(byTop);
  hops.forEach(h => {
    const pa = place[h.a.dev];
    if (!h.b) { h.d = `M${pa.x + pa.w} ${h.a.y}h40`; h.ax = pa.x + pa.w; h.side = 'r'; return; }
    const pb = place[h.b.dev], ca = pa.ci, cb = pb.ci;
    if (ca === cb) { const x = laneX(ca === 0 ? chA : ca === 1 ? chB : chC, h); h.ax = pa.x + pa.w; h.side = 'r'; h.d = `M${h.ax} ${h.a.y}H${x}V${h.b.y}H${pb.x + pb.w}`; return; }
    const aRight = ca < cb;
    h.ax = aRight ? pa.x + pa.w : pa.x; h.side = aRight ? 'r' : 'l';
    const bx = aRight ? pb.x : pb.x + pb.w;
    if (over.includes(h)) {
      const xa = laneX(chA, h), xb = laneX(chB, h), yb = bottom + 10 + over.indexOf(h) * laneW;
      const [x1, x2] = aRight ? [xa, xb] : [xb, xa];
      h.d = `M${h.ax} ${h.a.y}H${x1}V${yb}H${x2}V${h.b.y}H${bx}`;
    } else {
      const x = laneX(h.lo === 0 ? chA : chB, h);
      h.d = `M${h.ax} ${h.a.y}H${x}V${h.b.y}H${bx}`;
    }
  });
  // one label per pin row and side: the wires that leave it there
  const labels = {};
  hops.forEach(h => { const key = h.a.key + '|' + h.side + '|' + h.a.dev; const L = labels[key] = labels[key] || {x: h.ax + (h.side === 'r' ? 4 : -4), y: h.a.y - 3, anchor: h.side === 'r' ? 'start' : 'end', wires: []}; if (!L.wires.includes(h.wid)) L.wires.push(h.wid); });
  const width = (has2 ? X[2] + BW[2] : X[1] + (has1 ? BW[1] : 0)) + 40 + chC.length * laneW;
  const height = bottom + 20 + over.length * laneW + 10;
  const L = {sysId, place, hops, labels: Object.values(labels), cols, X, BW, width, height, ROW, HDR};
  SCH.cache[sysId] = L;
  return L;
}
function schSvg(L) {
  const R = S.R || relOf(null), has = !!S.sel && S.sel !== 'y:' + L.sysId;
  const selPin = kindOf(S.sel) === 'p' ? valOf(S.sel) : null;
  const wcls = wid => !has ? '' : (S.sel === 'w:' + wid ? ' pri' : R.w.has(wid) ? ' rel' : ' dim');
  let o = `<text class="scol" x="${L.X[0]}" y="22">Sources and controllers</text>` + (L.cols[1].length ? `<text class="scol" x="${L.X[1]}" y="22">Pass-throughs and splices</text>` : '') + (L.cols[2].length ? `<text class="scol" x="${L.X[2]}" y="22">Loads and sensors</text>` : '');
  const order = L.hops.slice().sort((p, q) => (wcls(p.wid) ? 1 : 0) - (wcls(q.wid) ? 1 : 0));
  order.forEach(h => { const w = W[h.wid] || {}; o += `<g data-w="${esc(h.wid)}"><path class="shit" d="${h.d}"/><path class="swire${w.kind === 'implied' ? ' imp' : ''}${wcls(h.wid)}" d="${h.d}"/></g>`; });
  L.labels.forEach(lb => {
    const hot = has && lb.wires.some(x => R.w.has(x));
    const w0 = W[lb.wires[0]] || {};
    const txt = lb.wires.length === 1 ? `${lb.wires[0]} ${w0.awg || ''} ${w0.color || ''}` : `${lb.wires.slice(0, 2).join(' ')}${lb.wires.length > 2 ? ' +' + (lb.wires.length - 2) : ''}`;
    o += `<text class="swl${hot ? ' rel' : ''}" x="${lb.x}" y="${lb.y}" text-anchor="${lb.anchor}">${esc(txt.trim())}</text>`;
  });
  Object.entries(L.place).forEach(([dev, p]) => {
    const conns = uniq(p.rows.flatMap(r => [...r.eps]));
    const relBox = has && (conns.some(c => R.c.has(c)) || R.d.has(dev));
    o += `<g class="sbox${relBox ? ' rel' : ''}${has && !relBox ? ' dim' : ''}" data-dev="${esc(dev)}"><rect class="bd" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"/><rect class="hdr" x="${p.x}" y="${p.y}" width="${p.w}" height="${L.HDR - 4}"/>`
      + `<text class="t" x="${p.x + 7}" y="${p.y + 14}">${esc(trunc(devName(dev), p.w > 200 ? 34 : 24))}</text><text class="i" x="${p.x + 7}" y="${p.y + 26}">${esc(trunc(conns.join(' '), p.w > 200 ? 38 : 26))}</text>`;
    p.rows.forEach(r => {
      const ep = [...r.eps][0], key = ep + '|' + r.c, pin = pinByKey[key] || {};
      const rc = !has ? '' : ([...r.eps].some(e => e + '|' + r.c === selPin) ? ' pri' : r.wires.some(x => R.w.has(x)) ? ' rel' : '');
      o += `<g class="prow${rc}" data-pin="${esc(key)}"><rect x="${p.x + 1}" y="${r.y - L.ROW / 2}" width="${p.w - 2}" height="${L.ROW}"/><text class="p" x="${p.x + 7}" y="${r.y + 3.5}">${esc(trunc(r.c || '—', 9))}</text><text class="pn" x="${p.x + 70}" y="${r.y + 3.5}">${esc(trunc(pin.n || (p.ci === 1 ? r.wires.join(' ') : (W[r.wires[0]] || {}).label || ''), p.w > 200 ? 26 : 15))}</text></g>`;
    });
    o += '</g>';
  });
  return o;
}
const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function renderSch() {
  if (!S.sch || !SYS[S.sch]) S.sch = focusSys(S.sel) || (D.sys[0] || {}).id;
  const sel = $('#schsel'); if (sel && sel.value !== S.sch) sel.value = S.sch;
  const L = schLayout(S.sch), svg = $('#schsvg');
  if (!L) return;
  svg.setAttribute('width', L.width); svg.setAttribute('height', L.height); svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
  svg.innerHTML = schSvg(L);
  if (SCH.sys !== S.sch) { SCH.sys = S.sch; schFit(); }
  const y = SYS[S.sch];
  $('#vcap').textContent = `${y.name}: ${y.wires.length} wires (${y.active} in cut list v4.2, the rest implied by later decisions, drawn dashed). Generated from the registry's terminations; a block diagram, not a drawn schematic.`;
}
const sch = $('#sch');
function schApply() { const t = SCH.xf; $('#schsvg').style.transform = `translate(${t.tx}px,${t.ty}px) scale(${t.k})`; $('#schsvg').style.transformOrigin = '0 0'; }
function schFit(all) {
  const L = SCH.cache[S.sch]; if (!L) return; const r = sch.getBoundingClientRect();
  const kw = r.width / L.width, kh = r.height / L.height;
  const k = (all ? Math.min(kw, kh) : Math.min(kw, Math.max(kh, 0.72))) * 0.97 || 1;
  SCH.xf = {k: Math.min(k, 1.3), tx: Math.max(8, (r.width - L.width * Math.min(k, 1.3)) / 2), ty: 6}; schApply();
}
function schZoom(z) { if (!SCH.xf) return; if (z === 'fit') return schFit(true); const r = sch.getBoundingClientRect(); schZoomAt(z === 'in' ? 1.5 : 1 / 1.5, r.width / 2, r.height / 2); }
function schZoomAt(f, sx, sy) { const t = SCH.xf; const k2 = Math.min(6, Math.max(0.05, t.k * f)); const wx = (sx - t.tx) / t.k, wy = (sy - t.ty) / t.k; t.k = k2; t.tx = sx - wx * k2; t.ty = sy - wy * k2; schApply(); }
(function schPointer() {
  let dr = null;
  sch.addEventListener('pointerdown', e => { sch.setPointerCapture(e.pointerId); dr = {x: e.clientX, y: e.clientY, tx: SCH.xf ? SCH.xf.tx : 0, ty: SCH.xf ? SCH.xf.ty : 0, moved: false}; });
  sch.addEventListener('pointermove', e => {
    if (!dr || !SCH.xf) return;
    const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
    if (!dr.moved && Math.hypot(dx, dy) > 4) { dr.moved = true; sch.classList.add('panning'); }
    if (dr.moved) { SCH.xf.tx = dr.tx + dx; SCH.xf.ty = dr.ty + dy; schApply(); }
  });
  sch.addEventListener('pointerup', e => {
    if (dr && !dr.moved) {
      const hit = document.elementFromPoint(e.clientX, e.clientY), g = hit && hit.closest && hit.closest('[data-w], [data-pin], [data-dev]');
      if (g) { if (g.dataset.w) select('w:' + g.dataset.w, 'view'); else if (g.dataset.pin) select('p:' + g.dataset.pin, 'view'); else if (g.dataset.dev) select('d:' + g.dataset.dev, 'view'); }
    }
    dr = null; sch.classList.remove('panning');
  });
  sch.addEventListener('wheel', e => { if (!SCH.xf) return; e.preventDefault(); const r = sch.getBoundingClientRect(); schZoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, {passive: false});
  new ResizeObserver(() => { if (S.view === 'sch' && SCH.cache[S.sch]) schFit(); }).observe(sch);
})();

// ---------------------------------------------------------------- library: the six parts in true CAD, turned in 3D with every pin numbered
const L3 = (function () {
  const box = $('#l3'), msg = $('#l3-msg'), st = $('#l3-st');
  let renderer = null, scene, camera, controls, root = null, pinGroup = null, cur = null, radius = 0.2, labels = [], pickPins = [], pickParts = [], groups = {}, ready = false, starting = null, mount = 'wall';
  const say = t => { msg.textContent = t; msg.hidden = !t; };
  async function init() {
    await three();
    try { renderer = new THREE.WebGLRenderer({antialias: true}); } catch (e) { throw new Error('this browser has no WebGL'); }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    box.insertBefore(renderer.domElement, box.firstChild);
    scene = new THREE.Scene(); scene.background = new THREE.Color(sheetColor());
    try { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; } catch (e) {}
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(0.4, 0.6, 0.8); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-0.6, 0.4, -0.7); scene.add(rim);
    camera = new THREE.PerspectiveCamera(28, 1, 0.001, 100);
    controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
    const resize = () => { const w = box.clientWidth || 600, h = box.clientHeight || 400; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    new ResizeObserver(resize).observe(box); resize();
    const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    let down = null;
    const at = ev => { const rc = renderer.domElement.getBoundingClientRect(); ptr.x = ((ev.clientX - rc.left) / rc.width) * 2 - 1; ptr.y = -((ev.clientY - rc.top) / rc.height) * 2 + 1; ray.setFromCamera(ptr, camera); };
    renderer.domElement.addEventListener('pointerdown', ev => { down = {x: ev.clientX, y: ev.clientY}; });
    renderer.domElement.addEventListener('pointermove', ev => {
      if (down) return; at(ev);
      const hp = ray.intersectObjects(pickPins, false);
      if (hp.length) { const p = hp[0].object.userData.p; st.textContent = pinText(p); return; }
      const h = ray.intersectObjects(pickParts, false).filter(x => x.object.visible);
      st.textContent = h.length ? String(h[0].object.name || (h[0].object.parent && h[0].object.parent.name) || 'part').replace(/_/g, ' ') : (libByKey[cur] ? libByKey[cur].pn + ', true size' : '');
    });
    renderer.domElement.addEventListener('pointerup', ev => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) { down = null; return; } down = null; at(ev);
      const hp = ray.intersectObjects(pickPins, false);
      if (hp.length) { const p = hp[0].object.userData.p; const pk = p.ep + '|' + (pinByKey[p.ep + '|' + p.pin] ? p.pin : ((PINS[p.ep] || []).find(x => x.pj === p.pin) || {}).c || p.pin); select('p:' + pk, 'view'); }
    });
    const v = new THREE.Vector3();
    (function loop() {
      if (S.view === 'lib') {
        controls.update(); renderer.render(scene, camera);
        if (pinGroup) { const w = box.clientWidth, h = box.clientHeight; labels.forEach(l => { l.m.getWorldPosition(v); v.project(camera); l.div.style.left = ((v.x + 1) / 2 * w) + 'px'; l.div.style.top = ((1 - v.y) / 2 * h) + 'px'; l.div.hidden = v.z > 1; }); }
      }
      requestAnimationFrame(loop);
    })();
    ready = true;
  }
  const pinText = p => `${p.pin}${p.maker && p.maker !== p.pin ? ' (' + p.maker + ')' : ''} · ${p.name || ''}${p.full && p.full !== p.name ? ' · ' + p.full : ''} · ${p.w.length ? 'wire ' + p.w.join(', ') : 'spare'}`;
  function clearLabels() { labels.forEach(l => l.div.remove()); labels = []; }
  function addLabel(m, text, sel) { const d = document.createElement('div'); d.className = 'pinlbl' + (sel ? ' sel' : ''); d.textContent = text; box.appendChild(d); labels.push({div: d, m}); }
  async function show(key) {
    const L = libByKey[key]; if (!L) return;
    if (!ready) { if (!starting) { say('Loading the 3D viewer...'); starting = init().catch(e => { say('The 3D view could not start here: ' + (e && e.message || e) + '. The facts, checks and drawings beside it still work.'); throw e; }); } try { await starting; } catch (e) { return; } }
    if (cur === key && root) { mark(); return; }
    cur = key; clearLabels(); if (root) { scene.remove(root); root = null; } pinGroup = null; pickPins = []; pickParts = []; groups = {};
    say('Loading ' + L.pn + '...');
    try { if (!(window.K5_LIB && window.K5_LIB[key])) await loadScript(L.js); } catch (e) { say('The model file did not load.'); return; }
    new THREE.GLTFLoader().parse(b64bytes(window.K5_LIB[key]).buffer, '', gltf => {
      if (cur !== key) return;
      root = new THREE.Group(); const inner = new THREE.Group(); inner.add(gltf.scene); root.add(inner);
      mount = L.mount; inner.rotation.x = L.mount === 'wall' ? Math.PI / 2 : 0;
      gltf.scene.traverse(o => {
        if (!o.isMesh) return; pickParts.push(o);
        const n = (o.name || '') + ' ' + ((o.parent && o.parent.name) || '');
        const g = /keep-?out/i.test(n) ? 'keep' : (/plug|backshell/i.test(n) ? 'plugs' : 'other');
        (groups[g] = groups[g] || []).push(o);
        if (o.material && o.material.transparent) o.material.depthWrite = false;
      });
      (groups.keep || []).forEach(o => { o.visible = false; });
      pinGroup = new THREE.Group(); inner.add(pinGroup);
      const geo = new THREE.SphereGeometry(0.0009, 12, 8);
      L.pins.forEach(p => {
        if (!p.at) return;
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color: p.w.length ? 0x3b4650 : 0xa7afb7}));
        m.position.set(p.at[0], p.at[1], p.at[2]); m.userData = {p};
        pinGroup.add(m); pickPins.push(m);
      });
      scene.add(root);
      const bb = new THREE.Box3().setFromObject(root), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
      inner.position.sub(c); radius = Math.max(s.x, s.y, s.z);
      camera.near = radius / 100; camera.far = radius * 100; camera.updateProjectionMatrix();
      front(); say(''); mark();
    }, () => say('The 3D model did not load. The facts, checks and drawings beside it still work.'));
  }
  function mark() {
    if (!pinGroup) return;
    clearLabels();
    const R = S.R || relOf(null), selPin = kindOf(S.sel) === 'p' ? valOf(S.sel) : null;
    const L = libByKey[cur], few = L.pins.length <= 8;
    pinGroup.children.forEach(m => {
      const p = m.userData.p, key = p.ep + '|' + ((PINS[p.ep] || []).find(x => x.pj === p.pin || x.c === p.pin) || {c: p.pin}).c;
      const pri = key === selPin, rel = !pri && R.p.has(key) && kindOf(S.sel) !== 'c';
      m.material.color.set(pri ? 0x1f6fe0 : rel ? 0x5d98ef : (p.w.length ? 0x3b4650 : 0xa7afb7));
      m.scale.setScalar(pri ? 2.4 : rel ? 1.7 : 1);
      if (pri || few || /^[AB]01$/.test(p.pin)) addLabel(m, p.pin, pri);
    });
  }
  function front() { if (!root) return; camera.position.set(radius * 0.7, radius * 0.35, radius * 2.0); controls.target.set(0, 0, 0); controls.update(); st.textContent = (libByKey[cur] || {}).pn + ', true size. Dark pins carry a wire; light ones are spare.'; }
  function wires() {
    if (!root || !pinGroup) return;
    const b = new THREE.Box3().setFromObject(pinGroup), c = b.getCenter(new THREE.Vector3());
    controls.target.copy(c);
    if (mount === 'floor') { camera.position.set(c.x + 0.0005, c.y + radius * 1.05, c.z + radius * 0.22); st.textContent = 'Looking down at the terminals.'; }
    else { camera.position.set(c.x + 0.0005, c.y - radius * 1.05, c.z + radius * 0.22); st.textContent = 'Wire side, looking up at the connections. The front of the unit is at the top of this view.'; }
    controls.update();
  }
  function toggle(g, on) { (groups[g] || []).forEach(o => { o.visible = on; }); }
  return {show, mark, front, wires, toggle};
})();
function renderLib() {
  if (!S.lib || !libByKey[S.lib]) S.lib = (LIB[0] || {}).key;
  const L = libByKey[S.lib];
  document.querySelectorAll('#libseg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lib === S.lib));
  if (!L) { $('#linfo').innerHTML = '<p class="muted">No library parts yet.</p>'; return; }
  const ok = L.checks.filter(c => c.ok).length;
  const ends = L.ends.filter(e => byId[e]).map(e => goLink('c:' + e, e)).join(' ');
  const checks = L.checks.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>Check</th><th class="num">Maker</th><th class="num">Model</th><th class="num">Tol.</th><th>Result</th></tr></thead><tbody>${L.checks.map(c => `<tr><td>${esc(c.what)}</td><td class="num">${esc(c.drawing)}</td><td class="num">${esc(c.model)}</td><td class="num">${esc(c.tol)}</td><td class="${c.ok ? 'ok' : 'bad'}">${c.ok ? 'match' : 'off'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No build-time checks recorded.</p>';
  $('#linfo').innerHTML = `<div><div class="lab">Library part · ${esc(L.id)}</div><h2>${esc(L.title)}</h2><div class="mono muted">${esc(L.pn)}</div></div>`
    + (L.orient ? `<div class="warnbox"><b>Check pin 1 before you trust a pin.</b> ${esc(L.orient)}</div>` : '')
    + `<dl class="kv"><dt>Ends</dt><dd>${ends}</dd><dt>Envelope</dt><dd>${esc(L.dims || '')}</dd><dt>Shape from</dt><dd>${esc(L.basis || '')}</dd>${L.mated ? `<dt>Mated plugs</dt><dd>${esc(L.mated)}</dd>` : ''}${L.keepout ? `<dt>Keep-out</dt><dd>${esc(L.keepout)}</dd>` : ''}<dt>Model file</dt><dd class="mono">${esc(L.id)}.glb, ${(L.bytes / 1e6).toFixed(2)} MB, ${esc(L.made)}</dd></dl>`
    + `<dl class="kv">${L.facts.map(f => `<dt>${esc(f[0])}</dt><dd>${esc(f[1])}</dd>`).join('')}</dl>`
    + `<div><div class="lab" style="margin-bottom:6px">Build-time checks against the maker's print · ${ok} of ${L.checks.length} match</div>${checks}</div>`
    + (L.unknowns.length || L.open.length ? `<div><div class="lab" style="margin-bottom:6px">Not settled</div><ul class="olist">${L.open.concat(L.unknowns).map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : '')
    + L.images.map(im => `<figure><img src="${esc(im.src)}" alt="${esc(L.title + ', ' + im.kind)}" loading="lazy"><figcaption>${esc(im.cap)}</figcaption></figure>`).join('');
  $('#vcap').textContent = `${L.title}: parts-artist's model, true size, from ${L.basis || 'the maker drawing'}. Pins numbered as the maker's drawing.`;
  L3.show(S.lib);
}

// ---------------------------------------------------------------- selection
function select(id, from) {
  S.sel = id || null; S.R = relOf(S.sel);
  const fc = S.sel && focusConn(S.sel); if (fc) S.conn = fc;
  const fs = S.sel && focusSys(S.sel); if (fs) S.sch = fs;
  const fl = S.sel && focusLib(S.sel); if (fl) S.lib = fl;
  if (S.view === 'vehicle' && S.mode === '2d' && S.sel) ensureVisible();
  try { history.replaceState(null, '', S.sel ? '#' + S.sel.replace(/^([a-z]+):/, '$1.').replace(/[^A-Za-z0-9._~-]/g, '~') : location.pathname); } catch (e) {}
  if (from !== 'tree') revealInTree(S.sel);
  renderTree(); if (from !== 'tree') scrollTreeToSel();
  if (S.view === 'conn' || S.view === 'lib') renderTools();
  renderView(); renderProps(); renderGrid(from); renderStrip();
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b && !b.closest('#tlist')) { e.preventDefault(); select(b.dataset.go, 'link'); } });
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
  if (e.key === 'Escape') { if (!$('#dlg').hidden) { $('#dlg').hidden = true; return; } closeTree(); select(null); }
  else if ((e.key === 'f' || e.key === 'F') && S.view === 'vehicle') (S.mode === '3d' ? T3.frame() : frameSel());
});

// ---------------------------------------------------------------- properties: structured attributes, sources behind a toggle
function sec(title, body, opt) {
  const o = opt || {};
  const shut = S.shut.has(title) || (o.shut && !S.opened.has(title));
  return `<section class="psec${shut ? ' shut' : ''}" data-sec="${esc(title)}"><h3>${esc(title)}${o.n != null ? ` <span class="n">${o.n}</span>` : ''}</h3><div class="pc">${body}</div></section>`;
}
function kv(rows) { return `<dl class="kv">${rows.filter(Boolean).map(([k, v, p]) => `<dt>${esc(k)}</dt><dd>${v == null || v === '' ? '<span class="faint">not on file</span>' : v}${p ? `<span class="prov">${esc(p)}</span>` : ''}</dd>`).join('')}</dl>`; }
function wireTable(ids, here) {
  if (!ids.length) return '<p class="fine" style="margin:0">No wires.</p>';
  const rows = ids.map(x => {
    const w = W[x] || {id: x}, L = wireLen(w), ch = w.ch || [];
    const other = here ? ch.filter(c => c[0] !== here) : ch;
    const fromTo = here ? other.map(endLink).join('<br>') : endLink(ch[0]) + ' → ' + endLink(ch[ch.length - 1]);
    return `<tr data-sel="w:${esc(x)}" class="${S.sel === 'w:' + x ? 'pri' : ''}"><td class="id">${esc(x)}</td><td class="num">${esc(w.awg || '')}</td><td class="nw">${wswatch(w.color)} ${esc(w.color || '')}</td><td>${fromTo || '<span class="faint">one end only</span>'}</td><td class="num">${L.mm ? mm(L.mm) + (L.pm ? ' ±' + L.pm : '') : ''}</td></tr>`;
  }).join('');
  return `<div class="tscroll"><table class="tbl"><thead><tr><th>Wire</th><th class="num">AWG</th><th>Colour</th><th>${here ? 'Other end' : 'From → to'}</th><th class="num">mm</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function openList(ids) {
  const os = uniq(ids).map(x => openById[x]).filter(Boolean);
  if (!os.length) return '';
  return sec('Open items', `<ul class="olist">${os.map(o => `<li><span class="pill${o.kind === 'Decision' ? ' warn' : ''}">${esc(o.kind)}</span> ${esc(o.text)}<span class="src">${esc(o.who)} · ${esc(o.src)}</span></li>`).join('')}</ul>`, {n: os.length});
}
function photoBlock(i) {
  const m = i.media || {}, ph = m.photo, conf = m.confidence || 'unknown';
  if (ph && ph.src) return `<div class="photo"><img src="${esc(ph.src)}" alt="${esc(m.what || i.what)}"></div><div class="pcap"><span class="conf ${esc(conf)}">${esc(CONF[conf] || conf)}</span>${ph.page ? ` <a href="${esc(ph.page)}" target="_blank" rel="noopener">photo page</a>` : ''}${ph.fetched ? ' · fetched ' + esc(ph.fetched) : ''}${m.photo_note ? `<span class="prov">${esc(m.photo_note)}</span>` : ''}</div>`;
  if (ph && ph.url) return `<div class="photo none">Photo not downloaded: its host blocks scripted downloads</div><div class="pcap"><a href="${esc(ph.page || ph.url)}" target="_blank" rel="noopener">Open the photo page</a></div>`;
  return `<div class="photo none">No photo that can be defended yet</div>`;
}
function fieldList(arr) { return (arr || []).map(f => `<span class="mono">${esc(f.code)}</span>${f.qty != null ? ` <span class="faint">× ${esc(f.qty)}</span>` : ''}${f.name ? ` <span class="muted">${esc(f.name)}</span>` : ''}`).join('<br>'); }
function staleWord(p) { return p.age == null ? 'date not recorded' : (p.age > D.stale_days ? `stale, ${p.age} days old` : `${p.age} ${p.age === 1 ? 'day' : 'days'} old`); }
function renderProps() {
  const H = $('#phead'), B = $('#pbody');
  const k = kindOf(S.sel), v = S.sel ? valOf(S.sel) : null;
  let head = '', body = '';
  if (!S.sel) {
    head = `<div class="kind"><span class="lab">Nothing selected</span></div><div class="pname">Pick anything: a row in the tree or a table, a part on the drawing, a wire on the schematic, a pin on a connector face.</div>`;
  } else if (k === 'c') ({head, body} = propsConn(byId[v]));
  else if (k === 'p') ({head, body} = propsPin(v));
  else if (k === 'w') ({head, body} = propsWire(W[v]));
  else if (k === 's') ({head, body} = propsSeg(segById[v]));
  else if (k === 'n') ({head, body} = propsNode(nodeById[v]));
  else if (k === 'd') ({head, body} = propsDev(DEVS[v]));
  else if (k === 'y') ({head, body} = propsSys(SYS[v]));
  else if (k === 'o') ({head, body} = propsOpen(openById[v]));
  else if (k === 'ctx') ({head, body} = propsCtx(ctxById[S.sel]));
  H.innerHTML = head; B.innerHTML = body + `<div id="notes-sect"></div>`;
  B.classList.toggle('show-prov', S.prov); H.classList.toggle('show-prov', S.prov);
  renderNoteBox(); renderFoot();
}
function propsConn(i) {
  if (!i) return {head: '', body: ''};
  const m = i.media || {}, c = i.conn || {}, f = c.fields || {}, st = i.st, mg = effMargin(i), cost = i.cost || {}, buy = i.buy || {}, work = i.work || {};
  const dev = DEVS[i.dev], ws = wiresOf(i.id);
  const head = `<div class="kind"><span class="lab">Connector</span><span class="stt st-${esc(i.status)}"><i class="sq"></i> <span class="muted" style="font-size:11.5px">${esc(WORD[i.status] || i.status)}</span></span></div><div class="pid">${esc(i.id)}</div><div class="pname">${esc(i.what)}</div>`;
  const mates = (c.mates || []).map(x => x.end ? goLink('c:' + x.end, x.code) : `<span class="mono">${esc(x.code)}</span>${x.name ? ` <span class="muted">${esc(x.name)}</span>` : ''}`).join('<br>');
  const termOpen = (f.term_open || []).map(x => `<span class="warn">${esc(x.text)}</span> <span class="faint">× ${x.qty}</span>`).join('<br>');
  const docs = [m.drawing && `<a href="${esc(m.drawing.url || m.drawing.page)}" target="_blank" rel="noopener">drawing</a>`, m.datasheet && `<a href="${esc(m.datasheet)}" target="_blank" rel="noopener">datasheet</a>`, m.cad && m.cad.url && `<a href="${esc(m.cad.url)}" target="_blank" rel="noopener">3D model</a>`].filter(Boolean).join(' · ');
  let body = sec('Part', photoBlock(i) + '<div style="height:8px"></div>' + kv([
    ['Maker', esc(m.maker || ''), 'part_media.yaml'], ['Part number', m.maker_pn ? `<span class="mono">${esc(m.maker_pn)}</span>` : '<span class="warn">unknown</span>', 'part_media.yaml ' + (m.confidence || '')],
    ['Device', dev && dev.conns.length > 1 ? goLink('d:' + i.dev, dev.name, 'ui') : esc(dev ? dev.name : i.what)],
    ['System', ws.length ? uniq(ws.map(x => (W[x] || {}).sub).filter(Boolean)).map(y => goLink('y:' + y, sysName(y), 'ui')).join(', ') : '<span class="faint">no wires yet</span>'],
    ['Zone', esc(ZONES[i.zone] || i.zone) + (i.reg && i.reg.side ? ` <span class="faint">· ${esc(i.reg.side)} side</span>` : '')],
    docs ? ['Documents', docs] : null, i.lib ? ['Library', `<button type="button" class="linkish" data-lib="${esc(i.lib)}">open the true-CAD model</button>`] : null,
  ]));
  body += sec('Connector', kv([
    ['Family', esc(c.family_word || ''), 'k5_registry.json family: ' + (c.family || '')],
    ['Cavities', c.cav_n != null ? `<span class="mono">${c.cav_n}</span> <span class="faint">· ${c.used} used</span>` : `<span class="mono">${c.used}</span> <span class="faint">terminated; total not on file</span>`, c.cav_src],
    ['Mating half', mates],
    ['Terminals', (fieldList(f.term) || '') + (termOpen ? (f.term ? '<br>' : '') + termOpen : ''), 'k5_registry.json terminations; parts.yaml names'],
    ['Seals, plugs', fieldList(f.seal)], ['Backshell, boot', fieldList(f.shell)], f.lock ? ['Locks', fieldList(f.lock)] : null,
    f.housing ? ['Housing', fieldList(f.housing)] : null, f.kit ? ['Kit', fieldList(f.kit)] : null,
    ['Face', c.face ? `<button type="button" class="linkish" data-view="conn">drawn from ${esc((i.pins_src || {}).file || 'pins.json')}</button>` : '<span class="faint">cavity layout not on file</span>'],
  ]));
  body += sec('Wires', wireTable(ws, i.id), {n: ws.length, shut: ws.length > 30});
  if (dev && (dev.capacity || []).length) body += sec('Device capacity', `<table class="tbl"><tbody>${dev.capacity.map(c => `<tr><td>${esc(c.what)}</td><td class="num">${esc(c.used)} / ${esc(c.cap == null ? '?' : c.cap)}</td><td class="${c.spare === 0 ? 'warn' : 'faint'}">${esc(Array.isArray(c.spare) ? 'spare ' + c.spare.join(' ') : c.spare == null ? '' : c.spare + ' spare')}</td></tr>`).join('')}</tbody></table><div class="prov">k5_registry.json capacity</div>`, {n: dev.capacity.length});
  const kidsHtml = kids[i.id] ? kids[i.id].map(x => goLink('c:' + x, x)).join(' ') : '';
  body += sec('Placement', kv([
    ['Station', `<span class="mono">${fmtIn(st.station_in)} in</span> <span class="faint">behind the front axle</span>`],
    ['Lateral', `<span class="mono">${fmtIn(Math.abs(st.lateral_in))} in</span> <span class="faint">${st.lateral_in > 0 ? 'driver side' : st.lateral_in < 0 ? 'passenger side' : ''}</span>`],
    ['Height', `<span class="mono">${fmtIn(st.height_in)} in</span> <span class="faint">above the ground</span>`],
    ['Margin', `<span class="mono">${esc(marginText(mg))}</span>`, mg ? mg.text : ''],
    ['Position basis', esc((i.basis || '').split(' (')[0]), i.basis],
    ['Drawn', i.drawn === 'own' ? `to size, <span class="mono">${esc(sizeText(i.fp))}</span>` : i.drawn === 'piece' ? 'as part of ' + goLink('c:' + i.piece_of, i.piece_of) : `<span class="warn">${esc(NOTDRAWN[i.why_not] || 'no')}</span>`, i.fp ? (i.fp.size || '') + ' · ' + (i.fp.from || '') : i.why_not_text],
    i.fp && (i.fp.top || i.fp.side) ? ['Colour', `<i class="sw" style="background:${esc(i.fp.top || i.fp.side)}"></i> <span class="mono">${esc(i.fp.top || i.fp.side)}</span>`, i.fp.color] : null,
    kidsHtml ? ['Co-located ends', kidsHtml] : null,
    (i.route_nodes || []).length ? ['Route landing', i.route_nodes.map(n => `${goLink('n:' + n.id, n.id)} <span class="${n.gap_mm > Math.max(50, (mg && mg.mm) || 0) ? 'warn' : 'faint'}">${n.gap_mm} mm from this spot</span>`).join('<br>'), 'routes.json (harness-cad) against pos.py (pieces)'] : null,
  ]));
  const list = (cost.list || []).map(p => `<span class="mono">${usd(p.usd)}</span> ${esc(p.unit)} · ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.vendor)}</a>` : esc(p.vendor)} <span class="${p.age > D.stale_days ? 'warn' : 'faint'}">${esc(staleWord(p))}</span><span class="prov">${esc(p.src)}</span>`).join('<br>');
  body += sec('Commercial', kv([
    ['Status', esc(buy.status || 'unknown'), buy.evidence ? '"' + buy.evidence.text + '" (' + buy.evidence.src + ')' : 'no record says'],
    ['List price', list || '<span class="faint">no public price on file</span>'],
    ['Paid', cost.paid ? esc(cost.paid.shown) : '<span class="faint">no order record on file</span>', cost.paid ? 'The amount stays in the database and shows masked here.' : ''],
    ['Buy', (cost.list || []).some(p => p.url) ? uniq((cost.list || []).map(p => p.url).filter(Boolean)).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>`).join(' · ') : '<span class="faint">no vendor page on file</span>', D.referral],
  ]), {shut: true});
  const stages = (work.stages || []).map(s => `<tr><td>${esc(s.stage)}</td><td class="${s.state === 'done' || s.state === 'owner call' ? 'ok' : s.state === 'not yet' ? 'warn' : 'faint'}">${esc(s.state)}</td></tr>`).join('');
  body += sec('Ownership', kv([
    ['Design', (work.design || []).map(d => `<span class="mono">${esc(d.who)}</span> <span class="faint">${esc(d.what)}</span><span class="prov">${esc(d.file || '')}</span>`).join('<br>')],
    ['Build', esc(work.build || 'unassigned'), D.builder_note],
  ]) + `<table class="tbl" style="margin-top:6px"><thead><tr><th>Stage</th><th>State</th></tr></thead><tbody>${stages}</tbody></table>`);
  body += openList((D.open_by || {})['c:' + i.id] || []);
  const why = (i.why || []).map(w => `<li>${esc(w.text)}<span class="src">${esc(w.source)}</span></li>`).join('');
  if (why) body += sec('Design rationale', `<ul class="olist">${why}</ul>`, {n: (i.why || []).length, shut: true});
  if ((i.reg || {}).sources || (i.reg || {}).device) body += sec('Registry record', kv([['Device text', esc((i.reg || {}).device || '')], ['Note', esc((i.reg || {}).note || '')], ['Sources', ((i.reg || {}).sources || []).map(esc).join('<br>')]]));
  return {head, body};
}
function propsPin(key) {
  const [ep, c] = key.split('|'), p = pinByKey[key], i = byId[ep];
  if (!p) return {head: `<div class="kind"><span class="lab">Pin</span></div><div class="pid">${esc(key.replace('|', ':'))}</div>`, body: '<div class="pc"><p class="fine">Not in the pin list.</p></div>'};
  const head = `<div class="kind"><span class="lab">Pin</span>${p.w.length ? '' : '<span class="pill">spare</span>'}</div><div class="pid">${esc(ep)}:${esc(p.c)}</div><div class="pname">${esc([p.n, p.f].filter(Boolean).join(' · ') || (i ? i.what : ''))}</div>`;
  const src = (i && i.pins_src) || {};
  let body = sec('Pin', kv([
    ['Connector', goLink('c:' + ep, ep)], ['Cavity', `<span class="mono">${esc(p.c)}</span>${p.tec ? ` <span class="faint">· maker cavity ${esc(p.tec)}${p.row ? ', row ' + esc(p.row) : ''}</span>` : ''}`, p.note || ''],
    ['Pin name', p.n ? `<span class="mono">${esc(p.n)}</span>` : '', src.names || ''], ['Function', esc(p.f || '')],
    ['Terminal', p.t ? `<span class="mono">${esc(p.t)}</span>` : '', 'k5_registry.json terminations'], p.fc ? ['Factory circuit', esc(p.fc)] : null,
    p.pj_w ? ['Check', `<span class="warn">pins.json lists ${esc(p.pj_w.join(', '))}; the registry lists ${esc(p.w.join(', ') || 'none')}</span>`] : null,
    ['Face position', p.xy ? `<span class="mono">${p.xy[0].toFixed(1)}, ${p.xy[1].toFixed(1)} mm</span> <span class="faint">from the cavity-field centre</span>` : '<span class="faint">not on file</span>', src.numbering || ''],
  ]));
  body += sec('Wires', wireTable(p.w, ep), {n: p.w.length});
  return {head, body};
}
function propsWire(w) {
  if (!w) return {head: '', body: ''};
  const L = wireLen(w), ch = w.ch || [];
  const head = `<div class="kind"><span class="lab">Wire</span><span class="pill${w.kind === 'implied' ? '' : ' ok'}">${w.kind === 'implied' ? 'implied' : 'cut list v4.2'}</span></div><div class="pid">${esc(w.id)}</div><div class="pname">${esc(w.label || '')}</div>`;
  let body = sec('Wire', kv([
    ['System', w.sub ? goLink('y:' + w.sub, sysName(w.sub), 'ui') : '<span class="faint">none in the registry</span>'],
    ['Gauge', `<span class="mono">${esc(gaugeOf(w))}</span>`], ['Spec', `<span class="mono">${esc(w.spec || '')}</span>`],
    ['Colour', `${wswatch(w.color)} ${esc(w.color || '')}`, w.basis ? 'colour basis: ' + w.basis : ''],
    ['From', endLink(ch[0])], ['To', ch.length > 1 ? endLink(ch[ch.length - 1]) : '<span class="faint">one end only in the registry</span>'],
    ch.length > 2 ? ['Via', ch.slice(1, -1).map(endLink).join('<br>')] : null,
    ['Length', L.mm ? `<span class="mono">${mm(L.mm)} mm${L.pm ? ' ± ' + L.pm : ''}</span> <span class="faint">${esc(L.basis)}</span>` : '', L.basis === 'routed' ? `sum of the ${(w.segs || []).length} route segments it runs in (harness-cad); ± is the root-sum-square of their margins, the rule routes.json uses per segment` : (w.len_basis || '')],
    w.len_ft ? ['Cut-list length', `<span class="mono">${mm(w.len_ft * 304.8)} mm</span> <span class="faint">(${esc(w.len_ft)} ft)</span>`, w.len_basis] : null,
    w.crossing ? ['Crossing', esc(w.crossing)] : null,
    w.limit ? ['PDM limit', esc(typeof w.limit === 'object' ? JSON.stringify(w.limit) : w.limit)] : null,
    w.prot ? ['Protection', esc(typeof w.prot === 'object' ? JSON.stringify(w.prot) : w.prot)] : null,
    w.opt ? ['Option', `<span class="mono">${esc(w.opt)}</span> <span class="faint">${esc(w.opt_st || '')}</span>`] : null,
  ]));
  if ((w.segs || []).length) body += sec('Route', `<div class="tscroll"><table class="tbl"><thead><tr><th>Segment</th><th>Bundle</th><th class="num">⌀ mm</th><th class="num">mm</th><th class="num">±</th></tr></thead><tbody>${w.segs.map(sid => { const s = segById[sid] || {}; return `<tr data-sel="s:${esc(sid)}"><td class="id">${esc(sid)}</td><td>${esc((s.bundle || '').split(' (')[0])}</td><td class="num">${esc(s.od_mm)}</td><td class="num">${mm((s.length_m || 0) * 1000)}</td><td class="num">${esc(s.margin_mm)}</td></tr>`; }).join('')}</tbody></table></div>`, {n: w.segs.length});
  if (w.notes) body += sec('Notes', `<p style="margin:0">${esc(w.notes)}</p>`);
  body += sec('Record history', `<ul class="olist">${(w.hist || []).map(h => `<li>${esc(h)}</li>`).join('') || '<li class="faint">none</li>'}</ul><div class="prov">k5_registry.json conflicts field</div>`, {shut: true});
  body += sec('Sources', `<ul class="olist">${(w.src || []).map(s => `<li class="mono" style="font-size:11px">${esc(s)}</li>`).join('')}</ul>`, {shut: true});
  return {head, body};
}
function propsSeg(s) {
  if (!s) return {head: '', body: ''};
  const clips = (routes.clips || []).filter(c => c.segment === s.id);
  const nodeLk = nid => { const n = nodeById[nid]; return n && n.ep && byId[n.ep] ? goLink('c:' + n.ep, n.ep) + ` <span class="faint">${esc(n.kind || '')}</span>` : goLink('n:' + nid, nid); };
  const head = `<div class="kind"><span class="lab">Route segment</span><span class="pill">${esc(s.status || '')}</span></div><div class="pid">${esc(s.id)}</div><div class="pname">${esc(s.bundle || '')}</div>`;
  let body = sec('Segment', kv([
    ['From', nodeLk(s.from_node)], ['To', nodeLk(s.to_node)],
    ['Length', `<span class="mono">${mm((s.length_m || 0) * 1000)} ± ${esc(s.margin_mm)} mm</span>`, s.margin_basis],
    ['Outer dia.', `<span class="mono">${esc(s.od_mm)} mm</span>${(s.parallel || 1) > 1 ? ` <span class="faint">× ${s.parallel} side by side</span>` : ''}`, s.od_basis],
    ['Covering', esc(s.covering || '')], ['Clips', clips.length ? clips.map(c => `<span class="mono">${esc(c.pn || c.id)}</span> <span class="faint">${esc(c.type || '')}</span>`).join('<br>') : '<span class="faint">none on this segment</span>', s.clip_spacing_mm ? 'spacing ' + s.clip_spacing_mm + ' mm' : ''],
    ['Ties', s.ties != null ? `<span class="mono">${esc(s.ties)}${s.tie_spacing_mm ? ' at ' + esc(s.tie_spacing_mm) + ' mm' : ''}</span>` : ''],
    ['Checks', `${(s.checks || []).length - (s.checks_failed || 0) - (s.checks_notrun || 0)} pass${s.checks_failed ? `, <span class="warn">${s.checks_failed} flagged</span>` : ''}${s.checks_notrun ? `, ${s.checks_notrun} not run` : ''}`],
    ['Why this way', esc(s.why || '')],
  ]));
  body += sec('Wires inside', wireTable(s.wires || []), {n: (s.wires || []).length});
  body += sec('Rule checks', `<div class="tscroll"><table class="tbl"><thead><tr><th>Rule</th><th>Result</th></tr></thead><tbody>${(s.checks || []).map(c => `<tr><td>${esc(c.rule)}<span class="prov">${esc(((routes.check_sources || [])[c.s]) || '')}</span>${c.why ? `<div class="faint" style="font-size:11px">${esc(c.why)}</div>` : ''}</td><td class="${/pass/i.test(c.result) ? 'ok' : /not run/i.test(c.result) ? 'faint' : 'warn'}">${esc(c.result)}</td></tr>`).join('')}</tbody></table></div>`, {n: (s.checks || []).length, shut: true});
  body += openList((D.open_by || {})['s:' + s.id] || []);
  return {head, body};
}
function propsNode(n) {
  if (!n) return {head: '', body: ''};
  const head = `<div class="kind"><span class="lab">${esc(n.kind || 'clip')}</span></div><div class="pid">${esc(n.id)}</div><div class="pname">${esc(n.pn || 'part number not set')}</div>`;
  return {head, body: sec('Node', kv([
    ['Station', `<span class="mono">${fmtIn(n.st.station_in)} in</span>`], ['Type', esc(n.type || n.kind || '')],
    n.ep ? ['Lands on', goLink('c:' + n.ep, n.ep) + (n.gap_mm != null ? ` <span class="${n.off ? 'warn' : 'faint'}">${n.gap_mm} mm from its spot in pos.py</span>` : '')] : null,
    n.segment ? ['On segment', goLink('s:' + n.segment, n.segment) + (n.fixed_to ? ` <span class="faint">fixed to ${esc(n.fixed_to)}</span>` : '')] : null,
    (n.segments || []).length ? ['Segments', n.segments.map(x => goLink('s:' + x, x)).join(' ')] : null,
    (n.wires || []).length ? ['Wires', n.wires.map(x => goLink('w:' + x, x)).join(' ')] : null,
    ['Note', esc(n.note || ''), n.basis],
  ])) + openList((D.open_by || {})['n:' + n.id] || [])};
}
function propsDev(d) {
  if (!d) return {head: '', body: ''};
  const ws = uniq(d.conns.flatMap(wiresOf));
  const head = `<div class="kind"><span class="lab">Device</span></div><div class="pid">${esc(d.id)}</div><div class="pname">${esc(d.name)}</div>`;
  let body = sec('Device', kv([['Maker', esc(d.maker || '')], ['Part number', d.pn ? `<span class="mono">${esc(d.pn)}</span>` : ''], ['Home system', d.sys ? goLink('y:' + d.sys, sysName(d.sys), 'ui') : ''], ['Zone', esc(ZONES[d.zone] || d.zone || '')],
    ['Connectors', d.conns.map(c => goLink('c:' + c, c)).join(' ')], d.lib ? ['Library', `<button type="button" class="linkish" data-lib="${esc(d.lib)}">open the true-CAD model</button>`] : null]));
  if ((d.capacity || []).length) body += sec('Capacity', `<table class="tbl"><thead><tr><th>Resource</th><th class="num">Used</th><th class="num">Of</th><th>Spare</th></tr></thead><tbody>${d.capacity.map(c => `<tr><td>${esc(c.what)}<span class="prov">${esc(c.src || '')}</span></td><td class="num">${esc(c.used)}</td><td class="num">${esc(c.cap == null ? '?' : c.cap)}</td><td class="${c.spare === 0 ? 'warn' : ''}">${esc(Array.isArray(c.spare) ? c.spare.join(' ') : c.spare == null ? 'not on file' : c.spare)}${c.spare_ids ? ' <span class="faint">' + esc(c.spare_ids.join(' ')) + '</span>' : ''}</td></tr>`).join('')}</tbody></table>`, {n: d.capacity.length});
  body += sec('Wires', wireTable(ws), {n: ws.length, shut: ws.length > 30});
  body += openList(d.conns.flatMap(c => (D.open_by || {})['c:' + c] || []));
  return {head, body};
}
function propsSys(y) {
  if (!y) return {head: '', body: ''};
  const head = `<div class="kind"><span class="lab">System</span></div><div class="pid">${esc(y.id)}</div><div class="pname">${esc(y.name)}</div>`;
  const conns = uniq(y.wires.flatMap(x => (W[x].ch || []).map(c => c[0])));
  const bom = (D.bom || []).filter(b => b.g === 'dev' && b.sys === (y.name));
  let body = sec('System', kv([['Wires', `<span class="mono">${y.wires.length}</span> <span class="faint">${y.active} in cut list v4.2, ${y.wires.length - y.active} implied</span>`], ['Connectors', `<span class="mono">${conns.length}</span>`],
    ['Cut-list length', `<span class="mono">${mm(y.ft * 304.8)} mm</span> <span class="faint">(${y.ft} ft, wires with a length)</span>`], ['Schematic', `<button type="button" class="linkish" data-view="sch">open the block diagram</button>`]]));
  body += sec('Wires', wireTable(y.wires), {n: y.wires.length, shut: y.wires.length > 40});
  return {head, body};
}
function propsOpen(o) {
  if (!o) return {head: '', body: ''};
  const dec = (D.dec || []).find(d => d.open === o.id);
  const head = `<div class="kind"><span class="lab">${dec ? 'Decision ' + dec.n + ' of ' + D.dec.length : 'Open item'}</span><span class="pill${o.kind === 'Decision' ? ' warn' : ''}">${esc(o.kind)}</span></div><div class="pname" style="font-weight:600">${esc(dec ? dec.title : o.text.slice(0, 90))}</div>`;
  const R = S.R || relOf(null);
  let body = sec('Item', kv([['Question', esc(dec ? dec.text : o.text)], ['Who acts', esc(o.who)], ['Source', esc(o.src)], ['State', esc(o.st || 'open')],
    ['Records', o.rel.length ? o.rel.map(r => goLink(r)).join(' ') : '<span class="faint">none</span>', dec ? dec.rel_note : ''],
    o.rel.length ? ['Linked', `<button type="button" class="linkish" data-linked="wires">${R.w.size} wires</button> · <button type="button" class="linkish" data-linked="conns">${R.c.size} connectors</button> · <button type="button" class="linkish" data-linked="open">${OPEN.filter(x => TAB.open.rel(x)).length} open items</button>`] : null]));
  if (dec && dec.tape) body += sec('Tape items', `<ul class="olist">${dec.tape.map(t => { const x = (D.tape || []).find(z => z.id === t) || {}; return `<li><b class="mono">${esc(t)}</b> ${esc(x.what || '')}<span class="src">${esc(x.from_to || '')} Tolerance ±${esc(x.tol)} mm.</span></li>`; }).join('')}</ul>`);
  return {head, body};
}
function propsCtx(c) {
  if (!c) return {head: '', body: ''};
  return {head: `<div class="kind"><span class="lab">Context</span></div><div class="pid">${esc(c.id.replace(/^ctx:/, ''))}</div><div class="pname">${esc(c.label)}</div>`,
    body: sec('Context', kv([['What', esc(c.note || '')], ['Station', `<span class="mono">${fmtIn(c.st.station_in)} in</span>`]])) + ((c.calls || []).length ? sec('Open call', `<ul class="olist">${c.calls.map(x => `<li>${esc(x.text)}<span class="src">${esc(x.source)}</span></li>`).join('')}</ul>`) : '')};
}
$('#pbody').addEventListener('click', e => {
  const h = e.target.closest('.psec > h3'); if (h) { const s = h.parentElement, t = s.dataset.sec; s.classList.toggle('shut'); if (s.classList.contains('shut')) { S.shut.add(t); S.opened.delete(t); } else { S.shut.delete(t); S.opened.add(t); } return; }
  const r = e.target.closest('tr[data-sel]'); if (r && !e.target.closest('[data-go]')) { select(r.dataset.sel, 'props'); return; }
  const lb = e.target.closest('[data-lib]'); if (lb) { S.lib = lb.dataset.lib; setView('lib'); return; }
  const vb = e.target.closest('[data-view]'); if (vb) { setView(vb.dataset.view); return; }
  const lk = e.target.closest('[data-linked]'); if (lk) { S.onlySel = true; S.chip[lk.dataset.linked] = ''; setTab(lk.dataset.linked); }
});
$('#provbtn').addEventListener('click', () => { S.prov = !S.prov; keep(); $('#provbtn').setAttribute('aria-pressed', S.prov); $('#pbody').classList.toggle('show-prov', S.prov); });
$('#provbtn').setAttribute('aria-pressed', S.prov);

// ---------------------------------------------------------------- linked tables
const TAB = {};
TAB.wires = {
  rows: () => Object.values(W).sort((a, b) => natCmp(a.id, b.id)),
  sel: r => 'w:' + r.id, rel: r => S.R.w.has(r.id),
  chips: [['', 'All'], ['active', 'Cut list v4.2'], ['implied', 'Implied'], ['unrouted', 'Not routed']],
  chip: (r, c) => !c || (c === 'unrouted' ? !r.segs : r.kind === c),
  hay: r => [r.id, r.label, r.sub, r.color, r.spec, (r.ch || []).map(endTxt).join(' ')].join(' '),
  cols: [
    {k: 'id', h: 'Wire', v: r => r.id, td: r => `<td class="id">${esc(r.id)}</td>`},
    {k: 'from', h: 'From', v: r => endTxt((r.ch || [])[0]), td: r => { const t = endTxt((r.ch || [])[0]); return `<td class="id" title="${esc(t)}">${esc(t)}</td>`; }},
    {k: 'to', h: 'To', v: r => endTxt((r.ch || []).length > 1 ? r.ch[r.ch.length - 1] : null), td: r => { const t = (r.ch || []).length > 1 ? endTxt(r.ch[r.ch.length - 1]) : ''; return `<td class="id" title="${esc(t)}">${esc(t)}</td>`; }},
    {k: 'awg', h: 'AWG', v: r => +r.awg || 99, td: r => `<td class="num">${esc(r.awg || '')}</td>`},
    {k: 'color', h: 'Colour', v: r => r.color, td: r => `<td class="nw">${wswatch(r.color)} ${esc(r.color || '')}</td>`},
    {k: 'spec', h: 'Spec', v: r => r.spec, td: r => `<td class="id sm">${esc(r.spec || '')}</td>`},
    {k: 'len', h: 'Length mm', v: r => wireLen(r).mm || 0, td: r => { const L = wireLen(r); return `<td class="num">${L.mm ? mm(L.mm) : ''}</td>`; }},
    {k: 'pm', h: '±', v: r => wireLen(r).pm || 0, td: r => `<td class="num">${esc(wireLen(r).pm || '')}</td>`},
    {k: 'basis', h: 'Length basis', v: r => wireLen(r).basis, td: r => `<td class="sm nw">${esc(wireLen(r).basis)}</td>`},
    {k: 'label', h: 'Circuit', v: r => r.label, td: r => `<td class="clip" title="${esc(r.label || '')}"><span class="cl">${esc(r.label || '')}</span></td>`},
    {k: 'sub', h: 'System', v: r => sysName(r.sub), td: r => `<td class="sm nw">${esc(r.sub ? sysName(r.sub) : '')}</td>`},
    {k: 'via', h: 'Via', v: r => (r.ch || []).slice(1, -1).map(c => c[0]).join(' '), td: r => { const t = (r.ch || []).slice(1, -1).map(endTxt).join(' '); return `<td class="sm nw" title="${esc(t)}">${esc(t)}</td>`; }},
    {k: 'kind', h: 'Status', v: r => r.kind, td: r => `<td class="sm nw">${r.kind === 'implied' ? 'implied' : 'cut list'}</td>`},
  ], rowCls: r => r.kind === 'implied' ? 'imp' : ''};
TAB.pins = {
  rows: () => { const out = []; Object.entries(PINS).sort((a, b) => natCmp(a[0], b[0])).forEach(([ep, ps]) => ps.forEach(p => out.push(Object.assign({ep}, p)))); return out; },
  sel: r => 'p:' + r.ep + '|' + r.c, rel: r => S.R.p.has(r.ep + '|' + r.c) && (kindOf(S.sel) !== 'y' || r.w.some(x => S.R.w.has(x))),
  chips: [['', 'All'], ['used', 'Carrying a wire'], ['spare', 'Spare']], chip: (r, c) => !c || (c === 'spare' ? !r.w.length : r.w.length > 0),
  hay: r => [r.ep, r.c, r.n, r.f, r.w.join(' '), r.t].join(' '),
  cols: [
    {k: 'ep', h: 'Connector', v: r => r.ep, td: r => `<td class="id">${esc(r.ep)}</td>`},
    {k: 'c', h: 'Cavity', v: r => r.c, td: r => `<td class="id">${esc(r.c)}</td>`},
    {k: 'n', h: 'Pin name', v: r => r.n, td: r => `<td class="id sm">${esc(r.n || '')}</td>`},
    {k: 'f', h: 'Function', v: r => r.f, td: r => `<td class="clip" title="${esc(r.f || '')}"><span class="cl">${esc(r.f || '')}</span></td>`},
    {k: 'w', h: 'Wire', v: r => r.w.join(' '), td: r => `<td class="id">${esc(r.w.join(' ') || '')}${r.w.length ? '' : '<span class="faint">spare</span>'}</td>`},
    {k: 'g', h: 'AWG', v: r => +((W[r.w[0]] || {}).awg) || 99, td: r => `<td class="num">${esc(r.w.map(x => (W[x] || {}).awg).filter(Boolean).join(' '))}</td>`},
    {k: 'col', h: 'Colour', v: r => (W[r.w[0]] || {}).color, td: r => `<td class="nw">${r.w.slice(0, 2).map(x => wswatch((W[x] || {}).color) + ' ' + esc((W[x] || {}).color || '')).join('<br>')}</td>`},
    {k: 't', h: 'Terminal', v: r => r.t, td: r => `<td class="id sm">${esc(r.t && r.t !== 'None' ? r.t : '')}</td>`},
    {k: 'to', h: 'Other end', v: r => '', td: r => `<td class="id sm">${esc(uniq(r.w.flatMap(x => ((W[x] || {}).ch || []).filter(c => c[0] !== r.ep).map(endTxt))).slice(0, 3).join(' '))}</td>`},
  ]};
TAB.conns = {
  rows: () => items.slice().sort((a, b) => natCmp(a.id, b.id)),
  sel: r => 'c:' + r.id, rel: r => S.R.c.has(r.id),
  chips: [['', 'All'], ['drawn', 'Drawn to size'], ['notdrawn', 'Not drawn'], ['face', 'Face on file']],
  chip: (r, c) => !c || (c === 'drawn' ? !!r.drawn : c === 'notdrawn' ? !r.drawn : !!(r.conn || {}).face),
  hay: r => [r.id, r.what, (r.media || {}).maker_pn, (r.media || {}).maker, (r.conn || {}).family_word, devName(r.dev)].join(' '),
  cols: [
    {k: 'th', h: '', ns: 1, td: r => `<td class="th">${thumb(r)}</td>`},
    {k: 'id', h: 'Connector', v: r => r.id, td: r => `<td class="id">${esc(r.id)}</td>`},
    {k: 'what', h: 'Description', v: r => r.what, td: r => `<td class="clip" title="${esc(r.what)}"><span class="cl">${esc(r.what)}</span></td>`},
    {k: 'pn', h: 'Part number', v: r => (r.media || {}).maker_pn, td: r => `<td class="id sm">${esc((r.media || {}).maker_pn || '')}</td>`},
    {k: 'fam', h: 'Family', v: r => (r.conn || {}).family_word, td: r => `<td class="sm nw">${esc((r.conn || {}).family_word || '')}</td>`},
    {k: 'cav', h: 'Cav. used', v: r => (r.conn || {}).used || 0, td: r => { const c = r.conn || {}; return `<td class="num">${c.used || 0}${c.cav_n != null ? '/' + c.cav_n : ''}</td>`; }},
    {k: 'zone', h: 'Zone', v: r => ZONES[r.zone], td: r => `<td class="sm nw">${esc(ZONES[r.zone] || r.zone)}</td>`},
    {k: 'drawn', h: 'Drawn', v: r => r.drawn ? 0 : 1, td: r => `<td class="sm nw${r.drawn ? '' : ' warn'}">${esc(drawnWord(r))}</td>`},
    {k: 'margin', h: 'Margin', v: r => (effMargin(r) || {}).mm ?? 9999, td: r => `<td class="num">${esc(marginText(effMargin(r)))}</td>`},
    {k: 'sta', h: 'Sta in', v: r => r.st.station_in, td: r => `<td class="num">${fmtIn(r.st.station_in)}</td>`},
    {k: 'buy', h: 'Commercial', v: r => (r.buy || {}).status, td: r => `<td class="sm nw">${esc((r.buy || {}).status || '')}</td>`},
  ]};
TAB.bom = {
  rows: () => D.bom || [], sel: r => r.used.length ? 'c:' + r.used[0] : null, pri: r => r.g === 'dev' && S.sel && r.used.includes(valOf(S.sel)),
  rel: r => r.used.some(x => S.R.c.has(x)),
  chips: [['', 'All'], ['dev', 'Devices'], ['hw', 'Plug hardware'], ['wire', 'Wire']], chip: (r, c) => !c || r.g === c,
  hay: r => [r.code, r.name, r.maker, r.status, r.used.join(' ')].join(' '),
  group: r => ({dev: 'Devices and modules', hw: 'Plug hardware (registry BOM)', wire: 'Wire by the foot (registry BOM)'}[r.g]),
  cols: [
    {k: 'code', h: 'Item', v: r => r.code, td: r => `<td class="id">${esc(r.code)}</td>`},
    {k: 'name', h: 'Description', v: r => r.name, td: r => `<td class="clip" title="${esc(r.name || '')}"><span class="cl">${esc(r.name || '')}${r.maker ? ` <span class="faint">${esc(r.maker)}</span>` : ''}</span></td>`},
    {k: 'qty', h: 'Qty', v: r => +r.qty || 0, td: r => `<td class="num">${esc(r.qty)}${r.unit !== 'each' ? ' ' + esc(r.unit) : ''}</td>`},
    {k: 'price', h: 'List price', v: r => r.price ? r.price.usd : -1, td: r => `<td class="num">${r.price ? usd(r.price.usd) : ''}</td>`},
    {k: 'ext', h: 'Extended', v: r => r.price ? r.price.usd * (+r.qty || 0) : -1, td: r => `<td class="num">${r.price && r.unit !== 'ft' ? usd(r.price.usd * (+r.qty || 0)) : ''}</td>`},
    {k: 'src', h: 'Price source', ns: 1, td: r => `<td class="sm">${r.price ? `${r.price.url ? `<a href="${esc(r.price.url)}" target="_blank" rel="noopener">${esc(r.price.vendor || 'vendor')}</a>` : esc(r.price.vendor || '')} <span class="${r.price.age > D.stale_days ? 'warn' : ''}">${r.price.age != null ? esc(staleWord(r.price)) : esc(r.price.date ? r.price.date : '')}</span>` : '<span class="faint">no public price on file</span>'}</td>`},
    {k: 'st', h: 'Status', v: r => r.status, td: r => `<td class="sm">${esc(r.status || '')}${r.cart ? ` <span class="faint">· cart ${esc(r.cart)}</span>` : ''}${r.paid ? ' <span class="faint">· paid $•••, from your records</span>' : ''}</td>`},
    {k: 'used', h: 'Used by', v: r => r.used.length, td: r => `<td class="id sm">${esc(r.used.slice(0, 4).join(' '))}${r.used.length > 4 ? ' +' + (r.used.length - 4) : ''}</td>`},
  ]};
TAB.open = {
  rows: () => OPEN, sel: r => 'o:' + r.id, rel: r => r.rel.some(x => S.sel === x || (x.startsWith('c:') && S.R.c.has(x.slice(2))) || (x.startsWith('s:') && S.R.s.has(x.slice(2)))),
  chips: () => [['', 'All']].concat(uniq(OPEN.map(o => o.kind)).map(k => [k, k + ' ' + OPEN.filter(o => o.kind === k).length])), chip: (r, c) => !c || r.kind === c,
  hay: r => [r.kind, r.text, r.who, r.src, r.rel.join(' ')].join(' '),
  cols: [
    {k: 'kind', h: 'Kind', v: r => ['Decision', 'Measurement', 'Placement', 'Finding', 'Route landing', 'Route check', 'End', 'Registry', 'Part model', 'Coverage'].indexOf(r.kind), td: r => `<td class="nw"><span class="pill${r.kind === 'Decision' ? ' warn' : ''}">${esc(r.kind)}</span></td>`},
    {k: 'text', h: 'Item', v: r => r.text, td: r => `<td class="clip" title="${esc(r.text)}"><span class="cl">${esc(r.text)}</span></td>`},
    {k: 'who', h: 'Who acts', v: r => r.who, td: r => `<td class="sm nw">${esc(r.who)}</td>`},
    {k: 'rel', h: 'Records', v: r => r.rel.join(' '), td: r => `<td class="id sm">${esc(r.rel.map(x => x.replace(/^[a-z]+:/, '')).slice(0, 3).join(' '))}${r.rel.length > 3 ? ' +' + (r.rel.length - 3) : ''}</td>`},
    {k: 'src', h: 'Source', v: r => r.src, td: r => `<td class="sm">${esc(r.src)}</td>`},
  ]};
TAB.notes = {
  rows: () => notes, sel: r => r.target || (r.end ? 'c:' + r.end : null), rel: r => { const t = r.target || (r.end ? 'c:' + r.end : ''); return t === S.sel || (t.startsWith('c:') && S.R.c.has(t.slice(2))); },
  hay: r => [r.text, r.target, r.end, r.view].join(' '),
  cols: [
    {k: 'at', h: 'When', v: r => r.at, td: r => `<td class="id sm">${esc(when(r.at))}</td>`},
    {k: 'by', h: 'Who', v: r => who(r.by), td: r => `<td class="sm nw">${esc(who(r.by))}</td>`},
    {k: 't', h: 'About', v: r => r.target || r.end, td: r => `<td class="id">${esc((r.target || ('c:' + (r.end || ''))).replace(/^[a-z]+:/, ''))}</td>`},
    {k: 'view', h: 'View', v: r => r.view, td: r => `<td class="sm">${esc(r.view || '')}</td>`},
    {k: 'text', h: 'Note', v: r => r.text, td: r => `<td class="clip"><span class="cl">${esc(r.text)}</span></td>`},
  ]};
function setTab(t) {
  S.tab = t; keep();
  document.querySelectorAll('#dtabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  $('#gq').value = S.gq[t] || '';
  renderGrid('tab');
}
document.querySelectorAll('#dtabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.t)));
$('#gq').addEventListener('input', e => { S.gq[S.tab] = e.target.value; renderGrid('filter'); });
$('#gsel').addEventListener('click', () => { S.onlySel = !S.onlySel; $('#gsel').setAttribute('aria-pressed', S.onlySel); renderGrid('filter'); });
$('#gchips').addEventListener('click', e => { const b = e.target.closest('[data-chip]'); if (b) { S.chip[S.tab] = b.dataset.chip; renderGrid('filter'); } });
function tabCounts() {
  $('#n-wires').textContent = Object.keys(W).length; $('#n-pins').textContent = TAB.pins.rows().length; $('#n-conns').textContent = items.length;
  $('#n-bom').textContent = (D.bom || []).length; $('#n-open').textContent = OPEN.length; $('#n-notes').textContent = notes.length;
}
function bomSummary() {
  const b = D.bom || [];
  const dev = b.filter(x => x.g === 'dev'), hw = b.filter(x => x.g === 'hw');
  const tot = a => a.reduce((s, x) => s + (x.price && x.unit !== 'ft' ? x.price.usd * (+x.qty || 0) : 0), 0);
  const pr = a => a.filter(x => x.price).length;
  const carts = (D.carts || []).map(c => `${esc(c.vendor || 'cart')} ${usd(c.total)} (${esc(c.line_count)} lines, ${esc(c.captured)})`).join(', ');
  const sys = {}; dev.forEach(x => { const s = sys[x.sys] = sys[x.sys] || {n: 0, p: 0, usd: 0}; s.n++; if (x.price) { s.p++; s.usd += x.price.usd * (+x.qty || 0); } });
  return `<tr class="grp"><td colspan="8"><span class="mono">Roll-up:</span> devices ${pr(dev)} of ${dev.length} lines priced, <span class="mono">${usd(tot(dev))}</span> list · plug hardware ${pr(hw)} of ${hw.length} priced, <span class="mono">${usd(tot(hw))}</span> · carts captured, not ordered: ${carts || 'none'} · paid amounts stay in your records ($•••)</td></tr>`
    + `<tr class="grp"><td colspan="8">By system (devices): ${Object.entries(sys).sort((a, b) => b[1].usd - a[1].usd).map(([k, s]) => `${esc(k)} <span class="mono">${s.p}/${s.n} · ${usd(s.usd)}</span>`).join(' · ')}</td></tr>`;
}
function renderGrid(from) {
  const T = TAB[S.tab], grid = $('#grid'), R = S.R || relOf(null);
  S.R = R;
  const chips = typeof T.chips === 'function' ? T.chips() : (T.chips || []);
  const cur = S.chip[S.tab] || '';
  $('#gchips').innerHTML = chips.map(([k, l]) => `<button type="button" class="tg" data-chip="${esc(k)}" aria-pressed="${cur === k}">${esc(l)}</button>`).join('');
  $('#gsel').setAttribute('aria-pressed', S.onlySel);
  const q = (S.gq[S.tab] || '').trim().toLowerCase();
  let list = T.rows();
  if (T.chip) list = list.filter(r => T.chip(r, cur));
  if (q) list = list.filter(r => T.hay(r).toLowerCase().includes(q));
  if (S.onlySel && S.sel) list = list.filter(r => T.rel(r) || T.sel(r) === S.sel);
  const so = S.sort[S.tab];
  if (so) { const c = T.cols.find(x => x.k === so.k); if (c && c.v) list = list.slice().sort((a, b) => { const x = c.v(a), y = c.v(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : natCmp(x, y)) * so.dir; }); }
  const MAX = 1200, shown = list.slice(0, MAX);
  const head = '<thead><tr>' + T.cols.map(c => `<th data-k="${c.k}" class="${c.ns ? 'nosort' : ''}"${so && so.k === c.k ? ` aria-sort="${so.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(c.h)}</th>`).join('') + '</tr></thead>';
  let body = '', lastG = null;
  if (S.tab === 'bom' && !q && !S.onlySel) body += bomSummary();
  shown.forEach(r => {
    if (T.group && !so) { const g = T.group(r); if (g !== lastG) { body += `<tr class="grp"><td colspan="${T.cols.length}">${esc(g)}</td></tr>`; lastG = g; } }
    const sid = T.sel(r), pri = T.pri ? T.pri(r) : (sid && sid === S.sel), rel = !pri && S.sel && T.rel(r);
    body += `<tr${sid ? ` data-sel="${esc(sid)}" tabindex="0"` : ''} class="${pri ? 'pri' : rel ? 'rel' : ''} ${T.rowCls ? T.rowCls(r) : ''}">${T.cols.map(c => c.td(r)).join('')}</tr>`;
  });
  if (!shown.length) body = `<tr class="empty"><td colspan="${T.cols.length}">${S.tab === 'notes' ? notesEmpty() : 'Nothing matches.'}</td></tr>`;
  grid.innerHTML = head + '<tbody>' + body + '</tbody>';
  const nrel = S.sel ? list.filter(r => T.rel(r) || T.sel(r) === S.sel).length : 0;
  $('#gcnt').textContent = `${shown.length}${list.length > MAX ? ' of ' + list.length : ''} rows${S.sel && !S.onlySel ? ` · ${nrel} linked` : ''}`;
  if (from === 'grid') { const r = grid.querySelector('tr.pri'); if (r) r.focus({preventScroll: true}); }
  if (from !== 'grid' && from !== 'filter') { const row = grid.querySelector('tr.pri') || grid.querySelector('tr.rel'); const wrap = $('#gwrap'); if (row) { const th = grid.querySelector('thead'), top = row.offsetTop - (th ? th.offsetHeight : 0); if (top < wrap.scrollTop || top + row.offsetHeight > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 3); } else if (from === 'tab') wrap.scrollTop = 0; }
}
$('#grid').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (th && !th.classList.contains('nosort')) { const k = th.dataset.k, so = S.sort[S.tab]; S.sort[S.tab] = so && so.k === k ? (so.dir > 0 ? {k, dir: -1} : null) : {k, dir: 1}; renderGrid('filter'); return; }
  if (e.target.closest('a')) return;
  const tr = e.target.closest('tr[data-sel]'); if (tr) select(tr.dataset.sel, 'grid');
});
$('#grid').addEventListener('keydown', e => {
  const tr = e.target.closest('tr[data-sel]'); if (!tr) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(tr.dataset.sel, 'grid'); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    let nx = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
    while (nx && !nx.dataset.sel) nx = e.key === 'ArrowDown' ? nx.nextElementSibling : nx.previousElementSibling;
    if (nx) { const ix = [...nx.parentNode.children].indexOf(nx); select(nx.dataset.sel, 'grid'); const again = $('#grid tbody').children[ix]; if (again) { again.focus({preventScroll: true}); again.scrollIntoView({block: 'nearest'}); } }
  }
});
$('#grid').addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-sel]'); if (tr && tr.dataset.sel.startsWith('c:')) setHov(tr.dataset.sel.slice(2)); });
$('#grid').addEventListener('mouseleave', () => setHov(null));

// ---------------------------------------------------------------- sources and rules
$('#srcbtn').addEventListener('click', () => {
  const cls = {};
  items.forEach(i => { const m = i.margin || {}; (cls[m.cls] = cls[m.cls] || {n: 0, m}).n++; });
  const CL = {engine: 'On the LS3 (twin engine anchor)', body: 'On the body model', described: 'Placed from a spot named in words', candidate: 'Candidate spot, not decided', stated: 'Margin stated in the placement note', grouped: 'Sits with another end', unknown: 'No rule'};
  $('#dlg-body').innerHTML = `<h2 id="dlg-h">Sources and rules</h2>
    <p class="fine">A script builds this page from the files below; nothing is typed in by hand. Every value's own source shows under it when <b>Sources</b> is on in the properties panel.</p>
    <h3>Inputs</h3><div class="tscroll"><table class="tbl"><tbody>${Object.entries(D.sources).map(([k, v]) => `<tr><th>${esc(k)}</th><td class="mono" style="font-size:11px">${esc(v)}</td></tr>`).join('')}<tr><th>decisions</th><td class="mono" style="font-size:11px">${esc(D.dec_src)}</td></tr><tr><th>built</th><td class="mono" style="font-size:11px">${esc(D.built)} from main ${esc(D.main)}</td></tr></tbody></table></div>
    <h3>Margins: how far each end can be from its drawn spot</h3><p class="fine">Nothing is tape-measured yet. Each end's margin comes from how its spot was found. The owner's working margin for laying out wire is 150 to 300 mm (6 to 12 in); where a spot is known better, the tighter number is used.</p>
    <div class="tscroll"><table class="tbl"><thead><tr><th>Placed</th><th class="num">Ends</th><th>Margin</th><th>Where the number comes from</th></tr></thead><tbody>${Object.entries(cls).map(([k, v]) => `<tr><td>${esc(CL[k] || k)}</td><td class="num">${v.n}</td><td class="mono">${esc(marginText(v.m))}</td><td>${esc(k === 'engine' ? v.m.text.split(';')[0] : v.m.text)}</td></tr>`).join('')}</tbody></table></div>
    <h3>What harness-cad's bay sample measured</h3><div class="tscroll"><table class="tbl"><tbody>${((D.bay || {}).stats || []).map(s => `<tr><th>${esc(s[0])}</th><td class="mono">${esc(s[1])}</td><td>${esc(s[2])}</td></tr>`).join('')}</tbody></table></div><p class="fine">${esc((D.bay || {}).src || '')}. Its findings are in Open items, kind Finding.</p>
    <h3>Rules on this page</h3><ul class="olist"><li>Parts are drawn at true size in their product colour where a size is read; a part whose size is not read is listed, not drawn, and shows a crosshair with its margin.</li><li>Looms are drawn at their true outer diameter from harness-cad, never thinner than 1.6 screen pixels.</li><li>Paid amounts and order numbers stay in the records; the page shows $••• and order •••. List prices older than ${esc(D.stale_days)} days are marked stale.</li><li>Stations are inches behind the front axle; lateral is inches off the centreline, positive toward the driver; height is inches above the ground. Lengths are mm.</li><li>"Ask" sends only this page's record for the selection to Claude, on the viewer's own Claude plan. Notes are saved with the record, the view, the time and who wrote them.</li></ul>`;
  $('#dlg').hidden = false; $('#dlg-x').focus();
});
$('#dlg-x').addEventListener('click', () => { $('#dlg').hidden = true; });
$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg') $('#dlg').hidden = true; });

// ---------------------------------------------------------------- ask Claude about the selection (sample capability)
let sampleFn = null, sampleState = 'loading', toolsOk = false, askCtl = null;
function record(id) {
  const k = kindOf(id), v = id && valOf(id);
  if (k === 'c') { const i = byId[v]; if (!i) return null; const m = i.media || {};
    return {kind: 'connector', id: i.id, what: i.what, zone: ZONES[i.zone] || i.zone, status: WORD[i.status], device: devName(i.dev), part: {maker: m.maker, part_number: m.maker_pn, photo_confidence: m.confidence, mates_with: m.mates_with},
      connector: i.conn, position: {station_in: i.st.station_in, lateral_in_positive_driver: i.st.lateral_in, height_in: i.st.height_in, placed_from: i.basis, margin: effMargin(i)},
      size: i.fp ? {envelope_mm: sizeText(i.fp), source: i.fp.size} : {not_drawn: NOTDRAWN[i.why_not], why: i.why_not_text},
      pins: (PINS[i.id] || []).map(p => ({cavity: p.c, name: p.n, function: p.f, wires: p.w, terminal: p.t})), why: i.why, still_open: ((D.open_by || {})['c:' + i.id] || []).map(x => openById[x].text), commercial: {status: (i.buy || {}).status}}; }
  if (k === 'w') { const w = W[v]; if (!w) return null; return {kind: 'wire', id: w.id, label: w.label, system: sysName(w.sub), gauge: gaugeOf(w), spec: w.spec, colour: w.color, path: (w.ch || []).map(c => ({end: c[0], cavity: c[1], terminal: c[2]})), length: wireLen(w), cut_list_length_ft: w.len_ft, status: w.kind, route_segments: w.segs, notes: w.notes, sources: w.src}; }
  if (k === 'p') { const p = pinByKey[v]; if (!p) return null; return {kind: 'pin', connector: v.split('|')[0], cavity: p.c, name: p.n, function: p.f, terminal: p.t, wires: p.w.map(x => record('w:' + x))}; }
  if (k === 's') { const s = segById[v]; if (!s) return null; return {kind: 'route segment', id: s.id, bundle: s.bundle, od_mm: s.od_mm, length_mm: Math.round((s.length_m || 0) * 1000), margin_mm: s.margin_mm, covering: s.covering, wires: s.wires, why: s.why, checks: (s.checks || []).map(c => ({rule: c.rule, result: c.result, why: c.why}))}; }
  if (k === 'd') { const d = DEVS[v]; if (!d) return null; return {kind: 'device', id: d.id, name: d.name, maker: d.maker, part_number: d.pn, connectors: d.conns}; }
  if (k === 'y') { const y = SYS[v]; if (!y) return null; return {kind: 'system', id: y.id, name: y.name, wires: y.wires.map(x => ({id: x, label: W[x].label, from: endTxt((W[x].ch || [])[0]), to: endTxt((W[x].ch || []).slice(-1)[0])}))}; }
  if (k === 'o') { const o = openById[v]; return o ? {kind: 'open item', type: o.kind, text: o.text, who_acts: o.who, source: o.src, records: o.rel} : null; }
  return null;
}
const SAMPLE_COPY = {rate_limited: 'Too many questions at once. Wait a minute and ask again.', session_expired: 'Sign in to claude.ai again, then ask.', refused: 'Claude declined that question. Ask it another way.',
  empty_completion: 'No answer came back. Ask it another way.', prompt_too_large: 'That was too much to send. Ask a shorter question.', upstream_error: 'The answer was cut off. Ask again.'};
const HIDE = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
const F = {mode: 'ask', q: '', note: '', ans: {}, busy: false};
function footHtml() {
  const id = S.sel, lbl = id ? labelOf(id) : '';
  const tabs = `<div class="ftabs" role="group" aria-label="Talk to the system"><button type="button" data-f="ask" aria-pressed="${F.mode === 'ask'}">Ask about the selection</button><button type="button" data-f="note" aria-pressed="${F.mode === 'note'}">Note to the build agents</button></div>`;
  if (!id || !record(id)) return tabs + `<p class="fine" style="margin:0">Select a connector, pin, wire, segment, device or system first.</p>`;
  if (F.mode === 'ask') {
    if (sampleState === 'off') return tabs + `<p class="fine" style="margin:0">Asking Claude works when this page is open on claude.ai by a signed-in viewer. It is not available in this view.</p>`;
    const a = F.ans[id] || {};
    return tabs + `<textarea class="ta" id="ask-q" placeholder="Ask about ${esc(lbl)}: what it plugs into, what is still open, what gauge feeds it..." aria-label="Question about ${esc(lbl)}">${esc(F.q)}</textarea>
      <div class="btnrow"><button type="button" class="btn pri" id="ask-go"${sampleState !== 'ready' || F.busy ? ' disabled' : ''}>Ask</button><button type="button" class="btn" id="ask-stop"${F.busy ? '' : ' hidden'}>Stop</button><span class="fine" id="ask-msg" style="margin:0">${esc(a.msg || '')}</span></div>
      <div class="answer" id="ask-out">${esc(a.text || '')}</div><p class="fine">Claude answers from this page's record of ${esc(lbl)} only, on your own Claude plan; claude.ai asks you to allow it the first time.</p>`;
  }
  let form;
  if (dbState === 'off') form = `<p class="fine" style="margin:0">Notes are kept on claude.ai. Open this page there, signed in, to leave one.</p>`;
  else if (dbState === 'loading') form = `<p class="fine" style="margin:0">Connecting to the page's note store...</p>`;
  else if (!myId) form = `<p class="fine" style="margin:0">Sign in to claude.ai to leave a note: every note carries who wrote it.</p>`;
  else if (canWrite === false) form = `<p class="fine" style="margin:0">You can read the notes here but not add them.</p>`;
  else form = `<textarea class="ta" id="note-t" placeholder="What should change at ${esc(lbl)}: the spot, the part, a size, a route..." aria-label="Note about ${esc(lbl)}">${esc(F.note)}</textarea>
    <div class="btnrow"><button type="button" class="btn pri" id="note-go">Save note</button><span class="fine" id="note-msg" style="margin:0"></span></div><p class="fine">Saved with ${esc(lbl)}, the ${esc(S.view)} view, the time and your name. The build agents read these notes.</p>`;
  return tabs + form;
}
function renderFoot() {
  const el = $('#pfoot'); el.innerHTML = footHtml();
  const q = $('#ask-q'); if (q) { q.addEventListener('input', () => { F.q = q.value; }); q.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); }); }
  const go = $('#ask-go'); if (go) go.addEventListener('click', ask);
  const stp = $('#ask-stop'); if (stp) stp.addEventListener('click', () => askCtl && askCtl.abort());
  const t = $('#note-t'); if (t) t.addEventListener('input', () => { F.note = t.value; });
  const ng = $('#note-go'); if (ng) ng.addEventListener('click', saveNote);
}
$('#pfoot').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { F.mode = b.dataset.f; renderFoot(); } });
async function ask() {
  const id = S.sel, q = (F.q || '').trim();
  if (!q || !id || !sampleFn || F.busy) return;
  const a = F.ans[id] = {text: 'Thinking...', msg: ''};
  askCtl = new AbortController(); F.busy = true; renderFoot();
  const show = () => { if (S.sel === id && F.mode === 'ask') { const o = $('#ask-out'), m = $('#ask-msg'); if (o) o.textContent = a.text; if (m) m.textContent = a.msg; } };
  const prompt = 'You answer questions about one record on a 1977 Chevrolet K5 Blazer wiring harness build (LS3 engine, MoTeC M130 ECU, MoTeC PDM30 in the cab, PDM15 in the engine bay, one 61-pin D38999 connector through the firewall).\n'
    + 'Use ONLY the page data below. Quote numbers exactly, with their source. If the data does not answer the question, say so plainly and name the record or document that would settle it. Never guess a part number, size, pin or length. '
    + 'Stations are inches behind the front axle; lateral is inches off the centreline, positive toward the driver. Lengths are mm. Answer in plain text, at most 170 words.\n\n'
    + 'PAGE DATA for ' + labelOf(id) + ' (JSON):\n' + JSON.stringify(record(id)) + '\n\nQUESTION: ' + q;
  const opts = {signal: askCtl.signal, onText: ({text}) => { a.text = text; show(); }};
  if (toolsOk) opts.tools = [{name: 'get_record', description: 'Look up another record on this page: a connector (c:M130-A), a wire (w:4a), a pin (p:M130-A|A01), a route segment (s:DC-63), a device (d:M130) or a system (y:CORE_ENGINE). Returns its page record as JSON.',
    inputSchema: {type: 'object', properties: {id: {type: 'string', description: 'the record id with its prefix, for example c:M130-A'}}, required: ['id']},
    execute: input => { const r = record(String(input.id || '')); if (!r) throw new Error('no record with id ' + input.id); a.msg = 'Reading ' + input.id + '...'; show(); return r; }}];
  try { const r = await sampleFn(prompt, opts); a.text = r.text; a.msg = r.truncated ? 'The answer was cut short. Ask for less at a time.' : ''; }
  catch (e) {
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
function when(iso) { try { return new Date(iso).toLocaleString(undefined, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}); } catch (e) { return iso; } }
function who(id) { return (names[id] && names[id].name) || (id && id === myId ? 'you' : 'Someone'); }
function notesEmpty() { return dbState === 'off' ? 'Notes are kept on claude.ai. Open this page there, signed in, to read and leave them.' : dbState === 'loading' ? 'Connecting to the note store...' : 'No notes yet. Select anything, then use "Note to the build agents" at the bottom of the properties panel.'; }
function renderNoteBox() {
  const el = $('#notes-sect'); if (!el) return;
  const t = S.sel, mine = t ? notes.filter(n => (n.target || (n.end ? 'c:' + n.end : '')) === t) : [];
  el.innerHTML = mine.length ? sec('Notes to the build agents', mine.map(n => `<div class="note"><div class="meta">${esc(when(n.at))} · ${esc(who(n.by))} · ${esc(n.view || '')} view</div>${esc(n.text)}</div>`).join(''), {n: mine.length}) : '';
}
async function saveNote() {
  const id = S.sel, msg = $('#note-msg'), go = $('#note-go'), text = (F.note || '').trim();
  if (!text || !id) { if (msg) msg.textContent = 'Write the note first.'; return; }
  go.disabled = true; msg.textContent = 'Saving...';
  try {
    const doc = {target: id, what: labelOf(id), view: S.view === 'vehicle' ? S.v2 : S.view, at: new Date().toISOString(), by: myId, text: text.slice(0, 4000)};
    if (kindOf(id) === 'c') doc.end = valOf(id);
    await db.collection('notes').add(doc);
    F.note = ''; renderFoot(); const m2 = $('#note-msg'); if (m2) m2.textContent = 'Saved.';
  } catch (e) {
    const code = e && e.code;
    if (code === 'invalid_argument') { canWrite = false; renderFoot(); return; }
    msg.textContent = code === 'quota_exceeded' ? 'The note store is full. Tell the build agents.' : 'Not saved. Try again.'; go.disabled = false;
  }
}
async function resolveNames() { if (!user) return; const ids = uniq(notes.map(n => n.by).filter(Boolean)); if (!ids.length) return; try { names = await user.profiles(ids); } catch (e) {} renderNoteBox(); if (S.tab === 'notes') renderGrid('filter'); }
(async () => {
  const off = () => { dbState = 'off'; renderNoteBox(); renderFoot(); if (S.tab === 'notes') renderGrid('filter'); };
  if (!window.claude || !window.claude.use) return off();
  try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch (e) {}
  if (!db) return off();
  if (user) { try { myId = await user.id(); canWrite = await user.can('data.write'); } catch (e) {} }
  dbState = 'ready';
  db.collection('notes').orderBy('at', 'desc').limit(500).onSnapshot(snap => { notes = snap.docs.map(d => Object.assign({id: d.id}, d.data())); tabCounts(); renderNoteBox(); if (S.tab === 'notes') renderGrid('filter'); resolveNames(); }, off);
  renderNoteBox(); renderFoot(); if (S.tab === 'notes') renderGrid('filter');
})();

// ---------------------------------------------------------------- start: the 61-pin, the one connector through the firewall
renderStrip(); renderTree(); tabCounts(); renderTools();
setView(S.view);
setTab(S.tab);
const hash = (location.hash || '').slice(1);
const fromHash = hash.replace(/^([a-z]+)\./, '$1:').replace(/~/g, '|');
const views = {vehicle: 1, conn: 1, sch: 1, lib: 1, '3d': 1};
if (views[hash]) { if (hash === '3d') { setView('vehicle'); setMode('3d'); renderTools(); } else setView(hash); }
const start = record(fromHash) ? fromHash : (byId['FIREWALL-CABIN'] ? 'c:FIREWALL-CABIN' : 'c:' + items[0].id);
select(start, 'start');
})();
