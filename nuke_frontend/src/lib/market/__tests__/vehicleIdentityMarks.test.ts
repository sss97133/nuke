import { describe, expect, it } from 'vitest';
import {
  classifyVehicleFacet,
  resolveVehicleIdentityMark,
  VEHICLE_IDENTITY_MARKS,
  WAVE3_IDENTITY_MARKS,
} from '../vehicleIdentityMarks';

describe('Wave 3 VEHICLE_IDENTITY_MARKS registry & SVG vector geometry', () => {
  it('registers all 18 Wave 3 vetted era/series/trim SVG vector marks with viewBox="0 0 120 36"', () => {
    expect(WAVE3_IDENTITY_MARKS).toHaveLength(18);

    const expectedIds = [
      // Ford Bronco
      'bronco-1st-gen-script-66-77',
      'bronco-xlt-eddie-bauer-78-96',
      'bronco-6th-gen-raptor-21-26',
      // Chevrolet Camaro
      'camaro-1st-gen-z28-rsss-67-69',
      'camaro-2nd-gen-z28-70-81',
      'camaro-3rd-gen-iroc-z-82-92',
      'camaro-4th-6th-gen-ss-zl1-1le-93-24',
      // Pontiac GTO & Firebird Trans Am
      'pontiac-gto-goat-judge-64-74',
      'pontiac-firebird-trans-am-ws6-70-81',
      // Buick & Oldsmobile
      'buick-grand-national-gnx-82-87',
      'oldsmobile-442-w30-64-72',
      // Jeep & International
      'jeep-cj5-cj7-scrambler-55-86',
      'jeep-grand-wagoneer-woodgrain-84-91',
      'jeep-wrangler-rubicon-392-87-26',
      'international-scout-800-scout-ii-61-80',
      // JDM Icons
      'datsun-s30-240z-260z-280z-69-78',
      'nissan-skyline-gtr-r32-r33-r34-r35-89-26',
      'toyota-supra-a70-a80-a90-79-26',
    ];

    for (const id of expectedIds) {
      const mark = VEHICLE_IDENTITY_MARKS.find((m) => m.id === id);
      expect(mark, `Expected Wave 3 mark ${id} in VEHICLE_IDENTITY_MARKS`).toBeDefined();
      expect(mark!.svgMarkup).toContain('viewBox="0 0 120 36"');
      expect(mark!.svgMarkup.startsWith('<svg')).toBe(true);
      expect(mark!.svgMarkup.endsWith('</svg>')).toBe(true);
      expect(mark!.provenanceNote.length).toBeGreaterThan(20);
    }
  });

  it('resolves Ford Bronco 1st Gen (66-77), 2nd-5th Gen XLT/Eddie Bauer (78-96), and 6th Gen Raptor (21-26) marks accurately', () => {
    const gen1 = resolveVehicleIdentityMark('1973 Ford Bronco U15 Sport Wagon', 'U15', 'Sport', 1973);
    expect(gen1?.id).toBe('bronco-1st-gen-script-66-77');
    expect(gen1?.svgMarkup).toContain('Bronco');

    const gen4 = resolveVehicleIdentityMark('1994 Ford Bronco Eddie Bauer XLT 4x4', 'FSB', 'Eddie Bauer', 1994);
    expect(gen4?.id).toBe('bronco-xlt-eddie-bauer-78-96');
    expect(gen4?.svgMarkup).toContain('Eddie Bauer');

    const gen6 = resolveVehicleIdentityMark('2023 Ford Bronco Raptor 4-Door', 'U725', 'Raptor', 2023);
    expect(gen6?.id).toBe('bronco-6th-gen-raptor-21-26');
    expect(gen6?.svgMarkup).toContain('RAPTOR');
  });

  it('resolves Chevrolet Camaro 1st Gen (67-69 Z/28 & RS/SS), 2nd Gen (70-81 Z28), 3rd Gen (82-92 IROC-Z), and 4th-6th Gen (ZL1 1LE)', () => {
    const gen1 = resolveVehicleIdentityMark('1969 Chevrolet Camaro RS/SS Z/28', '1st Gen', 'Z/28', 1969);
    expect(gen1?.id).toBe('camaro-1st-gen-z28-rsss-67-69');
    expect(gen1?.svgMarkup).toContain('Z/28');

    const gen2 = resolveVehicleIdentityMark('1970 Chevrolet Camaro Z28 Split-Bumper', '2nd Gen', 'Z28', 1970);
    expect(gen2?.id).toBe('camaro-2nd-gen-z28-70-81');
    expect(gen2?.svgMarkup).toContain('Z28');

    const gen3 = resolveVehicleIdentityMark('1987 Chevrolet Camaro IROC-Z T-Top Coupe', 'IROC-Z', 'IROC-Z', 1987);
    expect(gen3?.id).toBe('camaro-3rd-gen-iroc-z-82-92');
    expect(gen3?.svgMarkup).toContain('IROC-Z');

    const gen6 = resolveVehicleIdentityMark('2019 Chevrolet Camaro ZL1 1LE', 'ZL1 1LE', 'ZL1 1LE', 2019);
    expect(gen6?.id).toBe('camaro-4th-6th-gen-ss-zl1-1le-93-24');
    expect(gen6?.svgMarkup).toContain('ZL1');
    expect(gen6?.svgMarkup).toContain('1LE');
  });

  it('resolves Pontiac GTO Judge (64-74), Firebird Trans Am WS6 (70-81), Buick GNX (82-87), and Oldsmobile 442 (64-72)', () => {
    const gto = resolveVehicleIdentityMark('1969 Pontiac GTO The Judge Ram Air IV', 'GTO', 'The Judge', 1969);
    expect(gto?.id).toBe('pontiac-gto-goat-judge-64-74');
    expect(gto?.svgMarkup).toContain('The Judge');

    const transAm = resolveVehicleIdentityMark('1977 Pontiac Firebird Trans Am WS6 Special Edition', 'Trans Am', 'Trans Am WS6', 1977);
    expect(transAm?.id).toBe('pontiac-firebird-trans-am-ws6-70-81');
    expect(transAm?.svgMarkup).toContain('WS6');

    const gnx = resolveVehicleIdentityMark('1987 Buick GNX #142 Intercooled Turbo', 'GNX', 'Grand National', 1987);
    expect(gnx?.id).toBe('buick-grand-national-gnx-82-87');
    expect(gnx?.svgMarkup).toContain('3.8 SFI TURBO');

    const olds442 = resolveVehicleIdentityMark('1970 Oldsmobile 442 W-30 Holiday Coupe', '442', 'W-30', 1970);
    expect(olds442?.id).toBe('oldsmobile-442-w30-64-72');
    expect(olds442?.svgMarkup).toContain('442');
    expect(olds442?.svgMarkup).toContain('W-30');
  });

  it('resolves Jeep CJ-7 / Scrambler, Grand Wagoneer (84-91), Wrangler Rubicon 392, and International Scout 800 / Scout II', () => {
    const cj7 = resolveVehicleIdentityMark('1981 Jeep CJ-7 Renegade 4x4', 'CJ-7', 'Renegade', 1981);
    expect(cj7?.id).toBe('jeep-cj5-cj7-scrambler-55-86');
    expect(cj7?.svgMarkup).toContain('CJ-7');

    const wagoneer = resolveVehicleIdentityMark('1989 Jeep Grand Wagoneer SJ 4x4', 'SJ', 'Grand Wagoneer', 1989);
    expect(wagoneer?.id).toBe('jeep-grand-wagoneer-woodgrain-84-91');
    expect(wagoneer?.svgMarkup).toContain('WAGONEER');

    const rubicon392 = resolveVehicleIdentityMark('2022 Jeep Wrangler Unlimited Rubicon 392', 'JL', 'Rubicon 392', 2022);
    expect(rubicon392?.id).toBe('jeep-wrangler-rubicon-392-87-26');
    expect(rubicon392?.svgMarkup).toContain('392 HEMI');

    const scout = resolveVehicleIdentityMark('1978 International Harvester Scout II Rallye', 'Scout II', 'Rallye', 1978);
    expect(scout?.id).toBe('international-scout-800-scout-ii-61-80');
    expect(scout?.svgMarkup).toContain('SCOUT II');
  });

  it('resolves JDM Icons: Datsun S30 240Z/260Z/280Z, Nissan Skyline GT-R (R32/R33/R34/R35), and Toyota Supra (A70/A80/A90)', () => {
    const datsunZ = resolveVehicleIdentityMark('1972 Datsun 240Z HLS30 Fairlady Z', 'S30', 'Fairlady Z', 1972);
    expect(datsunZ?.id).toBe('datsun-s30-240z-260z-280z-69-78');
    expect(datsunZ?.svgMarkup).toContain('240Z · S30');

    const gtr = resolveVehicleIdentityMark('1999 Nissan Skyline GT-R V-Spec BNR34', 'BNR34', 'V-Spec', 1999);
    expect(gtr?.id).toBe('nissan-skyline-gtr-r32-r33-r34-r35-89-26');
    expect(gtr?.svgMarkup).toContain('V-SPEC');

    const supra = resolveVehicleIdentityMark('1994 Toyota Supra Twin Turbo JZA80 Targa', 'JZA80', 'Twin Turbo', 1994);
    expect(supra?.id).toBe('toyota-supra-a70-a80-a90-79-26');
    expect(supra?.svgMarkup).toContain('Supra');
    expect(supra?.svgMarkup).toContain('JZA80');
  });
});

