import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// Eden Rock is one of the few island businesses OSM actually carries, tagged tourism=hotel on
// its own promontory. Both our rows were wrong in different ways: the hotel sat 150m off (on
// Route de Saint-Jean rather than the rock), and the villa-rental arm sat 232m away on a
// Nominatim centroid shared with 65 other businesses.
const OSM = { lat: 17.9032914, lon: -62.8360517, osm: 'Eden Rock, Route de Saint-Jean, Saint-Jean — tourism/hotel' };

const hav = (a,b,c,d) => { const R=6371000,r=Math.PI/180; const dLat=(c-a)*r,dLon=(d-b)*r;
  const x=Math.sin(dLat/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dLon/2)**2;
  return Math.round(2*R*Math.asin(Math.sqrt(x))); };

const { data, error } = await sb.from('organizations')
  .select('id,name,latitude,longitude,metadata').ilike('name', '%eden rock%');
if (error) throw error;

for (const o of data) {
  const shift = hav(o.latitude, o.longitude, OSM.lat, OSM.lon);
  // The villa-rental arm is a different entity from the hotel and may legitimately sit
  // elsewhere; but its stored point is a shared centroid, so it is wrong either way. Move both
  // to the verified POI and record why — a later field walk can split them properly.
  console.log(`  ${o.name.padEnd(24)} ${o.latitude},${o.longitude} -> ${OSM.lat},${OSM.lon}  (${shift}m)`);
  if (APPLY) {
    const metadata = {
      ...(o.metadata || {}),
      geocode: { at: new Date().toISOString().slice(0,10), source: 'openstreetmap', precision: 'poi',
                 osm_ref: OSM.osm, note: 'verified hotel POI on the Baie de Saint-Jean promontory' },
      geocode_history: [...(o.metadata?.geocode_history || []), {
        latitude: o.latitude, longitude: o.longitude,
        precision: o.metadata?.geocode?.precision ?? null,
        replaced_at: new Date().toISOString(), moved_m: shift,
        reason: o.metadata?.geocode?.precision === 'city_fallback'
          ? 'stored point was a Saint-Jean centroid shared with 65 other orgs'
          : 'stored point was ~150m off the property, on the coast road',
        restore: `UPDATE organizations SET latitude=${o.latitude}, longitude=${o.longitude} WHERE id='${o.id}';`,
      }],
    };
    const { error: e } = await sb.from('organizations')
      .update({ latitude: OSM.lat, longitude: OSM.lon, metadata }).eq('id', o.id);
    if (e) throw e;
  }
}
console.log(APPLY ? 'APPLIED' : 'DRY RUN — re-run with --apply');
