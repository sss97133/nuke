import {
  isPickupFamilyLabel,
  type FamilyFacetAxis,
} from '../familyFacetsAndEmblems';

export function resolveVehicleMarketFamily(
  vehicle: Record<string, any> | null | undefined,
  markFamily?: string | null,
): string | null {
  if (markFamily && markFamily.trim()) {
    const trimmedMarkFamily = markFamily.trim();
    return isPickupFamilyLabel(trimmedMarkFamily) ? 'Pickup' : trimmedMarkFamily;
  }
  if (!vehicle || typeof vehicle !== 'object') return null;

  const explicitFamily =
    (typeof vehicle.family === 'string' && vehicle.family.trim()) ||
    (typeof vehicle.model_family === 'string' && vehicle.model_family.trim()) ||
    null;
  if (explicitFamily) {
    return isPickupFamilyLabel(explicitFamily) ? 'Pickup' : explicitFamily;
  }

  const rawModel =
    (typeof vehicle.normalized_model === 'string' && vehicle.normalized_model.trim()) ||
    (typeof vehicle.model === 'string' && vehicle.model.trim()) ||
    '';
  const rawSeries = typeof vehicle.series === 'string' ? vehicle.series.trim() : '';

  if (isPickupFamilyLabel(rawModel) || isPickupFamilyLabel(rawSeries)) {
    return 'Pickup';
  }

  const composite = [
    vehicle.normalized_model,
    vehicle.model,
    vehicle.series,
    vehicle.trim,
    vehicle.listing_title,
    vehicle.title,
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join(' ');
  const makeLower = typeof vehicle.make === 'string' ? vehicle.make.trim().toLowerCase() : '';

  if (/\b(?:K\/?5\s+Blazer|Blazer)\b/i.test(composite)) return 'Blazer';
  if (/\b(?:K\/?5\s+Jimmy|Jimmy)\b/i.test(composite)) return 'Jimmy';
  if (/\bSuburban\b/i.test(composite)) return 'Suburban';

  if (
    /\b(?:C[-\s]?10|K[-\s]?10|C[-\s]?20|K[-\s]?20|C[-\s]?30|K[-\s]?30|R[-\s]?10|V[-\s]?10|3100|3600|3800|Apache|Cameo|C[-\s]?1500|K[-\s]?1500|C[-\s]?2500|K[-\s]?2500|C[-\s]?3500|K[-\s]?3500|454\s*SS|S[-\s]?10|Syclone|Sonoma|S[-\s]?15|Caballero|F[-\s]?100|F[-\s]?150|F[-\s]?250|F[-\s]?350|F[-\s]?450|F[-\s]?[123]|Power\s+Wagon|WM[-\s]?300|D[-\s]?100|D[-\s]?150|W[-\s]?100|W[-\s]?150|W[-\s]?200|Pickup)\b/i.test(
      composite,
    ) ||
    ((makeLower === 'chevrolet' || makeLower === 'gmc') &&
      /\b(?:Silverado|Sierra|Cheyenne|Scottsdale|Custom\s+Deluxe|Stepside|Fleetside)\b/i.test(composite))
  ) {
    return 'Pickup';
  }

  if (/\bBel\s+Air\b/i.test(composite)) return 'Bel Air';
  if (/\bLand\s+Cruiser\b|\b(?:FJ|BJ|HJ|FZJ|UZJ|URJ)[-\s]?(?:4[02357]|55|6[02]|80|100|200)\b/i.test(composite)) {
    return 'Land Cruiser';
  }
  if (/\bCorvette\b|\bSting\s*Ray\b/i.test(composite)) return 'Corvette';
  if (/\bMustang\b|\bShelby\s+GT(?:350|500)\w*\b|\bBoss\s+(?:302|429)\b/i.test(composite)) return 'Mustang';
  if (/\bCamaro\b/i.test(composite)) return 'Camaro';
  if (/\bChevelle\b/i.test(composite)) return 'Chevelle';
  if (/\bBronco\b/i.test(composite)) return 'Bronco';
  if (makeLower === 'porsche' && /\b(?:911|930|964|993|996|997|991|992|Carrera\s+RS)\b/i.test(composite)) return '911';
  if (makeLower === 'porsche' && /\b356[ABC]?\b/i.test(composite)) return '356';
  if (makeLower.startsWith('mercedes') && /\b(?:190|230|250|280|300|380|450|500|560)\s*SL\b|\bSL\b/i.test(composite)) {
    return 'SL';
  }
  if (makeLower === 'bmw' && /\b(?:E30|E36|E46|E90|E92|E93|F80|G80)?\s*M3\b/i.test(composite)) return 'M3';
  if (makeLower === 'bmw' && /\b(?:E28|E34|E39|E60|F10|F90)?\s*M5\b/i.test(composite)) return 'M5';
  if (makeLower === 'bmw' && /\b2002(?:tii|turbo)?\b/i.test(composite)) return '2002';
  if (/\bE-Type\b|\bXKE\b/i.test(composite)) return 'E-Type';
  if (/\bRoad\s+Runner\b/i.test(composite)) return 'Road Runner';
  if (/\bCharger\b/i.test(composite)) return 'Charger';
  if (/\bChallenger\b/i.test(composite)) return 'Challenger';
  if (/\bGTO\b/i.test(composite)) return 'GTO';
  if (/\bFirebird\b|\bTrans\s+Am\b/i.test(composite)) return 'Firebird';

  if (rawModel) {
    return rawModel.split(' · ')[0].trim();
  }
  return null;
}

export function buildFacetDrilldownUrl(params: {
  make: string;
  family: string;
  axis: Exclude<FamilyFacetAxis, 'raw'>;
  facet: string;
}): string {
  const sp = new URLSearchParams();
  sp.set('make', params.make.trim());
  sp.set('family', params.family.trim());
  sp.set('axis', params.axis);
  sp.set('facet', params.facet.trim());
  return `/?${sp.toString()}`;
}
