#!/usr/bin/env node
// Cut a sourced identity mark (public/stacks/makes) out of its background into an RGBA PNG, cropped to the mark, so
// the headline can set it directly on the page surface. The original file stays committed beside the cutout; each
// catalogue entry's `cutout` records the command that made its file (vehicle-identities.json).
//   mono  file "x y w h" out channel polarity lo hi   -> black letterforms, alpha from one channel's levels
//         (polarity dark: ink darker than ground; light: ink lighter). Used as a CSS mask (text colour).
//   chrome file "x y w h" out                          -> keeps the photographed chrome, removes the white catalogue ground
//   key   file "x y w h" out channel lo hi             -> keeps colour; alpha rises with the channel from lo to hi
//   --level=<deg>@"x y w h"  first take that region and rotate it by deg (black corners) to level a photographed decal;
//                            the viewport then addresses the levelled region.
// Prints the output size and the trimmed crop in source (or levelled) coordinates.
const sharp = require('sharp');
const args = process.argv.slice(2);
const levelArg = args.find(a => a.startsWith('--level='));
const [mode, file, vp, out, ...rest] = args.filter(a => a !== levelArg);
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
      if (border || (members.length >= 20 && pure / members.length >= 0.9)) for (const i of members) bg[i] = 1;
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
  // Trim to the mark (alpha > 24) with 1px padding.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] > 24) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png({ compressionLevel: 9, palette: false }).toFile(out);
  console.log(JSON.stringify({ out, width: x1 - x0 + 1, height: y1 - y0 + 1, crop: `${X + x0} ${Y + y0} ${x1 - x0 + 1} ${y1 - y0 + 1}` }));
})();
