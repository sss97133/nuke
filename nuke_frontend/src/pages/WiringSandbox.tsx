// WiringSandbox.tsx — Page wrapper that loads manifest from DB and renders workspace
import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { WiringWorkspace } from '../components/wiring/WiringWorkspace';
import { WiringOverlaySandbox } from '../components/wiring/WiringOverlaySandbox';
import type { ManifestDevice } from '../components/wiring/overlayCompute';

export default function WiringSandbox() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const [searchParams] = useSearchParams();
  const [devices, setDevices] = useState<ManifestDevice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicleInfo, setVehicleInfo] = useState<{ year?: number; make?: string; model?: string } | null>(null);

  // ?view=table falls back to the old tabbed sandbox
  const viewMode = searchParams.get('view');

  useEffect(() => {
    if (!vehicleId) return;

    async function load() {
      try {
        // Load vehicle info
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('year, make, model')
          .eq('id', vehicleId)
          .single();
        if (vehicle) setVehicleInfo(vehicle);

        // Load manifest
        const { data, error: err } = await supabase
          .from('vehicle_build_manifest')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('device_category');

        if (err) throw err;
        setDevices(data || []);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [vehicleId]);

  if (loading) return <div style={{ padding: 20, fontFamily: 'Arial', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Loading manifest...</div>;
  if (error) return <div style={{ padding: 20, color: 'var(--error)' }}>{error}</div>;
  if (!devices) return <div style={{ padding: 20 }}>No manifest found for this vehicle.</div>;

  // Fallback to table view
  if (viewMode === 'table') {
    return (
      <div style={{ padding: '12px' }}>
        {vehicleInfo && (
          <div style={{
            fontSize: 'var(--fs-8, 8px)', textTransform: 'uppercase', letterSpacing: '1px',
            color: 'var(--text-secondary)', marginBottom: 8,
          }}>
            {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
          </div>
        )}
        <WiringOverlaySandbox initialDevices={devices} vehicleId={vehicleId} />
      </div>
    );
  }

  // Default: full workspace canvas
  return (
    <div style={{ height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column' }}>
      {vehicleInfo && (
        <div style={{
          fontSize: 'var(--fs-8, 8px)', textTransform: 'uppercase', letterSpacing: '1px',
          color: 'var(--text-secondary)', padding: '6px 12px',
          borderBottom: '1px solid var(--border, #bdbdbd)',
        }}>
          {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model} — WIRING WORKSPACE
        </div>
      )}
      <WiringWorkspace initialDevices={devices} vehicleId={vehicleId} />
    </div>
  );
}