describe('classifyVehicleFacet(title, subModel, trim, bodyStyle) — Wave 3 deterministic facet extraction', () => {
  it('extracts Ford Bronco series (U15, U14, U13, FSB, U725), trims (Eddie Bauer, Raptor, XLT), and bodyStyles (2-Door Wagon, Soft Top 4x4)', () => {
    const earlyBronco = classifyVehicleFacet(
      '1974 Ford Bronco Ranger U15 4x4',
      'U15',
      'Ranger',
      '2-Door Wagon',
    );
    expect(earlyBronco.series).toBe('U15');
    expect(earlyBronco.bodyStyle).toBe('2-Door Wagon');

    const eddieBauer = classifyVehicleFacet(
      '1995 Ford Bronco Eddie Bauer 5.8L 4x4',
      'Bronco',
      'Eddie Bauer',
      '2-Door Wagon',
    );
    expect(eddieBauer.series).toBe('FSB');
    expect(eddieBauer.trim).toBe('Eddie Bauer');
    expect(eddieBauer.bodyStyle).toBe('2-Door Wagon');

    const broncoRaptor = classifyVehicleFacet(
      '2023 Ford Bronco Raptor Soft Top 4x4',
      'U725',
      'Raptor',
      'Soft Top 4x4',
    );
    expect(broncoRaptor.series).toBe('U725');
    expect(broncoRaptor.trim).toBe('Raptor');
    expect(broncoRaptor.bodyStyle).toBe('Soft Top 4x4');
  });

  it('extracts Chevrolet Camaro series (IROC-Z, 1st Gen, 2nd Gen, ZL1 1LE), trims (Z/28, SS 396, ZL1 1LE), and bodyStyles (2-Door Hardtop, T-Top Coupe)', () => {
    const camaroZ28 = classifyVehicleFacet(
      '1969 Chevrolet Camaro Z/28 302 4-Speed',
      'Camaro',
      'Z/28',
      '2-Door Hardtop',
    );
    expect(camaroZ28.trim).toBe('Z/28');
    expect(camaroZ28.bodyStyle).toBe('2-Door Hardtop');

    const camaroSS396 = classifyVehicleFacet(
      '1968 Chevrolet Camaro RS/SS 396 L78 Sport Coupe',
      '1st Gen',
      'SS 396',
      '2-Door Hardtop',
    );
    expect(camaroSS396.trim).toBe('SS 396');
    expect(camaroSS396.bodyStyle).toBe('2-Door Hardtop');

    const camaroIroc = classifyVehicleFacet(
      '1987 Chevrolet Camaro IROC-Z 5.7L TPI',
      'IROC-Z',
      'IROC-Z',
      'T-Top Coupe',
    );
    expect(camaroIroc.series).toBe('IROC-Z');
    expect(camaroIroc.trim).toBe('IROC-Z');
    expect(camaroIroc.bodyStyle).toBe('T-Top Coupe');
  });

  it('extracts Pontiac GTO (The Judge / 2-Door Hardtop) and Firebird Trans Am (Trans Am WS6 / T-Top Coupe)', () => {
    const gtoJudge = classifyVehicleFacet(
      '1969 Pontiac GTO The Judge Ram Air III',
      'GTO',
      'The Judge',
      '2-Door Hardtop',
    );
    expect(gtoJudge.series).toBe('GTO');
    expect(gtoJudge.trim).toBe('The Judge');
    expect(gtoJudge.bodyStyle).toBe('2-Door Hardtop');

    const transAmWs6 = classifyVehicleFacet(
      '1979 Pontiac Firebird Trans Am WS6 T-Top Coupe',
      'Trans Am',
      'Trans Am WS6',
      'T-Top Coupe',
    );
    expect(transAmWs6.series).toBe('Trans Am');
    expect(transAmWs6.trim).toBe('Trans Am WS6');
    expect(transAmWs6.bodyStyle).toBe('T-Top Coupe');
  });

  it('extracts Buick Grand National / GNX and Oldsmobile 442 series, trims, and bodyStyles', () => {
    const buickGnx = classifyVehicleFacet(
      '1987 Buick Regal GNX #089 Grand National Turbo',
      'GNX',
      'Grand National',
      '2-Door Hardtop',
    );
    expect(buickGnx.series).toBe('GNX');
    expect(buickGnx.trim).toBe('Grand National');
    expect(buickGnx.bodyStyle).toBe('2-Door Hardtop');

    const buickGnTTop = classifyVehicleFacet(
      '1987 Buick Grand National WE2 T-Top Coupe',
      'Grand National',
      'Grand National',
      'T-Top',
    );
    expect(buickGnTTop.series).toBe('Grand National');
    expect(buickGnTTop.trim).toBe('Grand National');
    expect(buickGnTTop.bodyStyle).toBe('T-Top Coupe');

    const olds442 = classifyVehicleFacet(
      '1970 Oldsmobile 4-4-2 W-30 Holiday Hardtop',
      '442',
      'W-30',
      '2-Door Hardtop',
    );
    expect(olds442.series).toBe('442');
    expect(olds442.trim).toBe('W-30');
    expect(olds442.bodyStyle).toBe('2-Door Hardtop');
  });

  it('extracts Jeep CJ-5 / CJ-7 / Scrambler, Grand Wagoneer (SJ), Wrangler (Rubicon 392), and International Scout II facets', () => {
    const cj7 = classifyVehicleFacet(
      '1983 Jeep CJ-7 Renegade 4.2L 5-Speed',
      'CJ-7',
      'Renegade',
      'Soft Top 4x4',
    );
    expect(cj7.series).toBe('CJ-7');
    expect(cj7.trim).toBe('Renegade');
    expect(cj7.bodyStyle).toBe('Soft Top 4x4');

    const grandWagoneer = classifyVehicleFacet(
      '1990 Jeep Grand Wagoneer SJ Final Edition',
      'SJ',
      'Grand Wagoneer',
      '4-Door Wagon',
    );
    expect(grandWagoneer.series).toBe('SJ');
    expect(grandWagoneer.trim).toBe('Grand Wagoneer');

    const wrangler392 = classifyVehicleFacet(
      '2022 Jeep Wrangler Unlimited Rubicon 392 Sky One-Touch',
      'JL',
      'Rubicon 392',
      'Soft Top 4x4',
    );
    expect(wrangler392.series).toBe('JL');
    expect(wrangler392.trim).toBe('Rubicon 392');
    expect(wrangler392.bodyStyle).toBe('Soft Top 4x4');

    const scoutII = classifyVehicleFacet(
      '1979 International Harvester Scout II Rallye 345 V8',
      'Scout II',
      'Rallye',
      '2-Door Wagon',
    );
    expect(scoutII.series).toBe('Scout II');
    expect(scoutII.trim).toBe('Rallye');
    expect(scoutII.bodyStyle).toBe('2-Door Wagon');
  });

  it('extracts JDM Icons: Datsun 240Z/260Z/280Z (S30), Nissan Skyline GT-R (BNR32, BNR34 / V-Spec), and Toyota Supra (JZA80 / Twin Turbo / Targa (Sport Roof))', () => {
    const datsun240z = classifyVehicleFacet(
      '1971 Datsun 240Z Series I HLS30 Fairlady Z',
      '240Z',
      'Fairlady Z',
      '2-Door Hardtop',
    );
    expect(datsun240z.series).toBe('S30');
    expect(datsun240z.trim).toBe('Fairlady Z');
    expect(datsun240z.bodyStyle).toBe('2-Door Hardtop');

    const datsun280z = classifyVehicleFacet(
      '1977 Datsun 280Z Coupe 5-Speed',
      '280Z',
      null,
      '2-Door Hardtop',
    );
    expect(datsun280z.series).toBe('S30');
    expect(datsun280z.bodyStyle).toBe('2-Door Hardtop');

    const skylineR32 = classifyVehicleFacet(
      '1991 Nissan Skyline GT-R BNR32 RB26DETT',
      'BNR32',
      'GT-R',
      '2-Door Hardtop',
    );
    expect(skylineR32.series).toBe('BNR32');
    expect(skylineR32.bodyStyle).toBe('2-Door Hardtop');

    const skylineR34 = classifyVehicleFacet(
      '1999 Nissan Skyline GT-R V-Spec BNR34 Bayside Blue',
      'BNR34',
      'V-Spec',
      '2-Door Hardtop',
    );
    expect(skylineR34.series).toBe('BNR34');
    expect(skylineR34.trim).toBe('V-Spec');
    expect(skylineR34.bodyStyle).toBe('2-Door Hardtop');

    const supraA80 = classifyVehicleFacet(
      '1994 Toyota Supra Twin Turbo JZA80 6-Speed Sport Roof',
      'JZA80',
      'Twin Turbo',
      'Targa (Sport Roof)',
    );
    expect(supraA80.series).toBe('JZA80');
    expect(supraA80.trim).toBe('Twin Turbo');
    expect(supraA80.bodyStyle).toBe('Targa (Sport Roof)');
  });
});
