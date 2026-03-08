/**
 * Shared non-automobile exclusion constants.
 *
 * Used by every code path that queries `vehicles` to ensure
 * motorcycles, boats, RVs, farm equipment, aircraft, etc.
 * never appear in feeds or showcases.
 */

/** Vehicle types that ARE automobiles (allowed through). */
export const AUTO_VEHICLE_TYPES = ['CAR', 'TRUCK', 'SUV', 'VAN', 'MINIVAN'] as const;

/**
 * Makes that are NEVER automobiles.
 * Includes both UPPERCASE and Mixed-case variants because
 * the DB has inconsistent casing and PostgREST `.not('make','in',...)` is case-sensitive.
 */
export const NON_AUTO_MAKES = [
  // Motorcycles
  'YAMAHA','HARLEY-DAVIDSON','KAWASAKI','SUZUKI','DUCATI','KTM','TRIUMPH','INDIAN',
  'HUSQVARNA','APRILIA','MOTO GUZZI','NORTON','BSA','BUELL','ROYAL ENFIELD',
  'VINCENT','VELOCETTE','AJS','MATCHLESS','EXCELSIOR','HENDERSON','BIMOTA',
  'BENELLI','CROCKER','LAVERDA','MV AGUSTA','VESPA','PIAGGIO',
  // Powersports / UTV / ATV
  'POLARIS','ARCTIC CAT','CAN-AM','SKI-DOO','SKIDOO',
  // Marine
  'SEA-DOO','SEA RAY','BAYLINER','BOSTON WHALER','GRUMMAN','GLASTRON','SKEETER','TRACKER',
  'MASTERCRAFT','MALIBU BOATS','CORRECT CRAFT','RIVA','CHRIS-CRAFT','WELLCRAFT','RINKER',
  'CHAPARRAL','COBALT','LUND','CRESTLINER','BENNINGTON',
  // RV / Camper
  'FLEETWOOD','WINNEBAGO','AIRSTREAM','COACHMEN','JAYCO','KEYSTONE','FOREST RIVER',
  'THOR','NEWMAR','TIFFIN','HOLIDAY RAMBLER','MONACO','FLAGSTAFF','COLEMAN','STARCRAFT',
  'HEARTLAND','DUTCHMEN','GRAND DESIGN','ENTEGRA','GULF STREAM',
  // Farm / Heavy Equipment
  'JOHN DEERE','KUBOTA','CATERPILLAR','BOBCAT','CASE IH','NEW HOLLAND',
  'MASSEY FERGUSON','FARMALL','ALLIS-CHALMERS','OLIVER','AGCO',
  // Heavy Duty / Commercial
  'FREIGHTLINER','PETERBILT','KENWORTH','MACK','HINO','WESTERN STAR',
  'AUTOCAR','NAVISTAR',
  // Golf Carts
  'EZGO','CLUB CAR','CUSHMAN','GEM',
  // Aircraft
  'CESSNA','PIPER','BEECHCRAFT','MOONEY','CIRRUS',
  // Trailers
  'FEATHERLITE','SUNDOWNER','BIG TEX','LOAD TRAIL','PJ TRAILERS',
  // Misparsed title junk (words that appear as "make" from bad title parsing)
  'ILLUMINATED','NEON','RICHFIELD-BRANDED','AMETHYST','SPEED','PURE',
  'PROMO','COLLECTION','AEROVAULT','DISPLAY','VINTAGE SIGN',

  // === Mixed-case variants ===
  'Yamaha','Harley-Davidson','Kawasaki','Suzuki','Ducati','KTM','Triumph','Indian',
  'Husqvarna','Aprilia','Norton','Buell','Royal Enfield',
  'Vincent','Velocette','Vespa','Piaggio',
  'Polaris','Arctic Cat','Can-Am',
  'Sea-Doo','Sea Ray','Bayliner','Boston Whaler','Grumman','Glastron','Skeeter','Tracker',
  'Mastercraft','Chris-Craft','Wellcraft','Rinker','Chaparral','Cobalt',
  'Fleetwood','Winnebago','Airstream','Coachmen','Jayco','Keystone','Forest River',
  'Thor','Newmar','Tiffin','Flagstaff','Coleman','Starcraft','Heartland','Dutchmen',
  'Grand Design','Entegra','Gulf Stream',
  'John Deere','Kubota','Caterpillar','Bobcat','Farmall','Allis-Chalmers','Oliver',
  'Massey Ferguson','New Holland','Case IH',
  'Freightliner','Peterbilt','Kenworth','Mack','Hino','Western Star',
  'Ezgo','Club Car','Cushman',
  'Cessna','Piper','Beechcraft','Mooney','Cirrus',
  'Featherlite','Sundowner',
] as const;

/** Comma-joined string for PostgREST `.not('make', 'in', '(...)')` calls. */
export const NON_AUTO_MAKES_CSV = NON_AUTO_MAKES.join(',');

/**
 * Apply non-auto exclusion filters to a Supabase query builder.
 * Works with any `.from('vehicles')` query.
 *
 * Adds:
 * 1. canonical_vehicle_type whitelist (CAR/TRUCK/SUV/VAN/MINIVAN or null)
 * 2. Make blocklist (catches null-type junk from known non-auto brands)
 */
export function applyNonAutoFilters<T extends { or: (...args: any[]) => any; not: (...args: any[]) => any }>(
  query: T,
): T {
  // Only allow auto types or unclassified
  query = query.or(
    'canonical_vehicle_type.in.(CAR,TRUCK,SUV,VAN,MINIVAN),' +
    'canonical_vehicle_type.is.null'
  );
  // Block known non-auto makes
  query = query.not('make', 'in', '(' + NON_AUTO_MAKES_CSV + ')');
  return query;
}

/**
 * Client-side filter: returns true if a vehicle appears to be an automobile.
 * Used as a safety net in feedFilterSort and other client-side filtering.
 */
export function isAutoVehicle(vehicle: {
  canonical_vehicle_type?: string | null;
  canonical_body_style?: string | null;
  body_style?: string | null;
  make?: string | null;
}): boolean {
  const vType = (vehicle.canonical_vehicle_type || '').toUpperCase();

  // If classified as a non-auto type, reject
  if (vType && !AUTO_VEHICLE_TYPES.includes(vType as any)) {
    return false;
  }

  // Check make against blocklist (case-insensitive)
  const make = (vehicle.make || '').toUpperCase();
  if (make && NON_AUTO_MAKES.some(m => m.toUpperCase() === make)) {
    return false;
  }

  return true;
}
