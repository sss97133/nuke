export type CanonicalVehicleType =
  | 'CAR'
  | 'TRUCK'
  | 'SUV'
  | 'VAN'
  | 'MINIVAN'
  | 'MOTORCYCLE'
  | 'RV'
  | 'TRAILER'
  | 'BOAT'
  | 'ATV'
  | 'UTV'
  | 'SNOWMOBILE'
  | 'BUS'
  | 'HEAVY_EQUIPMENT'
  | 'OTHER';

export type CanonicalBodyStyle =
  | 'COUPE'
  | 'SEDAN'
  | 'CONVERTIBLE'
  | 'WAGON'
  | 'HATCHBACK'
  | 'LIFTBACK'
  | 'FASTBACK'
  | 'ROADSTER'
  | 'TARGA'
  | 'PICKUP'
  | 'SUV'
  | 'VAN'
  | 'MINIVAN'
  | 'MOTORCYCLE'
  | 'RV'
  | 'TRAILER'
  | 'BOAT'
  | 'ATV'
  | 'UTV'
  | 'SNOWMOBILE';

export type BodyStyleDefinition = {
  canonical: CanonicalBodyStyle;
  display: string;
  vehicleType: CanonicalVehicleType;
  /** One sentence, non-hallucinatory definition. */
  summary: string;
  /** Alias matching tokens (lowercase). */
  aliases: string[];
};

const defs: BodyStyleDefinition[] = [
  { canonical: 'COUPE', display: 'Coupe', vehicleType: 'CAR', summary: 'Two-door car body style.', aliases: ['coupe', '2dr', 'two door', 'two-door'] },
  { canonical: 'SEDAN', display: 'Sedan', vehicleType: 'CAR', summary: 'Four-door car body style.', aliases: ['sedan', '4dr', 'four door', 'four-door'] },
  { canonical: 'CONVERTIBLE', display: 'Convertible', vehicleType: 'CAR', summary: 'Car body style with a retractable/open roof.', aliases: ['convertible', 'cabriolet', 'droptop', 'drop top'] },
  { canonical: 'WAGON', display: 'Wagon', vehicleType: 'CAR', summary: 'Extended-roof car body style with a rear cargo area.', aliases: ['wagon', 'estate'] },
  { canonical: 'HATCHBACK', display: 'Hatchback', vehicleType: 'CAR', summary: 'Car body style with a rear hatch door for cargo access.', aliases: ['hatchback', 'hatch'] },
  { canonical: 'LIFTBACK', display: 'Liftback', vehicleType: 'CAR', summary: 'Hatch-style rear opening with a more sloped profile.', aliases: ['liftback'] },
  { canonical: 'FASTBACK', display: 'Fastback', vehicleType: 'CAR', summary: 'Roofline that slopes continuously down to the rear.', aliases: ['fastback'] },
  { canonical: 'ROADSTER', display: 'Roadster', vehicleType: 'CAR', summary: 'Two-seat open-top sports car body style.', aliases: ['roadster', 'spyder', 'spider'] },
  { canonical: 'TARGA', display: 'Targa', vehicleType: 'CAR', summary: 'Removable roof panel with fixed rear structure.', aliases: ['targa'] },

  { canonical: 'PICKUP', display: 'Pickup', vehicleType: 'TRUCK', summary: 'Truck body style with an open cargo bed.', aliases: ['pickup', 'pickup truck', 'truck', 'crew cab', 'extended cab', 'regular cab', 'single cab', 'double cab'] },
  { canonical: 'SUV', display: 'SUV', vehicleType: 'SUV', summary: 'Sport utility / multi-purpose passenger vehicle.', aliases: ['suv', 'sport utility', 'sport utility vehicle', 'mpv', 'multi-purpose vehicle', 'multipurpose passenger vehicle'] },
  { canonical: 'VAN', display: 'Van', vehicleType: 'VAN', summary: 'Van body style for cargo or passengers.', aliases: ['van', 'cargo van', 'passenger van'] },
  { canonical: 'MINIVAN', display: 'Minivan', vehicleType: 'MINIVAN', summary: 'Passenger-oriented van body style.', aliases: ['minivan'] },

  { canonical: 'MOTORCYCLE', display: 'Motorcycle', vehicleType: 'MOTORCYCLE', summary: 'Two-wheeled motor vehicle.', aliases: ['motorcycle', 'motor bike', 'bike'] },
  { canonical: 'RV', display: 'RV', vehicleType: 'RV', summary: 'Recreational vehicle (motorhome/camper).', aliases: ['rv', 'motorhome', 'recreational vehicle', 'camper'] },
  { canonical: 'TRAILER', display: 'Trailer', vehicleType: 'TRAILER', summary: 'Towed vehicle (trailer).', aliases: ['trailer'] },
  { canonical: 'BOAT', display: 'Boat', vehicleType: 'BOAT', summary: 'Watercraft (boat).', aliases: ['boat'] },
  { canonical: 'ATV', display: 'ATV', vehicleType: 'ATV', summary: 'All-terrain vehicle.', aliases: ['atv', 'quad'] },
  { canonical: 'UTV', display: 'UTV', vehicleType: 'UTV', summary: 'Utility terrain vehicle (side-by-side).', aliases: ['utv', 'side by side', 'side-by-side'] },
  { canonical: 'SNOWMOBILE', display: 'Snowmobile', vehicleType: 'SNOWMOBILE', summary: 'Snowmobile.', aliases: ['snowmobile'] },
];

