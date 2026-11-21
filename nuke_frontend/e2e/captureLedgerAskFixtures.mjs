// Fixtures for captureLedgerAsk.e2e.mjs: the capture ledger's "Which vehicle?" question for a held photo set, in the
// live readers' shapes (get_capture_ledger, get_capture_ledger_day, the vehicles read the page shares with the phone's
// picker, attribute_image_session as of 2026-11-21). Every vehicle, id and set key is made up. Pictures are small solid-colour PNGs drawn here.
import { deflateSync } from 'node:zlib';
import { MOCK_HOST } from './mockSupabase.mjs';

export const OWNER_ID = '00000000-0000-4000-b000-0000000c1a01';
export const DAY = '2026-11-18';
export const DAY_BEFORE = '2026-11-17';
export const TZ = 'America/Los_Angeles';

const vid = (n) => `00000000-0000-4000-c000-${String(n).padStart(12, '0')}`;
const img = (n) => `00000000-0000-4000-d000-${String(n).padStart(12, '0')}`;
export const pic = (name) => `${MOCK_HOST}/storage/v1/object/public/vehicle-images/e2e/${name}.png`;

// Colours by picture name. The two pickups are near shades of one red on purpose: look-alikes.
export const COLOURS = {
  'car-01': [176, 40, 36], 'car-02': [196, 62, 52], 'car-03': [46, 98, 160], 'car-04': [40, 140, 80], 'car-05': [220, 170, 40],
  'car-06': [120, 72, 160], 'car-07': [30, 30, 30], 'car-08': [200, 200, 200], 'car-09': [230, 110, 30], 'car-10': [20, 150, 160],
  'car-11': [150, 110, 70], 'car-12': [90, 120, 40], 'car-13': [210, 90, 140], 'car-14': [70, 70, 110],
  'f-01': [180, 50, 45], 'f-02': [170, 45, 40], 'f-03': [190, 60, 50], 'f-04': [100, 100, 100], 'f-05': [160, 40, 38], 'f-06': [200, 70, 60],
  'f-07': [60, 110, 170], 'f-08': [80, 130, 180], 'f-09': [140, 140, 60], 'f-10': [40, 120, 60], 'f-11': [50, 130, 70], 'f-12': [60, 140, 80],
};

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** A solid-colour RGB PNG, size x size. */
export function solidPng([r, g, b], size = 64) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// His vehicles: what the vehicles table answers the page's read (the five selected columns, last updated first), 14
// made-up vehicles.
const g = (n, year, make, model) => ({ id: vid(n), year, make, model, primary_image_url: pic(`car-${String(n).padStart(2, '0')}`) });
export const VEHICLES = [
  g(1, 1978, 'Chevrolet', 'C10'),
  g(2, 1982, 'Chevrolet', 'C10'),
  g(3, 1971, 'Ford', 'Bronco'),
  g(4, 1969, 'Chevrolet', 'Camaro'),
  g(5, 1966, 'Ford', 'Mustang'),
  g(6, 1987, 'GMC', 'Sierra Classic'),
  g(7, 1972, 'Chevrolet', 'Chevelle'),
  g(8, 1990, 'Toyota', 'Land Cruiser'),
  g(9, 1979, 'Dodge', 'Power Wagon W150 Macho Crew Cab Dually Long Bed'),
  g(10, 1985, 'Jeep', 'CJ-7'),
  g(11, 1964, 'Volkswagen', 'Type 2'),
  g(12, 1999, 'Ford', 'F-250 Super Duty'),
  g(13, 1993, 'Mazda', 'Miata'),
  g(14, 2001, 'Porsche', '911'),
];
export const CAR = Object.fromEntries(VEHICLES.map((c, i) => [i + 1, c]));
const nameOf = (c) => `${c.year} ${c.make} ${c.model}`;

export const SET_A = 'set-e2e-aaaa-0001';
export const SET_B = 'set-e2e-bbbb-0002';
// distinctive scores so any score text on screen is caught
export const SCORES = [2.37, 2.19, 0.84, 1.71, 0.66];
const CANDIDATES = [
  { vehicle_id: CAR[2].id, name: nameOf(CAR[2]), score: SCORES[0] },
  { vehicle_id: CAR[1].id, name: nameOf(CAR[1]), score: SCORES[1] },
  { vehicle_id: CAR[3].id, name: nameOf(CAR[3]), score: SCORES[2] },
];
// Closest cars that are not his vehicles (a merged-away record, a record not tied to his account): the writer refuses them.
export const NOT_MINE = [
  { vehicle_id: vid(91), name: '1977 Ford F-100', score: SCORES[3] },
  { vehicle_id: vid(92), name: '1984 Chevrolet K20', score: SCORES[4] },
];
/** Set A's closest cars for the two cases the page draws apart: one his and one not (mixed), none his (none). */
export const CANDIDATES_MIXED = [CANDIDATES[0], NOT_MINE[0]];
export const CANDIDATES_NONE_MINE = NOT_MINE;

