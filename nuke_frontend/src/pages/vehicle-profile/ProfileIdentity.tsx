import { useEffect, useState } from 'react';
import { VehicleIdentity, type ModelIdentityArtwork } from '../../components/common/MakeIdentity';
import type { VehicleIdentityToken } from '../../utils/vehicleIdentity';
import { supabase } from '../../lib/supabase';

const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
/** The existing public reader owns applicability. Only its exact model mark and
 * original-backed usable derivative may replace the model's text. */
export function modelIdentityArtwork(value: unknown, vehicleId: string, model: string): ModelIdentityArtwork | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, any>;
  if (data.vehicle_id !== vehicleId || !Array.isArray(data.marks)) return null;
  const matches = data.marks.filter((mark: any) => mark?.kind === 'model_wordmark'
    && typeof mark.label === 'string' && normalized(mark.label) === normalized(model));
  if (matches.length !== 1 || !Array.isArray(matches[0].assets)) return null;
  const assets = matches[0].assets;
  const vectors = assets.filter((asset: any) => asset?.asset_kind === 'vector' && asset.review_state === 'usable'
    && asset.identity_mark_id === matches[0].identity_mark_id
    && typeof asset.applicability_evidence === 'string' && asset.applicability_evidence.trim()
    && typeof asset.asset_path === 'string' && /^\/stacks\/makes\/emblems\/[a-z0-9][a-z0-9.-]*\.svg$/.test(asset.asset_path)
    && Number.isInteger(asset.width) && asset.width > 0 && Number.isInteger(asset.height) && asset.height > 0
    && typeof asset.source_context === 'string'
    && assets.some((source: any) => source?.id === asset.source_asset_id && source.asset_kind === 'source'
      && source.review_state === 'usable' && source.identity_mark_id === asset.identity_mark_id));
  if (vectors.length !== 1) return null;
  const asset = vectors[0];
  return { path: asset.asset_path, width: asset.width, height: asset.height, description: asset.source_context };
}

/** Profile-only read: cards keep their existing synchronous catalogue. No owner
 * session or write is needed; unavailable coverage leaves the readable identity. */
export default function ProfileIdentity({ vehicleId, ...identity }: {
  vehicleId: string; make: string; model: string; year?: number | string | null;
  variants?: VehicleIdentityToken[]; compact?: boolean; onExplore?: (field: string, value: string) => void;
}) {
  const subject = JSON.stringify([vehicleId, identity.make, identity.model, identity.year]);
  const [answer, setAnswer] = useState<{ subject: string; data: unknown } | null>(null);
  useEffect(() => {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(vehicleId)) return;
    let cancelled = false;
    setAnswer(null);
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('vehicle_identity_artwork', { p_vehicle_id: vehicleId });
        if (!cancelled) setAnswer({ subject, data: error ? null : data });
      } catch { if (!cancelled) setAnswer({ subject, data: null }); }
    })();
    return () => { cancelled = true; };
  }, [vehicleId, subject]);
  const artwork = answer?.subject === subject ? modelIdentityArtwork(answer.data, vehicleId, identity.model) : null;
  return <VehicleIdentity {...identity} modelArtwork={artwork} />;
}
