// WiringPlan.tsx — Entry point for /vehicle/:vehicleId/wiring
// Loads vehicle_build_manifest → WiringWorkspace (data view + reference images).

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { WiringWorkspace } from '../components/wiring/WiringWorkspace';
import type { ManifestDevice } from '../components/wiring/overlayCompute';

export default function WiringPlan() {
  const navigate = useNavigate();
  const { vehicleId } = useParams();

  const [vehicleInfo, setVehicleInfo] = useState<{ year?: number; make?: string; model?: string } | null>(null);
  const [manifestDevices, setManifestDevices] = useState<ManifestDevice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      if (!vehicleId) return;
      setLoading(true);
      try {
        const [vehicleRes, manifestRes] = await Promise.all([
          supabase.from('vehicles').select('year, make, model').eq('id', vehicleId).maybeSingle(),
          supabase.from('vehicle_build_manifest')
            .select('*')
            .eq('vehicle_id', vehicleId)
            .order('device_category')
            .order('device_name'),
        ]);

        if (vehicleRes.data) setVehicleInfo(vehicleRes.data);
        if (manifestRes.data) setManifestDevices(manifestRes.data as ManifestDevice[]);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [vehicleId]);

  if (loading) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 42px)' }}>
      <WiringWorkspace initialDevices={manifestDevices} vehicleId={vehicleId} />
    </div>
  );
}
