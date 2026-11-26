// Geometry extracted from the existing SchematicBlock (PR4032). This decides
// only screen placement: segment endpoints and mating relations come from SQL.
export interface DiagramEnd { id: string; endpointId: string; nodeKey: string; code: string; cavity: string | null; isBus: boolean }
export interface DiagramPiece { id: string; code: string; from: DiagramEnd | null; to: DiagramEnd | null }
interface Row { key: string; isBus: boolean; code: string; cav: string; cavityLines: string[]; height: number; wires: string[]; terminationIds: string[]; y: number; dev: string }
interface Place { col: number; x: number; y: number; w: number; h: number; rows: Row[] }
const PASS = /^(FIREWALL-|SPL-|RAIL-)|PASS/;
export const DIAGRAM_ROW = 32, DIAGRAM_HEADER = 44;
const ROW = DIAGRAM_ROW, HDR = DIAGRAM_HEADER, GAP = 30, BW = [280, 280, 280], LANE = 9;

function cavityLines(value: string): string[] {
  const lines: string[] = []; let rest = value || 'Cavity not recorded';
  while (rest.length > 34) {
    const space = rest.lastIndexOf(' ', 34), cut = space > 12 ? space : 34;
    lines.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}

export function layoutPhysicalPieces<P extends DiagramPiece>(pieces: P[]) {
  const rows = new Map<string, Map<string, Row>>();
  const score = new Map<string, number>();
  pieces.forEach(p => [p.from, p.to].forEach((h, i) => {
    if (!h) return;
    const dev = h.endpointId, k = h.nodeKey;
    const m = rows.get(dev) ?? new Map<string, Row>(); rows.set(dev, m);
    const lines = cavityLines(h.cavity ?? '');
    const r = m.get(k) ?? { key: k, isBus: h.isBus, code: h.code, cav: h.cavity ?? '', cavityLines: lines,
      height: Math.max(ROW, lines.length * 14 + 18), wires: [], terminationIds: [], y: 0, dev }; m.set(k, r);
    if (!r.wires.includes(p.code)) r.wires.push(p.code);
    if (!r.terminationIds.includes(h.id)) r.terminationIds.push(h.id);
    if (!PASS.test(h.code)) score.set(dev, (score.get(dev) ?? 0) + (i === 0 ? 1 : -1));
  }));
  const cols: string[][] = [[], [], []];
  rows.forEach((rs, dev) => cols[PASS.test(rs.values().next().value?.code ?? '') ? 1 : (score.get(dev) ?? 0) > 0 ? 0 : 2].push(dev));
  if (!cols[0].length && cols[2].length) cols[0].push(cols[2].shift()!);
  const place = new Map<string, Place>();
  const layCol = (ci: number, order: string[]) => {
    let y = 40;
    order.forEach(dev => {
      const rs = [...(rows.get(dev)?.values() ?? [])].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
      const h = HDR + rs.reduce((total, r) => total + r.height, 0) + 6;
      let rowY = y + HDR;
      rs.forEach(r => { r.y = rowY + r.height / 2; rowY += r.height; });
      place.set(dev, { col: ci, x: 0, y, w: BW[ci], h, rows: rs });
      y += h + GAP;
    });
    return y;
  };
  const bary = (dev: string) => {
    const ys: number[] = [];
    pieces.filter(p => p.from?.endpointId === dev || p.to?.endpointId === dev).forEach(piece => {
      [piece.from, piece.to].forEach(h => {
        if (!h || h.endpointId === dev) return;
        const rr = place.get(h.endpointId)?.rows.find(x => x.key === h.nodeKey);
        if (rr) ys.push(rr.y);
      });
    });
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e9;
  };
  cols[0].sort((a, b) => (rows.get(b)?.size ?? 0) - (rows.get(a)?.size ?? 0));
  const hL = layCol(0, cols[0]);
  cols[1].sort((a, b) => bary(a) - bary(b)); const hM = layCol(1, cols[1]);
  cols[2].sort((a, b) => bary(a) - bary(b)); const hR = layCol(2, cols[2]);
  const has1 = cols[1].length > 0;
  const hops: { wc: string; piece: P; a: Row; b: Row | null; d: string; lo: number; hi: number }[] = [];
  pieces.forEach(piece => {
    const a = piece.from ? place.get(piece.from.endpointId)?.rows.find(r => r.key === piece.from!.nodeKey) : null;
    const b = piece.to ? place.get(piece.to.endpointId)?.rows.find(r => r.key === piece.to!.nodeKey) : null;
    if (a || b) hops.push({ wc: piece.code, piece, a: (a ?? b)!, b: a ? b ?? null : null, d: '', lo: 0, hi: 0 });
  });
  const chA: typeof hops = [], chB: typeof hops = [], chC: typeof hops = [], over: typeof hops = [];
  hops.forEach(h => {
    if (!h.b) return;
    const ca = place.get(h.a.dev)!.col, cb = place.get(h.b.dev)!.col;
    h.lo = Math.min(ca, cb); h.hi = Math.max(ca, cb);
    if (h.lo === h.hi) (h.lo === 0 ? chA : h.lo === 1 ? chB : chC).push(h);
    else if (h.lo === 0 && h.hi === 1) chA.push(h);
    else if (h.lo === 1) chB.push(h);
    else if (!has1) chA.push(h);
    else { over.push(h); chA.push(h); chB.push(h); }
  });
  const top = (h: typeof hops[number]) => Math.min(h.a.y, h.b?.y ?? h.a.y);
  [chA, chB, chC, over].forEach(c => c.sort((p, q) => top(p) - top(q)));
  const wA = Math.max(70, chA.length * LANE + 44), wB = Math.max(70, chB.length * LANE + 44);
  const X = [20, 20 + BW[0] + wA, 0];
  X[2] = has1 ? X[1] + BW[1] + wB : X[1];
  place.forEach(p => { p.x = X[p.col]; });
  const laneX = (c: typeof hops, h: typeof hops[number]) => (c === chA ? X[0] + BW[0] : c === chB ? X[1] + BW[1] : X[2] + BW[2]) + 22 + c.indexOf(h) * LANE;
  const bottom = Math.max(hL, hM, hR);
  hops.forEach(h => {
    const pa = place.get(h.a.dev)!;
    if (!h.b) { h.d = `M${pa.x + pa.w} ${h.a.y}h40`; return; }
    const pb = place.get(h.b.dev)!, ca = pa.col, cb = pb.col;
    if (ca === cb) { const x = laneX(ca === 0 ? chA : ca === 1 ? chB : chC, h); h.d = `M${pa.x + pa.w} ${h.a.y}H${x}V${h.b.y}H${pb.x + pb.w}`; return; }
    const right = ca < cb, ax = right ? pa.x + pa.w : pa.x, bx = right ? pb.x : pb.x + pb.w;
    if (over.includes(h)) {
      const xa = laneX(chA, h), xb = laneX(chB, h), yb = bottom + 10 + over.indexOf(h) * LANE, [x1, x2] = right ? [xa, xb] : [xb, xa];
      h.d = `M${ax} ${h.a.y}H${x1}V${yb}H${x2}V${h.b.y}H${bx}`;
    } else h.d = `M${ax} ${h.a.y}H${laneX(h.lo === 0 ? chA : chB, h)}V${h.b.y}H${bx}`;
  });
  const width = (cols[2].length ? X[2] + BW[2] : X[1] + (has1 ? BW[1] : 0)) + 40 + chC.length * LANE;
  const height = bottom + 20 + over.length * LANE + 10;
  return { place, hops, width, height, cols, X };
}
