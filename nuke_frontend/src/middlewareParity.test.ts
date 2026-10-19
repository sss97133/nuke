// Branch previews deploy from the repository root and production from nuke_frontend/; both must run one middleware.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.resolve(here, p), 'utf8');
const matcher = (src: string) => {
  const m = /export const config = \{\s*matcher:\s*(\[[\s\S]*?\])\s*,?\s*\};/.exec(src);
  if (!m) throw new Error('no literal matcher');
  return JSON.parse(m[1].replace(/'/g, '"').replace(/,\s*\]/, ']').replace(/\s+/g, ' '));
};

describe('middleware parity', () => {
  const root = read('../../middleware.ts');
  const frontend = read('../middleware.ts');

  it('the root middleware re-exports the frontend implementation and holds no logic of its own', () => {
    expect(root).toContain("export { default } from './nuke_frontend/middleware';");
    expect(root).not.toMatch(/function |fetch\(/);
  });

  it('both files declare the same literal matcher', () => {
    expect(matcher(root)).toEqual(matcher(frontend));
    expect(matcher(root)).toContain('/jobs/:path*');
  });
});
