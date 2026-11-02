#!/usr/bin/env node
// Deterministic color tracing. Originals remain byte-for-byte unchanged.
// macOS sips decodes the reference; installed Potrace produces real SVG paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.error || result.status}`);
  return result.stdout;
}

export function traceEmblem(source, destination, { crop, clear = [], label = 'Emblem reference' } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'emblem-trace-'));
  try {
    const bitmap = path.join(temporary, 'source.bmp');
    run('sips', ['-s', 'format', 'bmp', source, '--out', bitmap]);
    const bmp = fs.readFileSync(bitmap), offset = bmp.readUInt32LE(10);
    const sourceWidth = bmp.readInt32LE(18), signedHeight = bmp.readInt32LE(22), sourceHeight = Math.abs(signedHeight);
    const bits = bmp.readUInt16LE(28), stride = Math.ceil(sourceWidth * bits / 32) * 4;
    if (bmp.toString('ascii', 0, 2) !== 'BM' || bits !== 24 || bmp.readUInt32LE(30) !== 0) throw new Error('Expected an uncompressed 24-bit BMP');
    const [left, top, width, height] = crop ?? [0, 0, sourceWidth, sourceHeight];
    if (left < 0 || top < 0 || left + width > sourceWidth || top + height > sourceHeight) throw new Error('Crop outside original');
    const pixels = new Array(width * height), background = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const row = signedHeight < 0 ? top + y : sourceHeight - 1 - top - y;
      const at = offset + row * stride + (left + x) * 3;
      pixels[y * width + x] = [bmp[at + 2], bmp[at + 1], bmp[at]];
    }
    // Flood only the paper background and explicitly selected negative spaces.
    // White chrome/enamel inside the outline is retained, rather than globally erased.
    const queue = [];
    const enqueue = index => {
      if (index < 0 || index >= pixels.length || background[index]) return;
      const rgb = pixels[index];
      if (Math.min(...rgb) < 247 || Math.max(...rgb) - Math.min(...rgb) > 8) return;
      background[index] = 1; queue.push(index);
    };
    for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1); }
    for (const [x, y] of clear) enqueue(y * width + x);
    for (let next = 0; next < queue.length; next++) {
      const index = queue[next], x = index % width, y = Math.floor(index / width);
      if (x) enqueue(index - 1); if (x + 1 < width) enqueue(index + 1);
      if (y) enqueue(index - width); if (y + 1 < height) enqueue(index + width);
    }
    const palette = ['#111214', '#303235', '#55575a', '#7e8082', '#a8aaac', '#d1d3d4', '#f7f6ed', '#6d4913', '#9b711e', '#bd962c', '#dfba49', '#eedc85', '#771c28', '#a92535', '#d03c3f', '#ef654b'];
    const colors = palette.map(hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)));
    const assigned = pixels.map((pixel, index) => background[index] ? -1 : colors.reduce((best, color, candidate) => {
      const distance = rgb => rgb.reduce((sum, value, channel) => sum + (value - pixel[channel]) ** 2, 0);
      return distance(color) < distance(colors[best]) ? candidate : best;
    }, 0));
    const groups = [];
    for (let color = 0; color < colors.length; color++) {
      const bytes = Buffer.alloc(Math.ceil(width / 8) * height);
      assigned.forEach((value, index) => { if (value === color) bytes[Math.floor(index / width) * Math.ceil(width / 8) + Math.floor(index % width / 8)] |= 128 >> (index % width % 8); });
      const mask = path.join(temporary, `${color}.pbm`);
      fs.writeFileSync(mask, Buffer.concat([Buffer.from(`P4\n${width} ${height}\n`), bytes]));
      const svg = run('potrace', ['--svg', '--flat', '--turdsize', '3', '--opttolerance', '0.35', '--color', palette[color], '--output', '-', mask]);
      const group = svg.match(/<g[\s\S]*<\/g>/)?.[0];
      if (group) groups.push(group);
    }
    const title = label.replace(/[&<>]/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[value]);
    fs.writeFileSync(destination, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><title>${title}</title>\n${groups.join('\n')}\n</svg>\n`);
    return { width, height, sourceWidth, sourceHeight, crop: [left, top, width, height], clear, palette, method: 'sips-bmp+potrace-1.16-color-v1', tolerance: 0.35, turdsize: 3 };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const [source, output, options] = process.argv.slice(2);
  if (!source || !output) throw new Error('Usage: node scripts/artwork/trace-emblem.mjs source output.svg [options.json]');
  console.log(JSON.stringify(traceEmblem(source, output, options ? JSON.parse(fs.readFileSync(options, 'utf8')) : {})));
}
