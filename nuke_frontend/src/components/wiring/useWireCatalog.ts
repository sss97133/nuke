// useWireCatalog.ts — Fetch wire products and gauge conversion from DB
// Enables tier switching: change one dropdown → every wire recalculates cost.

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────

export type WireTier = 'professional' | 'standard';

export interface WireProduct {
  id: string;
  mil_spec: string;
  trade_name: string | null;
  insulation: string | null;
  temp_rating_c: number | null;
  gauge_awg: number;
  gauge_mm2: number;
  base_color: string;
  stripe_color: string | null;
  color_display: string | null;
  color_hex: string | null;
  stripe_hex: string | null;
  supplier: string | null;
  supplier_url: string | null;
  supplier_sku: string | null;
  price_per_ft: number | null;
  price_per_meter: number | null;
  min_order_ft: number | null;
  in_stock: boolean | null;
  od_inches: number | null;
  od_mm: number | null;
  conductor: string | null;
  strand_count: number | null;
  weight_lbs_per_1000ft: number | null;
  product_image_url: string | null;
  color_swatch_url: string | null;
  tier: string | null;
}

export interface GaugeConversion {
  awg: number;
  mm2: number;
  diameter_inches: number | null;
  diameter_mm: number | null;
  max_amps_chassis: number | null;
  max_amps_bundle: number | null;
  typical_use: string | null;
  superseal_compatible: boolean | null;
  superseal_terminal_size: string | null;
  dtm_compatible: boolean | null;
  dtm_terminal_size: string | null;
  ev6_compatible: boolean | null;
  notes: string | null;
}

// ── Fetch ────────────────────────────────────────────────────────────

async function fetchWireCatalog() {
  const [wireRes, gaugeRes] = await Promise.all([
    supabase
      .from('wire_catalog')
      .select('*')
      .order('tier')
      .order('gauge_awg')
      .order('base_color'),
    supabase
      .from('wire_gauge_conversion')
      .select('*')
      .order('awg'),
  ]);

  if (wireRes.error) throw wireRes.error;

  return {
    products: (wireRes.data || []) as WireProduct[],
    gaugeConversion: (gaugeRes.data || []) as GaugeConversion[],
  };
}

// ── Color name normalization ─────────────────────────────────────────
// wire_catalog uses full names ("Black", "Red"), overlayCompute uses abbreviations ("BLK", "RED")

const COLOR_ABBREV_MAP: Record<string, string> = {
  'black': 'BLK', 'red': 'RED', 'white': 'WHT', 'green': 'GRN',
  'blue': 'BLU', 'yellow': 'YEL', 'orange': 'ORG', 'brown': 'BRN',
  'violet': 'VIO', 'pink': 'PNK', 'gray': 'GRY', 'grey': 'GRY',
  'tan': 'TAN', 'blk': 'BLK', 'org': 'ORG', 'grn': 'GRN',
  'blu': 'BLU', 'yel': 'YEL', 'wht': 'WHT', 'brn': 'BRN',
  'vio': 'VIO', 'pnk': 'PNK',
};

