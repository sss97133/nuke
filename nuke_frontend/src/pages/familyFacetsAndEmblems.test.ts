import { describe, expect, it } from 'vitest';
import {
  buildFacetNodes,
  classifyVehicleFacets,
  consolidateBrandPickupFamilies,
  isPickupFamilyLabel,
  resolveTileBadgeSvg,
  resolveVettedIdentityMarks,
} from './familyFacetsAndEmblems';
import { filterSalesBySubModel, matchesSaleSubModel } from './market/FamilySalesChart';
import type { TreemapNode } from './HomePage';

describe('familyFacetsAndEmblems', () => {
  it('detects pickup umbrella families across Chevrolet, GMC, and Ford series labels', () => {
    expect(isPickupFamilyLabel('Pickup')).toBe(true);
    expect(isPickupFamilyLabel('C10')).toBe(true);
    expect(isPickupFamilyLabel('K20')).toBe(true);
    expect(isPickupFamilyLabel('3100')).toBe(true);
    expect(isPickupFamilyLabel('F-150')).toBe(true);
    expect(isPickupFamilyLabel('Mustang')).toBe(false);
  });

  it('classifies Chevrolet Squarebody series, trim packages, and body styles orthogonally', () => {
    const cheyenneSuper = classifyVehicleFacets(
      'Chevrolet',
      'Pickup',
      'K10 Cheyenne Super Custom Pickup',
      1974,
    );
    expect(cheyenneSuper.series).toBe('K10 (1/2-Ton 4x4)');
    expect(cheyenneSuper.trim).toBe('Cheyenne Super');
    expect(cheyenneSuper.body).toBe('Standard Cab Pickup');

    const silveradoStepside = classifyVehicleFacets(
      'Chevrolet',
      'Pickup',
      'C10 Silverado Stepside Short Bed',
      1978,
    );
    expect(silveradoStepside.series).toBe('C10 (1/2-Ton 2WD)');
    expect(silveradoStepside.trim).toBe('Silverado');
    expect(silveradoStepside.body).toBe('Stepside / Flareside');

    const advanceDesign = classifyVehicleFacets(
      'Chevrolet',
      'Pickup',
      '3100 5-Window Pickup',
      1953,
    );
    expect(advanceDesign.series).toBe('3100 (1/2-Ton)');
  });

  it('classifies Ford Mustang Coupe, Fastback, and Convertible body styles and performance series', () => {
    const boss429 = classifyVehicleFacets('Ford', 'Mustang', 'Mustang Boss 429 Fastback', 1969);
    expect(boss429.series).toBe('Boss 429');
    expect(boss429.body).toBe('Fastback');

    const gt500Coupe = classifyVehicleFacets('Ford', 'Mustang', 'Mustang Shelby GT500 Coupe', 1968);
    expect(gt500Coupe.series).toBe('Shelby GT500');
    expect(gt500Coupe.body).toBe('Coupe / Hardtop');

    const gtConv = classifyVehicleFacets('Ford', 'Mustang', 'Mustang GT Convertible', 1966);
    expect(gtConv.series).toBe('Mustang GT');
    expect(gtConv.body).toBe('Convertible / Cabriolet');
  });

  it('classifies Corvette 1963 Split-Window vs Roadster vs Targa/T-Top', () => {
    const splitWindow = classifyVehicleFacets('Chevrolet', 'Corvette', 'Corvette Sting Ray Coupe', 1963);
    expect(splitWindow.series).toBe('Sting Ray (C2)');
    expect(splitWindow.body).toBe('Split-Window Coupe');

    const c3Ttop = classifyVehicleFacets('Chevrolet', 'Corvette', 'Corvette Stingray T-Top', 1971);
    expect(c3Ttop.series).toBe('Stingray');
    expect(c3Ttop.body).toBe('Targa / T-Top');
  });

  it('re-keys fragmented pickup sub-models into unified Series, Trim, and Body Style treemap nodes', () => {
    const rawModels: TreemapNode[] = [
      { name: 'C10', count: 1157, value: 47_520_906, usd: 47_520_906, sold_12m: 220, sold_prior_12m: 195 },
      { name: 'C10 Custom Pickup', count: 365, value: 21_747_554, usd: 21_747_554, sold_12m: 80, sold_prior_12m: 70 },
      { name: 'C-10 PICKUP', count: 54, value: 1_325_340, usd: 1_325_340, sold_12m: 12, sold_prior_12m: 10 },
      { name: 'K10 Cheyenne Super Custom Pickup', count: 11, value: 1_770_500, usd: 1_770_500, sold_12m: 4, sold_prior_12m: 3 },
      { name: '3100 Pickup', count: 382, value: 14_842_279, usd: 14_842_279, sold_12m: 75, sold_prior_12m: 68 },
    ];

    const seriesNodes = buildFacetNodes('series', 'Chevrolet', 'Pickup', rawModels, null);
    expect(seriesNodes).not.toBeNull();
    const c10Bucket = seriesNodes!.find((n) => n.name === 'C10 (1/2-Ton 2WD)');
    expect(c10Bucket).toBeDefined();
    // Consolidates 'C10', 'C10 Custom Pickup', and 'C-10 PICKUP' into one unified C10 series tile!
    expect(c10Bucket!.count).toBe(1157 + 365 + 54);
    expect(c10Bucket!.usd).toBe(47_520_906 + 21_747_554 + 1_325_340);
    expect(c10Bucket!.sold_12m).toBe(220 + 80 + 12);
    expect(c10Bucket!.facetAxis).toBe('series');
    expect(c10Bucket!.familySharePct).toBeCloseTo(((1157 + 365 + 54) / (1157 + 365 + 54 + 11 + 382)) * 100, 1);
    expect(c10Bucket!.median_price).toBe(Math.round((47_520_906 + 21_747_554 + 1_325_340) / (1157 + 365 + 54)));

    const trimNodes = buildFacetNodes('trim', 'Chevrolet', 'Pickup', rawModels, null);
    const cheyenneSuperBucket = trimNodes!.find((n) => n.name === 'Cheyenne Super');
    expect(cheyenneSuperBucket).toBeDefined();
    expect(cheyenneSuperBucket!.count).toBe(11);
    expect(cheyenneSuperBucket!.facetAxis).toBe('trim');
    expect(cheyenneSuperBucket!.familySharePct).toBeCloseTo((11 / (1157 + 365 + 54 + 11 + 382)) * 100, 1);
  });

  it('resolves period-correct Squarebody 1973–1974 vs 1975–1980 vs 1981–1987 emblems without cross-era contamination', () => {
    // 1974 Squarebody: Cheyenne Super is valid; Silverado trim badge (1975+) must NOT appear!
    const marks1974 = resolveVettedIdentityMarks({
      make: 'Chevrolet',
      familyLabel: 'Pickup',
      year: 1974,
    });
    const labels1974 = marks1974.map((m) => m.id);
    expect(labels1974).toContain('chevy-bowtie-1973-1987');
    expect(labels1974).toContain('chevy-cheyenne-super-10-73-74');
    expect(labels1974).not.toContain('chevy-silverado-10-75-80');
    expect(labels1974).not.toContain('chevy-bowtie-2000-2035');

    // 1978 Round-Eye Squarebody: Silverado 10 ('75–'80) and Scottsdale 10 ('75–'87) appear; Cheyenne Super ('73–'74) does NOT
    const marks1978 = resolveVettedIdentityMarks({
      make: 'Chevrolet',
      familyLabel: 'Pickup',
      year: 1978,
    });
    const labels1978 = marks1978.map((m) => m.id);
    expect(labels1978).toContain('chevy-silverado-10-75-80');
    expect(labels1978).toContain('chevy-scottsdale-10-75-87');
    expect(labels1978).not.toContain('chevy-cheyenne-super-10-73-74');
    expect(labels1978).not.toContain('chevy-silverado-10-81-87');

    // 1984 Slant-Nose Squarebody: 1981–1987 brushed-aluminum Silverado 10 badge appears
    const marks1984 = resolveVettedIdentityMarks({
      make: 'Chevrolet',
      familyLabel: 'Pickup',
      year: 1984,
    });
    expect(marks1984.map((m) => m.id)).toContain('chevy-silverado-10-81-87');

    // GMC 1973–1974 two-digit "SIERRA 15" vs 1975–1987 four-digit "SIERRA GRANDE 1500"
    const gmc1973 = resolveVettedIdentityMarks({
      make: 'GMC',
      familyLabel: 'Pickup',
      year: 1973,
    });
    expect(gmc1973.map((m) => m.id)).toContain('gmc-sierra-15-73-74');
    expect(gmc1973.map((m) => m.id)).not.toContain('gmc-sierra-grande-1500-75-87');

    const gmc1979 = resolveVettedIdentityMarks({
      make: 'GMC',
      familyLabel: 'Pickup',
      year: 1979,
    });
    expect(gmc1979.map((m) => m.id)).toContain('gmc-sierra-grande-1500-75-87');
    expect(gmc1979.map((m) => m.id)).not.toContain('gmc-sierra-15-73-74');
  });

  it('consolidates fragmented brand pickup series into one unified Pickup tile when groupPickups is true', () => {
    const chevyFamilies: TreemapNode[] = [
      { name: 'Corvette', familyKey: 'corvette-id', count: 17002, value: 1_306_368_917, usd: 1_306_368_917, sold_12m: 2100, sold_prior_12m: 1950 },
      { name: 'C10', familyKey: 'c10-id', count: 2705, value: 107_725_999, usd: 107_725_999, sold_12m: 410, sold_prior_12m: 380 },
      { name: '3100', familyKey: '3100-id', count: 1088, value: 55_535_961, usd: 55_535_961, sold_12m: 160, sold_prior_12m: 140 },
      { name: 'Pickup', familyKey: '00000000-0000-4000-b000-000000001928', count: 1191, value: 46_224_390, usd: 46_224_390, sold_12m: 190, sold_prior_12m: 175 },
      { name: 'K10', familyKey: 'k10-id', count: 725, value: 35_008_107, usd: 35_008_107, sold_12m: 115, sold_prior_12m: 100 },
    ];

    const unified = consolidateBrandPickupFamilies('Chevrolet', chevyFamilies, true);
    expect(unified).toHaveLength(2);
    const pickupTile = unified!.find((f) => f.name === 'Pickup');
    expect(pickupTile).toBeDefined();
    expect(pickupTile!.familyKey).toBe('00000000-0000-4000-b000-000000001928');
    expect(pickupTile!.count).toBe(2705 + 1088 + 1191 + 725);
    expect(pickupTile!.usd).toBe(107_725_999 + 55_535_961 + 46_224_390 + 35_008_107);
    expect(pickupTile!.sold_12m).toBe(410 + 160 + 190 + 115);

    const split = consolidateBrandPickupFamilies('Chevrolet', chevyFamilies, false);
    expect(split).toHaveLength(5);
  });

  it('partitions enriched salesData (with trim/body/title suffix) into Series, Trim, and Body Style buckets and attaches vetted SVG badges', () => {
    const baseModels: TreemapNode[] = [
      { name: 'C10', count: 500, value: 20_000_000, usd: 20_000_000 },
    ];
    const enrichedSales = Array.from({ length: 12 }, (_, idx) => ({
      vehicle_id: `v-${idx}`,
      sale_date: '2026-06-15',
      usd: idx < 6 ? 45_000 : 38_000,
      source: 'Bring a Trailer',
      year: idx < 6 ? 1978 : 1974,
      model:
        idx < 6
          ? 'C10 · 1978 Chevrolet C10 Silverado Stepside Short Bed'
          : 'K10 · 1974 Chevrolet K10 Cheyenne Super Fleetside',
    }));

    const trimBuckets = buildFacetNodes('trim', 'Chevrolet', 'Pickup', baseModels, enrichedSales);
    expect(trimBuckets).not.toBeNull();
    const silveradoNode = trimBuckets!.find((n) => n.name === 'Silverado');
    const cheyenneSuperNode = trimBuckets!.find((n) => n.name === 'Cheyenne Super');
    expect(silveradoNode?.count).toBe(6);
    expect(silveradoNode?.badgeSvg).toContain('Silverado');
    expect(cheyenneSuperNode?.count).toBe(6);
    expect(cheyenneSuperNode?.badgeSvg).toContain('CHEYENNE');

    const bodyBuckets = buildFacetNodes('body', 'Chevrolet', 'Pickup', baseModels, enrichedSales);
    expect(bodyBuckets!.find((n) => n.name === 'Stepside / Flareside')?.count).toBe(6);
    expect(bodyBuckets!.find((n) => n.name === 'Fleetside / Styleside')?.count).toBe(6);

    // Tri-Five Bel Air, Chevelle SS, Camaro Z/28, and Bronco U13/U14/U15 classification
    expect(classifyVehicleFacets('Chevrolet', 'Bel Air', 'Bel Air 2-Door Hardtop Sport Coupe', 1957)).toEqual({
      series: 'Bel Air (2400 Series)',
      trim: null,
      body: 'Coupe / Hardtop',
    });
    expect(classifyVehicleFacets('Chevrolet', 'Chevelle', 'Chevelle SS 454 LS6 Convertible', 1970)).toEqual({
      series: 'SS 454',
      trim: 'SS (Super Sport)',
      body: 'Convertible / Cabriolet',
    });
    expect(classifyVehicleFacets('Ford', 'Bronco', 'Bronco U14 Half-Cab Pickup', 1968).series).toBe('U14 Half-Cab Pickup');
    expect(resolveTileBadgeSvg('Porsche', '911', 'Targa / T-Top')).toContain('targa');
  });

  it('filters FamilySalesChart dots and cohorts by orthogonal Series, Trim, and Body Style facets as well as Dodge/BMW/Mercedes/Ferrari taxonomy', () => {
    const sales = [
      { id: '1', year: 1978, model: 'C10 · 1978 Chevrolet C10 Silverado Stepside Short Bed' },
      { id: '2', year: 1974, model: 'K10 · 1974 Chevrolet K10 Cheyenne Super Fleetside' },
      { id: '3', year: 1967, model: 'Mustang · 1967 Ford Mustang Shelby GT500 Fastback' },
    ];

    expect(
      matchesSaleSubModel(sales[0].model, 'Silverado', { brand: 'Chevrolet', family: 'Pickup', year: 1978 }),
    ).toBe(true);
    expect(
      matchesSaleSubModel(sales[0].model, 'Stepside / Flareside', { brand: 'Chevrolet', family: 'Pickup', year: 1978 }),
    ).toBe(true);
    expect(
      matchesSaleSubModel(sales[0].model, 'C10 (1/2-Ton 2WD)', { brand: 'Chevrolet', family: 'Pickup', year: 1978 }),
    ).toBe(true);
    expect(
      matchesSaleSubModel(sales[1].model, 'Silverado', { brand: 'Chevrolet', family: 'Pickup', year: 1974 }),
    ).toBe(false);

    const silveradoSales = filterSalesBySubModel(sales, 'Silverado', { brand: 'Chevrolet', family: 'Pickup' });
    expect(silveradoSales.map((s) => s.id)).toEqual(['1']);

    // Dodge Power Wagon & Charger R/T, BMW E30 M3, Mercedes 300SL Gullwing, Ferrari GTS
    expect(classifyVehicleFacets('Dodge', 'Pickup', 'WM300 Power Wagon 4x4', 1962).series).toBe('Power Wagon WM300');
    expect(classifyVehicleFacets('Dodge', 'Charger', 'Charger R/T 426 Hemi Hardtop', 1968)).toEqual({
      series: 'R/T (Road/Track)',
      trim: 'R/T (Road/Track)',
      body: 'Coupe / Hardtop',
    });
    expect(classifyVehicleFacets('BMW', 'M3', 'M3 Sport Evolution Coupe', 1990)).toEqual({
      series: 'E30 M3',
      trim: 'M-Power',
      body: 'Coupe / Hardtop',
    });
    expect(classifyVehicleFacets('Mercedes-Benz', 'SL', '300SL Gullwing Coupe', 1955)).toEqual({
      series: '300SL (W198)',
      trim: null,
      body: 'Gullwing Coupe',
    });
    expect(classifyVehicleFacets('Ferrari', '355', 'F355 GTS Manual', 1997).body).toBe('Roadster / Speedster');

    // Toyota Land Cruiser J40/J55/J60/J80, K5 Blazer, Pontiac GTO Judge & Trans Am, Porsche 356/Carrera RS, Jaguar E-Type
    expect(classifyVehicleFacets('Toyota', 'Land Cruiser', 'FJ40 Land Cruiser Hardtop', 1978)).toEqual({
      series: 'FJ40 / BJ40 (J40)',
      trim: null,
      body: 'Coupe / Hardtop',
    });
    expect(classifyVehicleFacets('Toyota', 'Land Cruiser', 'FJ62 Land Cruiser Wagon', 1989).series).toBe(
      'FJ60 / FJ62 (J60 Wagon)',
    );
    expect(classifyVehicleFacets('Chevrolet', 'Blazer', 'K5 Blazer Cheyenne 4x4', 1972)).toEqual({
      series: 'K5 Blazer (Full-Size)',
      trim: 'Cheyenne',
      body: null,
    });
    expect(classifyVehicleFacets('Pontiac', 'GTO', 'GTO The Judge Convertible', 1969)).toEqual({
      series: 'GTO The Judge',
      trim: null,
      body: 'Convertible / Cabriolet',
    });
    expect(classifyVehicleFacets('Porsche', '356', '356A 1600 Speedster', 1957)).toEqual({
      series: '356A (T1 / T2)',
      trim: null,
      body: 'Roadster / Speedster',
    });
    expect(classifyVehicleFacets('Jaguar', 'E-Type', 'E-Type Series 1 4.2 Roadster', 1966)).toEqual({
      series: 'E-Type Series 1',
      trim: null,
      body: 'Roadster / Speedster',
    });
    expect(resolveTileBadgeSvg('Toyota', 'Land Cruiser', 'FJ40 / BJ40 (J40)', 1978)).toContain('LAND CRUISER');
    expect(resolveTileBadgeSvg('Chevrolet', 'Blazer', 'K5 Blazer (Full-Size)', 1972)).toContain('BLAZER');
  });
});