const frame = (n, at, state, extra = {}) => ({ image_id: img(n), taken_at: `${DAY}T${at}:00+00:00`, state, reason: null, vehicle_id: null, vehicle: null,
  source: 'capture_relay_ios', file_name: `IMG_${4100 + n}.HEIC`, thumb: pic(`f-${String(n).padStart(2, '0')}`), set_key: null, candidates: null, ...extra });
const onCar = (car) => ({ vehicle_id: car.id, vehicle: nameOf(car), reason: 'approved' });

// Set A: 6 photos 10:00 to 10:25 local (18:00Z to 18:25Z), held "not sure enough" between the two pickups.
export const SET_A_IDS = [2, 3, 4, 5, 6, 7].map(img);
// Set B: 2 photos at 1:00 and 1:02 pm local, held with no candidate at all.
export const SET_B_IDS = [9, 10].map(img);

/**
 * get_capture_ledger_day for DAY. `filed` says what has been filed from set A so far: null (nothing), or
 * { vehicle, ids } for the photos now on that vehicle. `candidates`: set A's closest cars.
 */
export function dayFixture(filed = null, candidates = CANDIDATES) {
  const setA = [['18:00', 2], ['18:05', 3], ['18:10', 4], ['18:15', 5], ['18:20', 6], ['18:25', 7]].map(([at, n]) => {
    const id = img(n);
    if (filed && filed.ids.includes(id)) return frame(n, at, 'on_vehicle', onCar(filed.vehicle));
    return frame(n, at, 'held', { reason: 'score_below_threshold', set_key: SET_A, candidates });
  });
  return {
    day: DAY, tz: TZ,
    frames: [
      frame(11, '17:00', 'on_vehicle', onCar(CAR[4])),
      frame(12, '17:04', 'on_vehicle', onCar(CAR[4])),
      frame(1, '17:09', 'on_vehicle', onCar(CAR[4])),
      ...setA,
      frame(8, '19:00', 'unsorted', { reason: 'not_scored' }),
      frame(9, '21:00', 'held', { reason: 'no_clear_lead', set_key: SET_B, candidates: null }),
      frame(10, '21:02', 'held', { reason: 'no_clear_lead', set_key: SET_B, candidates: null }),
    ],
    skipped: [],
  };
}

const zero = { taken: 0, on_vehicle: 0, unverified: 0, waiting: 0, held: 0, pulled: 0, private: 0, unsorted: 0, failed: 0, duplicate: 0, skipped: 0 };
/** get_capture_ledger: two days, totals following what set A has filed. */
export function ledgerFixture(filed = null) {
  const moved = filed ? filed.ids.length : 0;
  const day1 = { ...zero, day: DAY, taken: 12, on_vehicle: 3 + moved, held: 8 - moved, unsorted: 1,
    vehicles: [{ vehicle_id: CAR[4].id, name: nameOf(CAR[4]), n: 3 }, ...(filed ? [{ vehicle_id: filed.vehicle.id, name: nameOf(filed.vehicle), n: moved }] : [])]
      .sort((a, b) => b.n - a.n),
    held_reasons: { ...(8 - moved - 2 > 0 ? { score_below_threshold: 8 - moved - 2 } : {}), no_clear_lead: 2 }, skip_reasons: {} };
  const day2 = { ...zero, day: DAY_BEFORE, taken: 5, on_vehicle: 5, vehicles: [{ vehicle_id: CAR[5].id, name: nameOf(CAR[5]), n: 5 }], held_reasons: {}, skip_reasons: {} };
  const totals = Object.fromEntries(Object.keys(zero).map(k => [k, (day1[k] ?? 0) + (day2[k] ?? 0)]));
  return { generated_at: '2026-11-21T18:00:00Z', tz: TZ, days: [day1, day2], days_total: 2, totals, rescan: null,
    last_rescan: { id: '00000000-0000-4000-e000-000000000001', requested_at: '2026-11-20T15:00:00Z', acked_at: '2026-11-20T15:01:00Z', device: 'E2E phone',
      finished_at: '2026-11-20T15:03:00Z', result: { uploaded: 0 } } };
}
export const nameOfCar = nameOf;
