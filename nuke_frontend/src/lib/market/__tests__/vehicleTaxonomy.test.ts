import { describe, expect, it } from 'vitest';
import { resolveMarketCohortShortcuts, resolveVehicleIdentityMarks } from '../vehicleTaxonomy';

describe('resolveMarketCohortShortcuts', () => {
  it('resolves vetted identity marks and canonical SERIES / TRIM / BODY STYLE facets for major enthusiast queries', () => {
    expect(resolveMarketCohortShortcuts('c')).toEqual([]);

    const representativeQueries: Array<{
      query: string;
      expectedMake: string;
      expectedFamily: string;
      expectedAxis: 'series' | 'trim' | 'body';
      expectedFacetSubstring: string;
    }> = [
      { query: 'Squarebody', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'C10' },
      { query: 'C10', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'C10' },
      { query: 'K10', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'K10' },
      { query: '3100', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: '3100' },
      { query: 'Silverado', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'trim', expectedFacetSubstring: 'Silverado' },
      { query: 'Cheyenne', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'trim', expectedFacetSubstring: 'Cheyenne' },
      { query: 'Stepside', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'body', expectedFacetSubstring: 'Stepside' },
      { query: 'Fleetside', expectedMake: 'Chevrolet', expectedFamily: 'Pickup', expectedAxis: 'body', expectedFacetSubstring: 'Fleetside' },
      { query: 'FJ40', expectedMake: 'Toyota', expectedFamily: 'Land Cruiser', expectedAxis: 'series', expectedFacetSubstring: 'FJ40' },
      { query: 'FJ60', expectedMake: 'Toyota', expectedFamily: 'Land Cruiser', expectedAxis: 'series', expectedFacetSubstring: 'FJ60' },
      { query: 'FJ80', expectedMake: 'Toyota', expectedFamily: 'Land Cruiser', expectedAxis: 'series', expectedFacetSubstring: 'FJ80' },
      { query: '993', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: '911 Carrera' },
      { query: '992', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: '911 Carrera' },
      { query: 'GT3 RS', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: 'GT3 RS' },
      { query: 'GT3', expectedMake: 'Porsche', expectedFamily: '911', expectedAxis: 'series', expectedFacetSubstring: 'GT3' },
      { query: 'Z06', expectedMake: 'Chevrolet', expectedFamily: 'Corvette', expectedAxis: 'series', expectedFacetSubstring: 'Z06' },
      { query: 'ZR1', expectedMake: 'Chevrolet', expectedFamily: 'Corvette', expectedAxis: 'series', expectedFacetSubstring: 'ZR1' },
      { query: 'Sting Ray', expectedMake: 'Chevrolet', expectedFamily: 'Corvette', expectedAxis: 'series', expectedFacetSubstring: 'Sting Ray' },
      { query: 'Shelby GT350', expectedMake: 'Ford', expectedFamily: 'Mustang', expectedAxis: 'series', expectedFacetSubstring: 'Shelby GT350' },
      { query: 'Boss 429', expectedMake: 'Ford', expectedFamily: 'Mustang', expectedAxis: 'series', expectedFacetSubstring: 'Boss 429' },
      { query: 'Mach 1', expectedMake: 'Ford', expectedFamily: 'Mustang', expectedAxis: 'series', expectedFacetSubstring: 'Mach 1' },
      { query: 'Gullwing', expectedMake: 'Mercedes-Benz', expectedFamily: 'SL', expectedAxis: 'body', expectedFacetSubstring: 'Gullwing' },
      { query: 'Pagoda', expectedMake: 'Mercedes-Benz', expectedFamily: 'SL', expectedAxis: 'series', expectedFacetSubstring: 'Pagoda' },
      { query: 'E-Type', expectedMake: 'Jaguar', expectedFamily: 'E-Type', expectedAxis: 'series', expectedFacetSubstring: 'E-Type' },
      { query: 'Power Wagon', expectedMake: 'Dodge', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'Power Wagon' },
      { query: 'Cummins', expectedMake: 'Dodge', expectedFamily: 'Pickup', expectedAxis: 'series', expectedFacetSubstring: 'Power Wagon' },
      { query: 'Hemi', expectedMake: 'Dodge', expectedFamily: 'Charger', expectedAxis: 'series', expectedFacetSubstring: '426 Hemi' },
      { query: 'R/T', expectedMake: 'Dodge', expectedFamily: 'Charger', expectedAxis: 'trim', expectedFacetSubstring: 'R/T' },
    ];

    for (const item of representativeQueries) {
      const matches = resolveMarketCohortShortcuts(item.query, 3);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.length).toBeLessThanOrEqual(3);
      const top = matches[0];
      expect(top.make).toBe(item.expectedMake);
      expect(top.family).toBe(item.expectedFamily);
      expect(top.axis).toBe(item.expectedAxis);
      expect(top.facet).toContain(item.expectedFacetSubstring);
      expect(top.svgMarkup).toContain('<svg');
      expect(top.url).toContain(`make=${encodeURIComponent(item.expectedMake)}`);
    }
  });

  it('keeps 911 and Corvette generations distinct and ignores chassis codes inside model years', () => {
    const generationYears: Array<[string, string]> = [
      ['964', '1989–1994'],
      ['993', '1995–1998'],
      ['997', '2005–2012'],
      ['991', '2012–2019'],
      ['992', '2019–2025'],
    ];
    for (const [query, years] of generationYears) {
      const top = resolveMarketCohortShortcuts(query, 3)[0];
      expect(top.make).toBe('Porsche');
      expect(top.yearRangeLabel).toBe(years);
    }

    expect(resolveMarketCohortShortcuts('Porsche 997 GT3', 3)[0].yearRangeLabel).toBe('2005–2012');

    for (const query of ['1991 corvette', '1964 mustang', '1997 f-150']) {
      expect(resolveMarketCohortShortcuts(query, 3).some((s) => s.make === 'Porsche')).toBe(false);
    }

    expect(resolveMarketCohortShortcuts('Stingray', 3).some((s) => s.facet === 'Sting Ray (C2)')).toBe(false);
  });

  it('does not match a chassis code inside a vetted mark year range', () => {
    expect(resolveMarketCohortShortcuts('964', 3).some((s) => s.make === 'Ford')).toBe(false);
    expect(resolveMarketCohortShortcuts('Stingray', 3).some((s) => s.facet.toLowerCase().includes('stingray') || s.subLabel.includes('Stingray'))).toBe(true);
  });
});

describe('resolveVehicleIdentityMarks', () => {
  it('resolves vetted era/trim SVG identity marks for individual vehicles', () => {
    const squarebodyMarks = resolveVehicleIdentityMarks({
      brand: 'Chevrolet',
      family: 'C10 Silverado',
      year: 1978,
      seriesCode: 'C10',
      trimPackage: 'Silverado',
      bodyStyle: 'Fleetside',
    });
    expect(squarebodyMarks[0]?.id).toBe('chevy-silverado-10-75-80');
    expect(squarebodyMarks[0].svgMarkup).toContain('<svg');
    expect(squarebodyMarks[0].provenanceNote).toContain('Silverado 10');

    const corvetteMarks = resolveVehicleIdentityMarks({
      brand: 'Chevrolet',
      family: 'Corvette Sting Ray',
      year: 1965,
      seriesCode: 'Sting Ray',
    });
    expect(corvetteMarks[0]?.id).toBe('corvette-c2-sting-ray-63-67');

    const gtoMarks = resolveVehicleIdentityMarks({
      brand: 'Pontiac',
      family: 'GTO Judge',
      year: 1969,
    });
    expect(gtoMarks[0]?.id).toBe('pontiac-gto-trans-am-64-81');
  });
});
