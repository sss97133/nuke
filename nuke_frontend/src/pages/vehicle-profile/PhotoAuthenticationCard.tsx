/**
 * PhotoAuthenticationCard — shows retained camera labels for vehicle photos.
 * A device attribution row with camera text is metadata, not authentication.
 *
 * Renders only when camera labels exist (per "no empty shells" rule).
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';

interface Props {
  vehicleId: string;
}

interface DeviceCount { device: string; n: number }

interface State {
  total: number;
  withCamera: number;
  bySource: { source: string; n: number; withCamera: number }[];
  byDevice: DeviceCount[];
}

const PhotoAuthenticationCard: React.FC<Props> = ({ vehicleId }) => {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    (async () => {
      // Pull image_id+source for the vehicle, then check which have attribution rows.
      const imgRes = await supabase
        .from('vehicle_images')
        .select('id, source')
        .eq('vehicle_id', vehicleId)
        .limit(5000);
      if (imgRes.error) { if (!cancelled) setError(imgRes.error.message); return; }
      const imgs = imgRes.data || [];
      if (imgs.length === 0) { if (!cancelled) setState({ total: 0, withCamera: 0, bySource: [], byDevice: [] }); return; }

      const ids = imgs.map(r => r.id);
      // Chunk in case of very large galleries
      const chunkSize = 500;
      const attribByImage = new Map<string, { make: string | null; model: string | null }>();
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize);
        const aRes = await supabase
          .from('device_attributions')
          .select('image_id, camera_make, camera_model')
          .in('image_id', slice);
        if (aRes.error) { if (!cancelled) setError(aRes.error.message); return; }
        for (const r of aRes.data || []) {
          attribByImage.set(r.image_id as string, { make: r.camera_make, model: r.camera_model });
        }
      }

      const total = imgs.length;
      let withCamera = 0;
      const sourceMap = new Map<string, { n: number; withCamera: number }>();
      const deviceMap = new Map<string, number>();
      for (const img of imgs) {
        const src = img.source || '—';
        const cur = sourceMap.get(src) || { n: 0, withCamera: 0 };
        cur.n++;
        const a = attribByImage.get(img.id);
        if (a && (a.make?.trim() || a.model?.trim())) {
          withCamera++;
          cur.withCamera++;
          const dev = [a.make?.trim(), a.model?.trim()].filter(Boolean).join(' ');
          deviceMap.set(dev, (deviceMap.get(dev) || 0) + 1);
        }
        sourceMap.set(src, cur);
      }
      if (cancelled) return;
      setState({
        total,
        withCamera,
        bySource: Array.from(sourceMap.entries()).map(([source, v]) => ({ source, ...v })).sort((a, b) => b.n - a.n),
        byDevice: Array.from(deviceMap.entries()).map(([device, n]) => ({ device, n })).sort((a, b) => b.n - a.n),
      });
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (error) return null;
  if (!state || state.withCamera === 0) return null;

  return (
    <CollapsibleWidget variant="profile" title="Camera metadata" defaultCollapsed={true}>
      <div style={{ padding: '8px 12px', fontFamily: 'Arial, sans-serif', color: 'var(--text, #1a1a1a)' }}>
        <p style={{ fontSize: 10 }}>Stored camera labels; image authenticity is unverified.</p>

        {/* Per-device breakdown */}
        {state.byDevice.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
              by device
            </div>
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.5 }}>
              {state.byDevice.slice(0, 12).map((d) => (
                <div key={d.device} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '2px 0' }}>
                  <span>{d.device}</span>
                  <span style={{ color: 'var(--text-secondary, #666)' }}>{d.n}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-source breakdown */}
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
            camera labels / images read · by source
          </div>
          <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, lineHeight: 1.5 }}>
            {state.bySource.map((s) => {
              return (
                <div key={s.source} style={{ display: 'grid', gridTemplateColumns: '1fr 60px', gap: 8, borderBottom: '1px solid var(--text-disabled, #ddd)', padding: '2px 0' }}>
                  <span>{s.source}</span>
                  <span style={{ textAlign: 'right', color: 'var(--text-secondary, #666)' }}>{s.withCamera}/{s.n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </CollapsibleWidget>
  );
};

export default PhotoAuthenticationCard;