function normalizeColorAbbrev(color: string): string {
  return COLOR_ABBREV_MAP[color.toLowerCase()] || color.toUpperCase().slice(0, 3);
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useWireCatalog(tier: WireTier = 'professional') {
  const query = useQuery({
    queryKey: ['wire-catalog'],
    queryFn: fetchWireCatalog,
    staleTime: 10 * 60 * 1000,
  });

  // Filter products by tier
  const tierProducts = useMemo(() => {
    if (!query.data) return [];
    return query.data.products.filter(p => p.tier === tier);
  }, [query.data, tier]);

  // Group by gauge for quick lookup
  const byGauge = useMemo(() => {
    const map = new Map<number, WireProduct[]>();
    for (const p of tierProducts) {
      const arr = map.get(p.gauge_awg) || [];
      arr.push(p);
      map.set(p.gauge_awg, arr);
    }
    return map;
  }, [tierProducts]);

  // Available gauges in this tier
  const availableGauges = useMemo(() =>
    Array.from(byGauge.keys()).sort((a, b) => a - b),
  [byGauge]);

  // Get wire product for a circuit (gauge + color abbreviation + tier)
  function getWireForCircuit(gauge: number, colorAbbrev: string): WireProduct | undefined {
    const gaugeProducts = byGauge.get(gauge);
    if (!gaugeProducts || gaugeProducts.length === 0) return undefined;

    const normalized = normalizeColorAbbrev(colorAbbrev.split('/')[0]);
    // Try exact color match
    const match = gaugeProducts.find(p =>
      normalizeColorAbbrev(p.base_color) === normalized
    );
    if (match) return match;
    // Fall back to any product with this gauge
    return gaugeProducts[0];
  }

  // Get hex color from catalog for a wire color abbreviation + gauge
  function getWireHex(gauge: number, colorAbbrev: string): string | null {
    const product = getWireForCircuit(gauge, colorAbbrev);
    return product?.color_hex || null;
  }

  // Get price per foot for a wire
  function getWirePrice(gauge: number, colorAbbrev: string): number | null {
    const product = getWireForCircuit(gauge, colorAbbrev);
    return product?.price_per_ft ?? null;
  }

  // Calculate total wire cost for a set of wires
  function calculateTotalWireCost(wires: { gauge: number; color: string; lengthFt: number }[]): number {
    let total = 0;
    for (const w of wires) {
      const price = getWirePrice(w.gauge, w.color);
      if (price != null) total += price * w.lengthFt;
    }
    return Math.round(total * 100) / 100;
  }

  // Check terminal compatibility for a gauge + connector type
  function checkTerminalCompatibility(gauge: number, connectorType: string): {
    compatible: boolean;
    terminalSize: string | null;
    notes: string | null;
  } {
    if (!query.data) return { compatible: false, terminalSize: null, notes: null };
    const conv = query.data.gaugeConversion.find(g => g.awg === gauge);
    if (!conv) return { compatible: false, terminalSize: null, notes: 'Gauge not in conversion table' };

    const ct = connectorType.toLowerCase();
    if (ct.includes('superseal')) {
      return {
        compatible: conv.superseal_compatible || false,
        terminalSize: conv.superseal_terminal_size,
        notes: conv.superseal_compatible ? null : `${gauge}AWG not compatible with Superseal`,
      };
    }
    if (ct.includes('dtm') || ct.includes('deutsch')) {
      return {
        compatible: conv.dtm_compatible || false,
        terminalSize: conv.dtm_terminal_size,
        notes: conv.dtm_compatible ? null : `${gauge}AWG not compatible with DTM`,
      };
    }
    if (ct.includes('ev6') || ct.includes('uscar')) {
      return {
        compatible: conv.ev6_compatible || false,
        terminalSize: null,
        notes: conv.ev6_compatible ? null : `${gauge}AWG not compatible with EV6/USCAR`,
      };
    }
    return { compatible: true, terminalSize: null, notes: null };
  }

  // Get gauge conversion data
  function getGaugeInfo(awg: number): GaugeConversion | undefined {
    return query.data?.gaugeConversion.find(g => g.awg === awg);
  }

  // Tier display labels
  const tierLabel = tier === 'professional' ? 'M22759/32 Tefzel' : 'TXL Standard';

  return {
    products: tierProducts,
    allProducts: query.data?.products || [],
    gaugeConversion: query.data?.gaugeConversion || [],
    byGauge,
    availableGauges,
    isLoading: query.isLoading,
    error: query.error,
    tier,
    tierLabel,
    getWireForCircuit,
    getWireHex,
    getWirePrice,
    calculateTotalWireCost,
    checkTerminalCompatibility,
    getGaugeInfo,
  };
}
