// useTechPacket — parallel-fetches the 5 wiring tech-packet RPCs for a vehicle.
// All RPCs are read-only Postgres functions; see receipt 2026-04-24_tech-packet-rpcs.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface WireListRow {
  src: 'upgrade' | 'custom';
  circuit_code: string;
  from_component: string;
  to_component: string;
  wire_gauge_awg: string | null;
  wire_color: string | null;
  length_ft: number | null;
  fuse_rating_amps: number | null;
  system_category: string | null;
  pdm_channel: string | null;
}

export interface PdmChannelRow {
  pdm: 'PDM30' | 'PDM15' | 'PDM?';
  channel: string;
  device: string;
  wire_gauge_awg: string | null;
  wire_color: string | null;
  fuse_rating_amps: number | null;
  circuit_code: string;
}

export interface BomWireRow {
  wire_gauge_awg: string;
  wire_color: string;
  base_ft: number;
  order_ft: number;
  spool_size: '25ft' | '100ft' | '500ft';
}

export interface BomConnectorRow {
  device_model: string;
  connector_type: string | null;
  pin_count: number | null;
  qty: number;
}

export interface ManifestSummary {
  devices_total: number;
  devices_purchased: number;
  devices_pending: number;
  spent_usd: number;
  pending_usd: number;
  total_spec_usd: number;
}

export interface TechPacket {
  loading: boolean;
  error: string | null;
  wireList: WireListRow[];
  pdmChannels: PdmChannelRow[];
  bomWire: BomWireRow[];
  bomConnectors: BomConnectorRow[];
  manifest: ManifestSummary | null;
}

const EMPTY: TechPacket = {
  loading: true, error: null,
  wireList: [], pdmChannels: [], bomWire: [], bomConnectors: [], manifest: null,
};

export function useTechPacket(vehicleId: string | undefined): TechPacket {
  const [state, setState] = useState<TechPacket>(EMPTY);

  useEffect(() => {
    if (!vehicleId) {
      setState({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    Promise.all([
      supabase.rpc('wiring_tech_wire_list',         { p_vehicle_id: vehicleId }),
      supabase.rpc('wiring_tech_pdm_channel_map',   { p_vehicle_id: vehicleId }),
      supabase.rpc('wiring_tech_bom_wire',          { p_vehicle_id: vehicleId }),
      supabase.rpc('wiring_tech_bom_connectors',    { p_vehicle_id: vehicleId }),
      supabase.rpc('wiring_tech_manifest_summary',  { p_vehicle_id: vehicleId }),
    ]).then(([wl, pcm, bw, bc, ms]) => {
      if (cancelled) return;
      const err = wl.error || pcm.error || bw.error || bc.error || ms.error;
      setState({
        loading: false,
        error: err ? err.message : null,
        wireList: (wl.data || []) as WireListRow[],
        pdmChannels: (pcm.data || []) as PdmChannelRow[],
        bomWire: (bw.data || []) as BomWireRow[],
        bomConnectors: (bc.data || []) as BomConnectorRow[],
        manifest: (ms.data && ms.data[0]) ? ms.data[0] as ManifestSummary : null,
      });
    }).catch((e) => {
      if (!cancelled) setState({ ...EMPTY, loading: false, error: String(e) });
    });

    return () => { cancelled = true; };
  }, [vehicleId]);

  return state;
}
