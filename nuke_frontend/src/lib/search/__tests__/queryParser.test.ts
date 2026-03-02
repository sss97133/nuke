import { describe, it, expect } from 'vitest';
import { parseQuery } from '../queryParser';

describe('parseQuery', () => {
  it('parses single make', () => {
    const r = parseQuery('porsche');
    expect(r.make).toBe('Porsche');
  });

  it('parses make + model', () => {
    const r = parseQuery('porsche 911');
    expect(r.make).toBe('Porsche');
    expect(r.model).toBe('911');
  });

  it('parses year + make + model', () => {
    const r = parseQuery('1973 porsche 911');
    expect(r.yearMin).toBe(1973);
    expect(r.yearMax).toBe(1973);
    expect(r.make).toBe('Porsche');
    expect(r.model).toBe('911');
  });

  it('parses year range', () => {
    const r = parseQuery('1965-1975 ford mustang');
    expect(r.yearMin).toBe(1965);
    expect(r.yearMax).toBe(1975);
    expect(r.make).toBe('Ford');
    expect(r.model).toBe('mustang');
  });

  it('parses price under', () => {
    const r = parseQuery('porsche under $50k');
    expect(r.make).toBe('Porsche');
    expect(r.priceMax).toBe(50000);
  });

  it('parses price over', () => {
    const r = parseQuery('ferrari over $100,000');
    expect(r.make).toBe('Ferrari');
    expect(r.priceMin).toBe(100000);
  });

  it('parses price range', () => {
    const r = parseQuery('$20k-$50k porsche');
    expect(r.priceMin).toBe(20000);
    expect(r.priceMax).toBe(50000);
    expect(r.make).toBe('Porsche');
  });

  it('parses color', () => {
    const r = parseQuery('red ferrari');
    expect(r.color).toBe('red');
    expect(r.make).toBe('Ferrari');
  });

  it('resolves make aliases', () => {
    const r = parseQuery('chevy camaro');
    expect(r.make).toBe('Chevrolet');
    expect(r.model).toBe('camaro');
  });

  it('parses body style', () => {
    const r = parseQuery('porsche convertible');
    expect(r.make).toBe('Porsche');
    expect(r.bodyStyle).toBe('convertible');
  });

  it('parses era', () => {
    const r = parseQuery('classic ford');
    expect(r.era).toBe('classic');
    expect(r.make).toBe('Ford');
  });

  it('parses complex query', () => {
    const r = parseQuery('1970 chevy camaro red under $80k');
    expect(r.yearMin).toBe(1970);
    expect(r.make).toBe('Chevrolet');
    expect(r.color).toBe('red');
    expect(r.priceMax).toBe(80000);
  });

  it('handles multi-word makes', () => {
    const r = parseQuery('alfa romeo giulia');
    expect(r.make).toBe('Alfa Romeo');
    expect(r.model).toBe('giulia');
  });

  it('handles unknown input gracefully', () => {
    const r = parseQuery('asdfghjkl');
    expect(r.make).toBeNull();
    expect(r.freeText).toBe('asdfghjkl');
  });

  it('handles empty input', () => {
    const r = parseQuery('');
    expect(r.make).toBeNull();
    expect(r.freeText).toBe('');
  });
});
