import { describe, expect, it } from 'vitest';
import {
  boostAndFilterVehicleSearchResults,
  extractQueryFacets,
  scoreVehicleFacetMatch,
} from './HeaderSearch';

type Candidate = { id: string; type: string; title: string; relevance_score: number; metadata: Record<string, any> };

describe('HeaderSearch facet query boosting and filtering', () => {
  it('extracts Series, Trim, and Body Style facet intent from queries without forcing default pickup body', () => {
    const cheyenneSuper = extractQueryFacets('Cheyenne Super');
    expect(cheyenneSuper.hasFacetIntent).toBe(true);
    expect(cheyenneSuper.trim).toBe('Cheyenne Super');
    expect(cheyenneSuper.series).toBeNull();
    expect(cheyenneSuper.body).toBeNull();
    expect(cheyenneSuper.requestedAxes).toEqual(['trim']);

    const stepside = extractQueryFacets('Stepside');
    expect(stepside.hasFacetIntent).toBe(true);
    expect(stepside.body).toBe('Stepside / Flareside');
    expect(stepside.requestedAxes).toEqual(['body']);

    const splitWindow = extractQueryFacets('Split-Window');
    expect(splitWindow.hasFacetIntent).toBe(true);
    expect(splitWindow.body).toBe('Split-Window Coupe');
    expect(splitWindow.requestedAxes).toEqual(['body']);

    const fastback = extractQueryFacets('Fastback');
    expect(fastback.hasFacetIntent).toBe(true);
    expect(fastback.body).toBe('Fastback');
    expect(fastback.requestedAxes).toEqual(['body']);

    const sierraClassic = extractQueryFacets('Sierra Classic');
    expect(sierraClassic.hasFacetIntent).toBe(true);
    expect(sierraClassic.trim).toBe('Sierra Classic');
    expect(sierraClassic.requestedAxes).toEqual(['trim']);

    // General model queries without a specific series/trim/body token should not force fallback facets
    const generalMustang = extractQueryFacets('1969 Ford Mustang');
    expect(generalMustang.hasFacetIntent).toBe(false);
    expect(generalMustang.requestedAxes).toEqual([]);
  });

  it('boosts and filters local/RPC vehicle search results for "Cheyenne Super" and excludes base "Cheyenne" or "Silverado"', () => {
    const candidates: Candidate[] = [
      {
        id: 'v-cheyenne-base',
        type: 'vehicle',
        title: '1973 Chevrolet K10 Cheyenne Pickup',
        relevance_score: 0.75,
        metadata: { year: 1973, make: 'Chevrolet', model: 'K10 Cheyenne Pickup' },
      },
      {
        id: 'v-silverado',
        type: 'vehicle',
        title: '1978 Chevrolet C10 Silverado Fleetside',
        relevance_score: 0.8,
        metadata: { year: 1978, make: 'Chevrolet', model: 'C10 Silverado' },
      },
      {
        id: 'v-cheyenne-super',
        type: 'vehicle',
        title: '1974 Chevrolet K10 Cheyenne Super Stepside',
        relevance_score: 0.5,
        metadata: { year: 1974, make: 'Chevrolet', model: 'K10 Cheyenne Super Stepside' },
      },
    ];

    const filtered = boostAndFilterVehicleSearchResults('Cheyenne Super', candidates);
    expect(filtered.map((r) => r.id)).toEqual(['v-cheyenne-super']);
    expect(filtered[0].relevance_score).toBeGreaterThan(0.9);
    expect(filtered[0].metadata.trim).toBe('Cheyenne Super');
    expect(filtered[0].metadata.matched_facets).toEqual(['trim']);

    // When filterNonMatchingVehicles is false, all rows remain but Cheyenne Super is boosted to #1
    const rankedOnly = boostAndFilterVehicleSearchResults('Cheyenne Super', candidates, {
      filterNonMatchingVehicles: false,
    });
    expect(rankedOnly.map((r) => r.id)[0]).toBe('v-cheyenne-super');
    expect(rankedOnly[0].relevance_score).toBeGreaterThan(rankedOnly[1].relevance_score);
  });

  it('matches and boosts "Split-Window" against a 1963 Corvette Sting Ray Coupe even when the literal token is absent from the title', () => {
    const corvettes: Candidate[] = [
      {
        id: 'c2-1963-convertible',
        type: 'vehicle',
        title: '1963 Chevrolet Corvette Sting Ray Convertible',
        relevance_score: 0.7,
        metadata: { year: 1963, make: 'Chevrolet', model: 'Corvette Sting Ray Convertible' },
      },
      {
        id: 'c2-1965-coupe',
        type: 'vehicle',
        title: '1965 Chevrolet Corvette Sting Ray Coupe',
        relevance_score: 0.75,
        metadata: { year: 1965, make: 'Chevrolet', model: 'Corvette Sting Ray Coupe' },
      },
      {
        id: 'c2-1963-coupe',
        type: 'vehicle',
        title: '1963 Chevrolet Corvette Sting Ray Coupe',
        relevance_score: 0.45,
        metadata: { year: 1963, make: 'Chevrolet', model: 'Corvette Sting Ray Coupe' },
      },
    ];

    const filtered = boostAndFilterVehicleSearchResults('Split-Window', corvettes);
    expect(filtered.map((r) => r.id)).toEqual(['c2-1963-coupe']);
    expect(filtered[0].metadata.body_style).toBe('Split-Window Coupe');
    expect(filtered[0].metadata.matched_facets).toEqual(['body']);
  });

  it('boosts and filters "Stepside", "Fastback", and "Sierra Classic" across synonym body/trim descriptors', () => {
    const pickupCandidates = [
      {
        id: 'fleetside-1',
        type: 'vehicle',
        title: '1978 Chevrolet C10 Silverado Fleetside',
        relevance_score: 0.7,
      },
      {
        id: 'stepside-1',
        type: 'vehicle',
        title: '1978 Chevrolet C10 Silverado Stepside',
        relevance_score: 0.5,
      },
      {
        id: 'flareside-1',
        type: 'vehicle',
        title: '1956 Ford F-100 Flareside Pickup',
        relevance_score: 0.45,
      },
    ];

    const stepsideResults = boostAndFilterVehicleSearchResults('Stepside', pickupCandidates);
    expect(stepsideResults.map((r) => r.id)).toEqual(['stepside-1', 'flareside-1']);

    const mustangCandidates = [
      {
        id: 'mustang-coupe',
        type: 'vehicle',
        title: '1966 Ford Mustang GT Coupe',
        relevance_score: 0.8,
      },
      {
        id: 'mustang-fastback',
        type: 'vehicle',
        title: '1969 Ford Mustang Mach 1 Fastback',
        relevance_score: 0.5,
      },
      {
        id: 'mustang-sportsroof',
        type: 'vehicle',
        title: '1970 Ford Mustang Boss 302 SportsRoof',
        relevance_score: 0.45,
      },
    ];

    const fastbackResults = boostAndFilterVehicleSearchResults('Fastback', mustangCandidates);
    expect(fastbackResults.map((r) => r.id)).toEqual(['mustang-fastback', 'mustang-sportsroof']);

    const gmcCandidates = [
      {
        id: 'gmc-sierra-grande',
        type: 'vehicle',
        title: '1977 GMC K1500 Sierra Grande Pickup',
        relevance_score: 0.75,
      },
      {
        id: 'gmc-sierra-classic',
        type: 'vehicle',
        title: '1978 GMC C1500 Sierra Classic Short Bed',
        relevance_score: 0.4,
      },
    ];

    const sierraClassicResults = boostAndFilterVehicleSearchResults('Sierra Classic', gmcCandidates);
    expect(sierraClassicResults.map((r) => r.id)).toEqual(['gmc-sierra-classic']);
  });

  it('preserves pinned market_scope tag at index 0 and ranks multi-facet matches above partial matches', () => {
    const mixed = [
      {
        id: 'market_scope:/?tab=market&make=Chevrolet',
        type: 'tag',
        title: '1973 Chevrolet K10',
        relevance_score: 1,
      },
      {
        id: 'k10-fleetside',
        type: 'vehicle',
        title: '1973 Chevrolet K10 Cheyenne Super Fleetside',
        relevance_score: 0.7,
      },
      {
        id: 'k10-stepside-exact',
        type: 'vehicle',
        title: '1973 Chevrolet K10 Cheyenne Super Stepside',
        relevance_score: 0.5,
      },
    ];

    const boosted = boostAndFilterVehicleSearchResults(
      '1973 Chevrolet K10 Cheyenne Super Stepside',
      mixed,
    );
    expect(boosted.map((r) => r.id)).toEqual([
      'market_scope:/?tab=market&make=Chevrolet',
      'k10-stepside-exact',
    ]);

    const scoreExact = scoreVehicleFacetMatch('1973 Chevrolet K10 Cheyenne Super Stepside', {
      title: '1973 Chevrolet K10 Cheyenne Super Stepside',
    });
    expect(scoreExact.matchesAllQueryFacets).toBe(true);
    expect(scoreExact.matchedAxes).toEqual(['series', 'trim', 'body']);
  });
});
