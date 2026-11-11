#!/usr/bin/env node
// Cut a sourced identity mark (public/stacks/makes) out of its background into an RGBA PNG, cropped to the mark, so
// the headline can set it directly on the page surface. The original file stays committed beside the cutout; each
// catalogue entry's `cutout` records the command that made its file (vehicle-identities.json).
//   mono  file "x y w h" out channel polarity lo hi   -> black letterforms, alpha from one channel's levels
//         (polarity dark: ink darker than ground; light: ink lighter). Used as a CSS mask (text colour).
//   chrome file "x y w h" out                          -> keeps the photographed chrome, removes the white catalogue ground
//   key   file "x y w h" out channel lo hi             -> keeps colour; alpha rises with the channel from lo to hi
//   measure file "x0-x1"                               -> prints capMetrics of an existing cutout (see --cap)
//   --level=<deg>@"x y w h"  first take that region and rotate it by deg (black corners) to level a photographed decal;
//                            the viewport then addresses the levelled region.
//   --ground="x,y;x,y"       chrome: the near-white region holding each source point is catalogue ground seen through
//                            the part (a script's enclosed counters), not a painted face.
//   --min-area=<px>          drop isolated specks: 8-connected ink components (alpha > 24) smaller than this.
//   --defringe=<px>          pull the rim in by <px> (alpha erosion), soften it by a half-pixel blur, and give every
//                            edge pixel the colour of the opaque mark beside it, so no ground or paint colour rims it.
//   --cap=<x0>-<x1>          output columns of a reference capital (a script's F); prints capMetrics measured on it.
// Prints the output size, the trimmed crop in source (or levelled) coordinates and, with --cap, capMetrics: the
// capital's height and its baseline's distance from the bottom, as fractions of the file height.
const sharp = require('sharp');
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const levelArg = args.find(a => a.startsWith('--level='));
const [mode, file, vp, out, ...rest] = args.filter(a => !a.startsWith('--'));
// Capitals' share of the file height and the baseline's distance from its bottom, from rows holding ink (alpha >= 128)
// in the reference columns.
const capMetrics = (alpha, W, H, cols) => {
  const [c0, c1] = cols ? cols.split('-').map(Number) : [0, W - 1];
  let top = -1, bottom = -1;
  for (let y = 0; y < H; y++) for (let x = c0; x <= c1; x++) if (alpha[y * W + x] >= 128) { if (top < 0) top = y; bottom = y; break; }
  const r = v => Math.round(v * 1000) / 1000;
  return { capHeight: r((bottom - top + 1) / H), baseline: r((H - bottom - 1) / H) };
};
if (mode === 'measure') {
  sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
    const alpha = new Uint8Array(info.width * info.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
    console.log(JSON.stringify({ file, capMetrics: capMetrics(alpha, info.width, info.height, vp) }));
  });
  return;
}
const [X, Y, W, H] = vp.split(' ').map(Number);
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
(async () => {
  let input = file;
  if (levelArg) {
    const [deg, region] = levelArg.slice(8).split('@'); const [lx, ly, lw, lh] = region.split(' ').map(Number);
    input = await sharp(file).extract({ left: lx, top: ly, width: lw, height: lh }).rotate(Number(deg), { background: '#000' }).png().toBuffer();
  }
  const { data } = await sharp(input).extract({ left: X, top: Y, width: W, height: H }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const N = W * H, rgba = Buffer.alloc(N * 4);
  const px = i => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  const chan = (c, [r, g, b]) => c === 'r' ? r : c === 'g' ? g : c === 'b' ? b : 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (mode === 'mono' || mode === 'key') {
    const [c, a, b, d] = rest; const polarity = mode === 'mono' ? a : 'light';
    const lo = +(mode === 'mono' ? b : a), hi = +(mode === 'mono' ? d : b);
    for (let i = 0; i < N; i++) {
      const p = px(i), v = chan(c, p);
      const t = polarity === 'dark' ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo);
      const alpha = clamp(t * 255);
      if (mode === 'mono') rgba.set([0, 0, 0, alpha], i * 4); else rgba.set([p[0], p[1], p[2], alpha], i * 4);
    }
  } else if (mode === 'chrome') {
    const minc = i => Math.min(...px(i)), near = new Uint8Array(N), comp = new Int32Array(N).fill(-1), bg = new Uint8Array(N);
    for (let i = 0; i < N; i++) near[i] = minc(i) >= 246 ? 1 : 0;
    const seeds = (flag('ground') ?? '').split(';').filter(Boolean).map(p => { const [sx, sy] = p.split(',').map(Number); return (sy - Y) * W + (sx - X); });
    for (const i of seeds) if (!near[i]) throw new Error(`--ground point ${i % W + X},${((i / W) | 0) + Y} is not near-white ground`);
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (!near[s] || comp[s] >= 0) continue;
      const stack = [s], members = []; comp[s] = id; let border = false, pure = 0;
      while (stack.length) {
        const i = stack.pop(); members.push(i);
        const x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (minc(i) === 255) pure++;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1])
          if (j >= 0 && near[j] && comp[j] < 0) { comp[j] = id; stack.push(j); }
      }
      // The ground touches the frame; an enclosed counter is flat pure white like the ground. Painted faces are not.
      if (border || (members.length >= 20 && pure / members.length >= 0.9) || seeds.some(i => comp[i] === id)) for (const i of members) bg[i] = 1;
      id++;
    }
    for (let i = 0; i < N; i++) {
      const p = px(i); let alpha = 255;
      if (bg[i]) alpha = 0;
      else {
        const x = i % W, y = (i / W) | 0;
        const edge = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1].some(j => j >= 0 && bg[j]);
        // Feather the rim: light anti-aliased pixels next to the ground lose opacity instead of leaving a white halo.
        if (edge) alpha = clamp((255 - Math.min(...p)) * 3);
      }
      rgba.set([p[0], p[1], p[2], alpha], i * 4);
    }
  } else throw new Error('mode');
  const minArea = Number(flag('min-area') ?? 0), defringe = Number(flag('defringe') ?? 0);
  if (minArea) {
    // Isolated specks (crumbs of ground or dust the key let through) are not part of the mark.
    const seen = new Uint8Array(N);
    for (let s = 0; s < N; s++) {
      if (seen[s] || rgba[s * 4 + 3] <= 24) continue;
      const stack = [s], members = []; seen[s] = 1;
      while (stack.length) {
        const i = stack.pop(); members.push(i); const x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, j = ny * W + nx;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[j] && rgba[j * 4 + 3] > 24) { seen[j] = 1; stack.push(j); }
        }
      }
      if (members.length < minArea) for (const i of members) rgba[i * 4 + 3] = 0;
    }
  }
  if (defringe) {
    let alpha = new Uint8Array(N);
    for (let i = 0; i < N; i++) alpha[i] = rgba[i * 4 + 3];
    const opaque = alpha.map(a => a === 255 ? 1 : 0);
    // Erode: each pass keeps the 3x3 minimum, pulling the rim (ground- or paint-tinted) in by one source pixel.
    for (let pass = 0; pass < defringe; pass++) {
      const next = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const x = i % W, y = (i / W) | 0; let m = alpha[i];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; m = Math.min(m, nx >= 0 && ny >= 0 && nx < W && ny < H ? alpha[ny * W + nx] : 0);
        }
        next[i] = m;
      }
      alpha = next;
    }
    // Soften the eroded rim: a 3x3 binomial blur (about a half-pixel Gaussian) instead of a stepped edge.
    const k = [1, 2, 1], soft = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const x = i % W, y = (i / W) | 0; let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; sum += k[dx + 1] * k[dy + 1] * (nx >= 0 && ny >= 0 && nx < W && ny < H ? alpha[ny * W + nx] : 0);
      }
      soft[i] = clamp(sum / 16);
    }
    // Decontaminate: pixels that were not fully opaque take the colour of the nearest opaque interior, spread outward
    // ring by ring, so the soft rim carries the mark's own colour and none of the ground's.
    const known = new Uint8Array(N);
    for (let i = 0; i < N; i++) known[i] = opaque[i] && alpha[i] === 255 ? 1 : 0;
    for (let ring = 0; ring < defringe + 3; ring++) {
      const add = [];
      for (let i = 0; i < N; i++) {
        if (known[i]) continue;
        const x = i % W, y = (i / W) | 0; let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, j = ny * W + nx;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && known[j]) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++; }
        }
        if (n) add.push([i, r / n, g / n, b / n]);
      }
      for (const [i, r, g, b] of add) { rgba[i * 4] = clamp(r); rgba[i * 4 + 1] = clamp(g); rgba[i * 4 + 2] = clamp(b); known[i] = 1; }
    }
    for (let i = 0; i < N; i++) rgba[i * 4 + 3] = soft[i];
  }
  // Trim to the mark (alpha > 24) with 1px padding.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] > 24) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png({ compressionLevel: 9, palette: false }).toFile(out);
  const OW = x1 - x0 + 1, OH = y1 - y0 + 1, outAlpha = new Uint8Array(OW * OH);
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) outAlpha[y * OW + x] = rgba[((y + y0) * W + x + x0) * 4 + 3];
  const cap = flag('cap');
  console.log(JSON.stringify({ out, width: OW, height: OH, crop: `${X + x0} ${Y + y0} ${OW} ${OH}`, ...(cap ? { capMetrics: capMetrics(outAlpha, OW, OH, cap) } : {}) }));
})();
