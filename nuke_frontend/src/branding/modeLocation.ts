/**
 * modeLocation — the geofence trigger. The most PASSIVE signal: the app knows
 * which hat you're wearing because of where your body is.
 *
 * No coordinates are fabricated. A mode gets a geofence one of two honest ways:
 *   1. Real substrate — shop_locations.latitude/longitude for that org (seeded
 *      by deriveModes when present).
 *   2. Learned by presence — while standing at the shop, the user taps "set
 *      location" and we capture the device GPS as that mode's center. The system
 *      learns where your modes live by you BEING there. Stored as prefs in
 *      localStorage (not written back into substrate from the client).
 *
 * Feeds the same suggestedSubjectId seam as the schedule trigger; location wins
 * over schedule when both fire (your body beats your calendar).
 */

const GEO_KEY = 'nuke:modeGeofences';
const DEFAULT_RADIUS_M = 150;

export interface Geofence {
  lat: number;
  lng: number;
  /** meters */
  radius: number;
  /** 'gps' = learned by presence, 'substrate' = from shop_locations */
  source: 'gps' | 'substrate';
}

export function getGeofences(): Record<string, Geofence> {
  try {
    const raw = localStorage.getItem(GEO_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setGeofence(subjectId: string, fence: Geofence | null) {
  const all = getGeofences();
  if (fence === null) delete all[subjectId];
  else all[subjectId] = fence;
  localStorage.setItem(GEO_KEY, JSON.stringify(all));
}

/** Seed geofences from real substrate coords without clobbering GPS-learned ones. */
export function seedGeofences(coords: Record<string, { lat: number; lng: number }>) {
  const all = getGeofences();
  let changed = false;
  for (const [id, c] of Object.entries(coords)) {
    if (!all[id]) {
      all[id] = { lat: c.lat, lng: c.lng, radius: DEFAULT_RADIUS_M, source: 'substrate' };
      changed = true;
    }
  }
  if (changed) localStorage.setItem(GEO_KEY, JSON.stringify(all));
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 10_000,
    });
  });
}

export function hasGeofences(): boolean {
  return Object.keys(getGeofences()).length > 0;
}

/**
 * The mode whose geofence currently contains the device, by priority order.
 * Returns null if no fences, no permission, or none contain us.
 */
export async function nearestSubjectId(order: string[]): Promise<string | null> {
  const fences = getGeofences();
  if (Object.keys(fences).length === 0) return null;
  let pos: GeolocationPosition;
  try {
    pos = await getCurrentPosition();
  } catch {
    return null; // no permission / unavailable — silently yield to schedule
  }
  const { latitude, longitude } = pos.coords;
  let best: { id: string; d: number } | null = null;
  for (const id of order) {
    const f = fences[id];
    if (!f) continue;
    const d = haversineMeters(latitude, longitude, f.lat, f.lng);
    if (d <= f.radius && (!best || d < best.d)) best = { id, d };
  }
  return best?.id ?? null;
}
