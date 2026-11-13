import { describe, expect, it } from 'vitest';
import { PAINTS, SITE_THEME, themeVars, vehicleTheme } from './vehicleTheme';

describe('vehicleTheme', () => {
  it('a recorded paint sets the accent; the era sets the motif', () => {
    const t = vehicleTheme({ make: 'Pontiac', year: 1973, color: 'Buccaneer Red' });
    expect(t.key).toBe('pontiac-75');
    expect(t.accent).toBe('#ef1707');
    expect(t.paint?.source).toMatch(/^https:\/\//);
    expect(t.motif).toBe('hood-bars');
    expect(t.display).toBe('block');
    expect(vehicleTheme({ make: 'PONTIAC', year: '1974', paint_code: '75' }).accent).toBe('#ef1707');
  });

  it('no recorded paint means no colour is guessed: era motif only, site accent', () => {
    const t = vehicleTheme({ make: 'Pontiac', year: 1973, color: null });
    expect(t.accent).toBeNull();
    expect(t.motif).toBe('hood-bars');
    expect(themeVars(t)).toEqual({});
  });

  it('a paint outside its years, a wrong make, or an unknown make falls back', () => {
    expect(vehicleTheme({ make: 'Pontiac', year: 1969, color: 'Buccaneer Red' }).accent).toBeNull();
    expect(vehicleTheme({ make: 'Chevrolet', year: 1973, color: 'Buccaneer Red' }).accent).toBeNull();
    expect(vehicleTheme({ make: 'Zil', year: 1973, color: 'Buccaneer Red' })).toEqual(SITE_THEME);
    expect(vehicleTheme(null)).toEqual(SITE_THEME);
  });

  it('themeVars emits the kit tokens, with the dim form derived from the accent', () => {
    const vars = themeVars(vehicleTheme({ make: 'Pontiac', year: 1973, color: 'Buccaneer Red' }));
    expect(vars['--accent']).toBe('#ef1707');
    expect(vars['--accent-dim']).toBe('rgba(239, 23, 7, 0.12)');
    expect(vars['--accent-rgb']).toBe('239, 23, 7');
    expect(vars['--border-focus']).toBe('#ef1707');
  });

  it('every paint row carries a source', () => {
    for (const p of PAINTS) expect(p.source).toMatch(/^https:\/\//);
  });
});
