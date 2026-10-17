import { describe, expect, it } from 'vitest';
import {
  buildFacetNodes,
  classifyVehicleFacets,
  consolidateBrandPickupFamilies,
  isPickupFamilyLabel,
  resolveVettedIdentityMarks,
} from './familyFacetsAndEmblems';
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

    const trimNodes = buildFacetNodes('trim', 'Chevrolet', 'Pickup', rawModels, null);
    const cheyenneSuperBucket = trimNodes!.find((n) => n.name === 'Cheyenne Super');
    expect(cheyenneSuperBucket).toBeDefined();
    expect(cheyenneSuperBucket!.count).toBe(11);
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
});