const canonToDef = new Map<CanonicalBodyStyle, BodyStyleDefinition>(defs.map((d) => [d.canonical, d]));

const normalize = (raw: unknown): string => {
  const s = String(raw ?? '').trim().toLowerCase();
  return s.replace(/\s+/g, ' ');
};

export function getCanonicalBodyStyle(raw: unknown): CanonicalBodyStyle | null {
  const s = normalize(raw);
  if (!s) return null;

  // Exact canonical key support (e.g., "PICKUP")
  const upperKey = s.toUpperCase().replace(/[^A-Z0-9]/g, '') as any;
  if (canonToDef.has(upperKey)) return upperKey as CanonicalBodyStyle;

  // Alias match
  for (const d of defs) {
    if (d.aliases.some((a) => s === a || s.includes(a))) {
      return d.canonical;
    }
  }

  // Pattern fallbacks (for polluted NHTSA-ish strings)
  if (s.includes('sport utility') || s.includes('mpv')) return 'SUV';
  if (s.includes('pickup')) return 'PICKUP';
  if (s.includes('minivan')) return 'MINIVAN';
  if (s.includes('van')) return 'VAN';
  if (s.includes('convertible') || s.includes('cabriolet')) return 'CONVERTIBLE';
  if (s.includes('hatch')) return 'HATCHBACK';
  if (s.includes('wagon') || s.includes('estate')) return 'WAGON';
  if (s.includes('sedan')) return 'SEDAN';
  if (s.includes('coupe')) return 'COUPE';
  if (s.includes('motorcycle')) return 'MOTORCYCLE';
  if (s.includes('motorhome') || s === 'rv' || s.includes('recreational')) return 'RV';
  if (s.includes('trailer')) return 'TRAILER';
  if (s.includes('boat')) return 'BOAT';

  return null;
}

export function getBodyStyleDefinition(raw: unknown): BodyStyleDefinition | null {
  const canon = getCanonicalBodyStyle(raw);
  if (!canon) return null;
  return canonToDef.get(canon) || null;
}

export function getBodyStyleDisplay(raw: unknown): string | null {
  const def = getBodyStyleDefinition(raw);
  if (def) return def.display;
  const s = String(raw ?? '').trim();
  return s ? s : null;
}

