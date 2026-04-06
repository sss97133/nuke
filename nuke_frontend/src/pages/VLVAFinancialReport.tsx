import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────

interface DealJacket {
  id: string;
  vehicle_id: string | null;
  stock_number: string | null;
  deal_type: string | null;
  initial_cost: number | null;
  reconditioning_total: number | null;
  sale_price_inc_doc: number | null;
  total_selling_price: number | null;
  total_initial_cost: number | null;
  total_cost: number | null;
  gross_profit: number | null;
  acquisition_date: string | null;
  sold_date: string | null;
  consignment_rate: number | null;
  notes: string | null;
  visibility: string;
}

interface VehicleInfo {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  sale_price: number | null;
}

interface BatListing {
  vehicle_id: string;
  sold_price: number | null;
  auction_end_date: string | null;
  seller_username: string | null;
  buyer_username: string | null;
}

interface DealRow extends DealJacket {
  vehicle?: VehicleInfo;
  bat?: BatListing;
}

// ─── Constants ────────────────────────────────────────────────────────────

const VLVA_ORG_ID = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';

// Operating expenses from SP2024 (not per-vehicle, stored as constants)
const OPERATING_EXPENSES = [
  { label: '707 YUCCA MORTGAGE (10 MO)', amount: 60000 },
  { label: '707 YUCCA ELECTRICITY', amount: 7000 },
  { label: '676 WELLS SHOP RENT', amount: 20000 },
  { label: '676 WELLS ELECTRICITY', amount: 5000 },
  { label: '676 WELLS DOUG RENT', amount: 7500 },
  { label: '674 WELLS SKYLAR RENT', amount: 15000 },
  { label: 'DOUG LIVING COST', amount: 20000 },
  { label: 'SKYLAR LIVING COST', amount: 20000 },
];

// "Where's the Money 2024" gap figures
const WHERES_THE_MONEY = {
  unaccounted: 63816,
  doug_other_sources: 188134,
  skylar_other_sources: 10500,
  cash_out_on_cars: 23300,
  doug_breakdown: [
    { label: 'CONSIGNMENTS (8%)', amount: 8726 },
    { label: 'RANDOM DEALS', amount: 8700 },
    { label: 'ACL FEES (5% OF ALL SALES)', amount: 14208 },
    { label: 'FLUCTUATING CAPITAL', amount: 156500 },
  ],
};

// Price UT Collection (16 vehicles from INVENTORY 2024)
const PRICE_UT_VEHICLES = [
  { num: 1, year: 1958, make: 'CHEVROLET', model: 'C10', trim: 'APACHE', color: 'WHITE', vin: null, status: null },
  { num: 2, year: 1965, make: 'CHEVROLET', model: 'C10', trim: 'CUSTOM', color: 'TEAL/WHITE', vin: null, status: null },
  { num: 3, year: 1966, make: 'CHEVROLET', model: 'C10', trim: 'CUSTOM', color: 'PEWTER/WHITE', vin: 'C1446S140169', status: 'SOLD $60K' },
  { num: 4, year: 1972, make: 'CHEVROLET', model: 'K10', trim: 'CHEYENNE SUPER', color: 'RED/WHITE', vin: 'CKE142B143858', status: 'SOLD $78.5K' },
  { num: 5, year: 1972, make: 'CHEVROLET', model: 'K10', trim: 'CUSTOM DELUXE', color: 'OCHRE (YELLOW)', vin: 'CKE142Z161636', status: 'LIQ $21.5K' },
  { num: 6, year: 1974, make: 'CHEVROLET', model: 'K20', trim: 'CHEYENNE SUPER', color: 'OCHRE/WHITE', vin: 'CKY2442103570', status: null },
  { num: 7, year: 1976, make: 'CHEVROLET', model: 'C30', trim: 'SILVERADO', color: 'GREEN/GREEN', vin: 'CCS2462153447', status: 'SOLD $63K' },
  { num: 8, year: 1977, make: 'CHEVROLET', model: 'K10', trim: 'SILVERADO', color: 'RED/TAN', vin: 'CKL147Z186644', status: 'PROJECTED $32K' },
  { num: 9, year: 1978, make: 'CHEVROLET', model: 'K20', trim: 'SCOTTSDALE', color: 'BROWN/TAN', vin: 'CKL248Z129851', status: 'PROJECTED $35K' },
  { num: 10, year: 1978, make: 'GMC', model: 'K1500', trim: 'SIERRA CLASSIC', color: 'FROST WHITE', vin: 'TKL148F714125', status: null },
  { num: 11, year: 1978, make: 'CHEVROLET', model: 'K20', trim: 'CHEYENNE', color: 'BLUE', vin: 'CKL248Z164631', status: 'SOLD $3K' },
  { num: 12, year: 1978, make: 'CHEVROLET', model: 'K10', trim: 'CHEYENNE', color: 'BROWN/TAN', vin: null, status: null },
  { num: 13, year: 1980, make: 'CHEVROLET', model: 'K30', trim: 'SILVERADO', color: 'CAMEL/TAN', vin: 'CKM34AB120952', status: 'SOLD $50K' },
  { num: 14, year: 1987, make: 'GMC', model: 'K20', trim: 'HIGH SIERRA', color: 'RED/WHITE', vin: null, status: null },
  { num: 15, year: 1988, make: 'GMC', model: 'V3500', trim: '', color: 'WHITE', vin: '1GDJV34WXJJ507422', status: null },
  { num: 16, year: null, make: 'YAMAHA', model: 'MOTORCYCLE', trim: '', color: '', vin: null, status: null },
];

// SP2024 projections vs reality
const PROJECTIONS = [
  { vehicle: '1980 K30 CREW CAB', purchase: 25000, proj_expenses: 15000, proj_sale: 110000, proj_profit: 70000, actual_sale: 49999, delta: '-55%', deltaClass: 'error' },
  { vehicle: '1987 GMC SUBURBAN', purchase: 12000, proj_expenses: 8000, proj_sale: 35000, proj_profit: 15000, actual_sale: 37250, delta: '+6%', deltaClass: 'success' },
  { vehicle: '1985 SUBURBAN', purchase: 15000, proj_expenses: 8000, proj_sale: 35000, proj_profit: 12000, actual_sale: 34000, delta: '-3%', deltaClass: 'muted' },
  { vehicle: '1979 K15', purchase: 6000, proj_expenses: 10000, proj_sale: 32000, proj_profit: 16000, actual_sale: 30000, delta: '-6%', deltaClass: 'muted' },
  { vehicle: '1978 K20', purchase: 15000, proj_expenses: 10000, proj_sale: 35000, proj_profit: 10000, actual_sale: null, delta: 'NO BAT RECORD', deltaClass: 'blank' },
  { vehicle: '1977 K10', purchase: 4000, proj_expenses: 12000, proj_sale: 32000, proj_profit: 16000, actual_sale: null, delta: 'NO BAT RECORD', deltaClass: 'blank' },
  { vehicle: '1988 SUBURBAN', purchase: 0, proj_expenses: 12000, proj_sale: 35000, proj_profit: 23000, actual_sale: null, delta: 'NO BAT RECORD', deltaClass: 'blank' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

const fmt = (amount: number | null | undefined): string => {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
};

const fmtExact = (amount: number | null | undefined): string => {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
};

const daysBetween = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const d1 = new Date(a);
  const d2 = new Date(b);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
};

const fmtDate = (d: string | null): string => {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`;
};

const vehicleName = (deal: DealRow): string => {
  const v = deal.vehicle;
  if (v && v.year) return `${v.year} ${v.make || ''} ${v.model || ''}`.trim().toUpperCase();
  // Fall back to stock number parsing
  const sn = deal.stock_number || '';
  return sn.replace(/^(SP24|INV24)-/, '').replace(/-/g, ' ').toUpperCase();
};

const sourceTag = (notes: string | null): string => {
  if (!notes) return '';
  if (notes.includes('SP2024')) return 'SP2024';
  if (notes.includes('INVENTORY 2024')) return 'INV2024';
  return '';
};

const capitalTag = (notes: string | null): { label: string; cls: string } => {
  if (!notes) return { label: '?', cls: 'blank' };
  if (notes.includes('Capital: Skylar')) return { label: 'S', cls: 's' };
  if (notes.includes('Capital: Doug')) return { label: 'D', cls: 'd' };
  if (notes.includes('Capital: Don')) return { label: 'DON', cls: 'd' };
  if (notes.includes('Capital: Laura')) return { label: 'L', cls: 'd' };
  if (notes.includes('Capital: Danny')) return { label: 'DAN', cls: 'd' };
  if (notes.includes('4-way')) return { label: '4W', cls: 's' };
  return { label: '?', cls: 'blank' };
};

const channelFromNotes = (notes: string | null): string => {
  if (!notes) return '';
  if (notes.includes('Channel: BaT')) return 'BAT';
  if (notes.includes('Channel: Off-BaT')) return 'OFF';
  if (notes.includes('BaT sale')) return 'BAT';
  return '';
};

// ─── Styles ───────────────────────────────────────────────────────────────

const s = {
  page: { background: 'var(--bg)', minHeight: '100vh', padding: 'var(--space-4)' } as React.CSSProperties,
  container: { maxWidth: '1200px', margin: '0 auto' } as React.CSSProperties,
  header: { borderBottom: '2px solid var(--border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' } as React.CSSProperties,
  h1: { fontSize: '13px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' as const, margin: 0, color: 'var(--text)' } as React.CSSProperties,
  meta: { fontSize: '8px', color: 'var(--text-secondary)', marginTop: 'var(--space-1)', textTransform: 'uppercase' as const, letterSpacing: '0.04em' } as React.CSSProperties,
  card: { background: 'var(--surface)', border: '2px solid var(--border)', marginBottom: 'var(--space-3)' } as React.CSSProperties,
  cardHeader: { padding: 'var(--space-3)', borderBottom: '2px solid var(--border)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } as React.CSSProperties,
  cardBody: { padding: 'var(--space-3)' } as React.CSSProperties,
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' } as React.CSSProperties,
  stat: { background: 'var(--surface)', border: '2px solid var(--border)', padding: 'var(--space-3)' } as React.CSSProperties,
  statLabel: { fontSize: '8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-secondary)' } as React.CSSProperties,
  statValue: { fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, marginTop: 'var(--space-1)' } as React.CSSProperties,
  statSub: { fontSize: '8px', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '9px' } as React.CSSProperties,
  th: { textAlign: 'left' as const, padding: 'var(--space-2) var(--space-3)', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary, var(--bg))' } as React.CSSProperties,
  thR: { textAlign: 'right' as const, padding: 'var(--space-2) var(--space-3)', fontSize: '8px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-secondary)', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary, var(--bg))' } as React.CSSProperties,
  td: { padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const } as React.CSSProperties,
  tdR: { padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' as const, textAlign: 'right' as const, fontFamily: 'var(--font-mono)' } as React.CSSProperties,
  totalsRow: { fontWeight: 700, borderTop: '2px solid var(--border)', borderBottom: '2px solid var(--border)', background: 'rgba(204,204,204,0.08)' } as React.CSSProperties,
  sectionLabel: { fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', marginTop: 'var(--space-5)' } as React.CSSProperties,
  sectionDesc: { fontSize: '9px', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' } as React.CSSProperties,
  divider: { border: 'none', borderTop: '2px solid var(--border)', margin: 'var(--space-6) 0' } as React.CSSProperties,
  alert: (color: string) => ({ border: `2px solid var(--${color})`, background: `var(--${color}-dim)`, padding: 'var(--space-3)', marginBottom: 'var(--space-3)' } as React.CSSProperties),
  alertTitle: { fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 'var(--space-1)' } as React.CSSProperties,
  barTrack: { height: 'var(--space-2)', background: 'var(--border)' } as React.CSSProperties,
  expLine: { display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border)', fontSize: '9px' } as React.CSSProperties,
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' } as React.CSSProperties,
  tag: (type: string) => {
    const colors: Record<string, { color: string; border: string; bg: string }> = {
      inv: { color: 'var(--info)', border: 'var(--info)', bg: 'var(--info-dim)' },
      con: { color: '#9d8bb1', border: '#9d8bb1', bg: 'rgba(157,139,177,0.12)' },
      bat: { color: 'var(--success)', border: 'var(--success)', bg: 'var(--success-dim)' },
      off: { color: 'var(--warning)', border: 'var(--warning)', bg: 'var(--warning-dim)' },
      blank: { color: 'var(--text-disabled, #656565)', border: 'var(--border)', bg: 'transparent' },
      flag: { color: 'var(--error)', border: 'var(--error)', bg: 'var(--error-dim)' },
      s: { color: 'var(--success)', border: 'var(--success)', bg: 'var(--success-dim)' },
      d: { color: 'var(--warning)', border: 'var(--warning)', bg: 'var(--warning-dim)' },
    };
    const c = colors[type] || colors.blank;
    return {
      display: 'inline-block', padding: '1px var(--space-2)', fontSize: '8px', fontWeight: 700,
      textTransform: 'uppercase' as const, letterSpacing: '0.04em',
      border: `1px solid ${c.border}`, color: c.color, background: c.bg,
    } as React.CSSProperties;
  },
  vname: { fontWeight: 700, fontSize: '10px' } as React.CSSProperties,
  vdetail: { fontSize: '8px', color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.03em' } as React.CSSProperties,
  blank: { color: 'var(--text-disabled, #656565)', fontStyle: 'italic' as const } as React.CSSProperties,
  mono: { fontFamily: 'var(--font-mono)' } as React.CSSProperties,
};

// ─── Component ────────────────────────────────────────────────────────────

const VLVAFinancialReport: React.FC = () => {
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [undocumentedBat, setUndocumentedBat] = useState<(VehicleInfo & { bat: BatListing })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Get all VLVA deal_jackets
      const { data: djData, error: djErr } = await supabase
        .from('deal_jackets')
        .select('*')
        .eq('organization_id', VLVA_ORG_ID)
        .order('sold_date', { ascending: true });

      if (djErr) throw djErr;

      // 2. Get vehicle info for linked deals
      const vehicleIds = (djData || []).map(d => d.vehicle_id).filter(Boolean);
      let vehicleMap: Record<string, VehicleInfo> = {};
      if (vehicleIds.length > 0) {
        const { data: vData } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin, sale_price')
          .in('id', vehicleIds);
        if (vData) {
          vehicleMap = Object.fromEntries(vData.map(v => [v.id, v]));
        }
      }

      // 3. Get bat_listings for those vehicles
      let batMap: Record<string, BatListing> = {};
      if (vehicleIds.length > 0) {
        const { data: bData } = await supabase
          .from('bat_listings')
          .select('vehicle_id, sold_price, auction_end_date, seller_username, buyer_username')
          .in('vehicle_id', vehicleIds);
        if (bData) {
          batMap = Object.fromEntries(bData.map(b => [b.vehicle_id, b]));
        }
      }

      // 4. Assemble deal rows
      const dealRows: DealRow[] = (djData || []).map(dj => ({
        ...dj,
        vehicle: dj.vehicle_id ? vehicleMap[dj.vehicle_id] : undefined,
        bat: dj.vehicle_id ? batMap[dj.vehicle_id] : undefined,
      }));

      setDeals(dealRows);

      // 5. Find undocumented BaT sales (VLVA vehicles with bat_listings but no deal_jacket)
      const { data: vlvaVehicles } = await supabase
        .from('vehicles')
        .select('id, year, make, model, vin, sale_price')
        .eq('origin_organization_id', VLVA_ORG_ID);

      if (vlvaVehicles) {
        const allVlvaIds = vlvaVehicles.map(v => v.id);
        const dealVehicleIds = new Set(vehicleIds);

        // Get bat_listings for VLVA vehicles without deal_jackets
        const undocIds = allVlvaIds.filter(id => !dealVehicleIds.has(id));
        if (undocIds.length > 0) {
          const { data: undocBat } = await supabase
            .from('bat_listings')
            .select('vehicle_id, sold_price, auction_end_date, seller_username, buyer_username')
            .in('vehicle_id', undocIds)
            .not('sold_price', 'is', null)
            .gt('sold_price', 0);

          if (undocBat) {
            const vMap = Object.fromEntries(vlvaVehicles.map(v => [v.id, v]));
            const rows = undocBat
              .filter(b => b.sold_price && b.sold_price > 50) // Filter out bad data like $68
              .map(b => ({ ...vMap[b.vehicle_id], bat: b }))
              .filter(r => r.year != null)
              .sort((a, b) => new Date(a.bat.auction_end_date || '').getTime() - new Date(b.bat.auction_end_date || '').getTime());
            setUndocumentedBat(rows);
          }
        }
      }

    } catch (error) {
      console.error('Error loading VLVA financial data:', error);
    } finally {
      setLoading(false);
    }
  };

  // ─── Computed Values ──────────────────────────────────────────────────

  const { inventoryDeals, consignmentDeals, preWindowDeals, sp24Deals } = useMemo(() => {
    // Filter to only SP2024/INV2024 deals (stock numbers starting with SP24 or INV24)
    const sp24 = deals.filter(d => d.stock_number?.startsWith('SP24-') || d.stock_number?.startsWith('INV24-'));
    const inv = sp24.filter(d => d.deal_type === 'sale');
    const con = sp24.filter(d => d.deal_type === 'consignment');
    const pre = deals.filter(d => d.stock_number?.startsWith('VLVA-') || d.stock_number?.startsWith('CC-'));
    return { inventoryDeals: inv, consignmentDeals: con, preWindowDeals: pre, sp24Deals: sp24 };
  }, [deals]);

  const kpis = useMemo(() => {
    const inventoryRevenue = inventoryDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0);
    const consignmentRevenue = consignmentDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0);
    const undocRevenue = undocumentedBat.reduce((sum, v) => sum + (v.bat.sold_price || 0), 0);
    const totalRevenue = inventoryRevenue + consignmentRevenue + undocRevenue;

    const documentedCost = inventoryDeals.reduce((sum, d) => sum + (d.initial_cost || 0) + (d.reconditioning_total || 0), 0);
    const documentedProfit = inventoryDeals.reduce((sum, d) => sum + (d.gross_profit || 0), 0);
    const consignmentFees = consignmentDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0) * (d.consignment_rate || 0.08), 0);

    const totalVehiclesSold = inventoryDeals.filter(d => d.sold_date).length + consignmentDeals.length + undocumentedBat.length;
    const documentedCount = inventoryDeals.filter(d => d.initial_cost != null).length + consignmentDeals.length;
    const coveragePct = totalVehiclesSold > 0 ? Math.round((documentedCount / totalVehiclesSold) * 100) : 0;

    return {
      totalRevenue, inventoryRevenue, consignmentRevenue, undocRevenue,
      documentedCost, documentedProfit, consignmentFees,
      totalVehiclesSold, documentedCount,
      undocumentedCount: undocumentedBat.length,
      coveragePct,
    };
  }, [inventoryDeals, consignmentDeals, undocumentedBat]);

  const partnerEconomics = useMemo(() => {
    const totalProfit = inventoryDeals.reduce((sum, d) => sum + (d.gross_profit || 0), 0);
    const totalSales = inventoryDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0);
    const acl = Math.round(totalSales * 0.05);
    const distributable = totalProfit - acl;
    const skylarShare = Math.round(distributable / 2);
    const dougShare = Math.round(distributable / 2);

    // Capital deployed (from notes)
    const skylarCapitalDeals = inventoryDeals.filter(d => d.notes?.includes('Capital: Skylar'));
    const skylarCapital = skylarCapitalDeals.reduce((sum, d) => sum + (d.initial_cost || 0), 0);
    const dougCapitalDeals = inventoryDeals.filter(d => d.notes?.includes('Capital: Doug'));
    const dougCapital = dougCapitalDeals.reduce((sum, d) => sum + (d.initial_cost || 0), 0);

    return { totalProfit, acl, distributable, skylarShare, dougShare, skylarCapital, dougCapital };
  }, [inventoryDeals]);

  const opexTotal = OPERATING_EXPENSES.reduce((sum, e) => sum + e.amount, 0);

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={s.page}>
        <div style={{ ...s.container, textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
          Loading financial data...
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <h1 style={s.h1}>VLVA FINANCIAL REPORT</h1>
          <div style={s.meta}>VIVA LAS VEGAS AUTOS &mdash; OCT 2023 TO PRESENT &mdash; LIVE FROM DATABASE</div>
          <div style={{ ...s.meta, marginTop: 'var(--space-1)' }}>
            SOURCES: DEAL_JACKETS DB &bull; BAT_LISTINGS DB &bull; SP2024 &bull; INVENTORY 2024.NUMBERS
          </div>
        </div>

        {/* Capital Structure */}
        <div style={{ ...s.card, borderColor: 'var(--accent, var(--text))', marginBottom: 'var(--space-4)' }}>
          <div style={s.cardHeader}>CAPITAL STRUCTURE &mdash; HOW MONEY FLOWS</div>
          <div style={s.cardBody}>
            <div style={{ fontSize: '9px', lineHeight: 2 }}>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>OPERATING PARTNERS</span><span style={s.mono}>DOUG WILLIAMS &amp; SKYLAR</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>ACL / BUSINESS FEE</span><span style={s.mono}>5% OF SALE PRICE ON ALL DEALS</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>PROFIT SPLIT (INVENTORY)</span><span style={s.mono}>(PROFIT - ACL) / 2 BETWEEN PARTNERS</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>CONSIGNMENT FEE</span><span style={s.mono}>8% OF SALE PRICE</span></div>
            </div>
            <div style={{ borderTop: '2px solid var(--border)', marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)' }}>
              <div style={{ fontSize: '8px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>CAPITAL PARTNERS (INVESTORS)</div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}><span style={s.tag('d')}>LAURA</span> &mdash; PRIMARY CAPITAL PARTNER ("BANK")</span><span style={s.mono}>7.5% &ndash; 15% RETURN</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}><span style={s.tag('d')}>DON</span> &mdash; CAPITAL ON 1988 JEEP WRANGLER</span><span style={s.mono}>$6,000</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}><span style={s.tag('s')}>SKYLAR</span> &mdash; ALSO PROVIDES CAPITAL ON DEALS</span><span style={s.mono}>{fmt(partnerEconomics.skylarCapital)} DEPLOYED</span></div>
            </div>
          </div>
        </div>

        {/* Price UT Collection */}
        <div style={{ ...s.card, marginBottom: 'var(--space-4)' }}>
          <div style={s.cardHeader}>
            PRICE, UT COLLECTION &mdash; LAURA'S CAPITAL
            <span style={{ fontWeight: 400, fontSize: '8px', color: 'var(--text-secondary)' }}>16 VEHICLES ACQUIRED 1/19/24</span>
          </div>
          <div style={{ padding: 0, overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>#</th><th style={s.th}>YEAR</th><th style={s.th}>MAKE</th><th style={s.th}>MODEL</th>
                  <th style={s.th}>TRIM</th><th style={s.th}>COLOR</th><th style={s.th}>VIN</th><th style={s.thR}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {PRICE_UT_VEHICLES.map((v, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, ...s.mono }}>{v.num}</td>
                    <td style={{ ...s.td, ...s.mono }}>{v.year || ''}</td>
                    <td style={s.td}>{v.make}</td>
                    <td style={s.td}>{v.model}</td>
                    <td style={s.td}>{v.trim}</td>
                    <td style={s.td}>{v.color}</td>
                    <td style={{ ...s.td, ...s.mono, ...(v.vin ? {} : s.blank) }}>{v.vin || '???'}</td>
                    <td style={{ ...s.td, textAlign: 'right' }}>
                      {v.status ? (
                        v.status.startsWith('SOLD') ? <span style={s.tag('bat')}>{v.status}</span> :
                        v.status.startsWith('LIQ') ? <span style={s.tag('off')}>{v.status}</span> :
                        <span style={s.blank}>{v.status}</span>
                      ) : (
                        <span style={s.blank}>???</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: 'var(--space-3)', fontSize: '9px', color: 'var(--text-secondary)' }}>
              SOURCE: INVENTORY 2024.NUMBERS "PRICE COLLECTION" SHEET. LAURA PROVIDED CAPITAL FOR ENTIRE BATCH.
            </div>
          </div>
        </div>

        {/* Evidence Coverage Alert */}
        <div style={s.alert('warning')}>
          <div style={s.alertTitle}>DATA COVERAGE: {kpis.coveragePct}% OF VEHICLES HAVE FINANCIAL DOCUMENTATION</div>
          <div style={{ fontSize: '9px', color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
            {kpis.documentedCount} of {kpis.totalVehiclesSold} sold vehicles have cost/expense data from SP2024 or INVENTORY 2024. The remaining {kpis.undocumentedCount} have only the BaT hammer price.
          </div>
          <div style={s.barTrack}>
            <div style={{ height: '100%', width: `${kpis.coveragePct}%`, background: 'var(--warning)' }} />
          </div>
        </div>

        {/* KPI Cards */}
        <div style={s.statGrid}>
          <div style={{ ...s.stat, borderColor: 'var(--success)' }}>
            <div style={s.statLabel}>TOTAL REVENUE</div>
            <div style={{ ...s.statValue, color: 'var(--success)' }}>{fmt(kpis.totalRevenue)}</div>
            <div style={s.statSub}>{kpis.totalVehiclesSold} VEHICLES SOLD</div>
          </div>
          <div style={s.stat}>
            <div style={s.statLabel}>DOCUMENTED COST BASIS</div>
            <div style={s.statValue}>{fmt(kpis.documentedCost)}</div>
            <div style={s.statSub}>{kpis.documentedCount} OF {kpis.totalVehiclesSold} HAVE DATA</div>
          </div>
          <div style={{ ...s.stat, borderColor: 'var(--success)' }}>
            <div style={s.statLabel}>DOCUMENTED PROFIT</div>
            <div style={{ ...s.statValue, color: 'var(--success)' }}>{fmt(kpis.documentedProfit)}</div>
            <div style={s.statSub}>ON {inventoryDeals.filter(d => d.gross_profit).length} DOCUMENTED DEALS</div>
          </div>
          <div style={{ ...s.stat, borderColor: 'var(--warning)' }}>
            <div style={s.statLabel}>UNDOCUMENTED</div>
            <div style={{ ...s.statValue, color: 'var(--warning)' }}>{kpis.undocumentedCount} VEHICLES</div>
            <div style={s.statSub}>{fmt(kpis.undocRevenue)} IN SALES, ZERO COST DATA</div>
          </div>
        </div>

        <div style={{ ...s.statGrid, gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div style={s.stat}>
            <div style={s.statLabel}>INVENTORY SALES</div>
            <div style={s.statValue}>{fmt(kpis.inventoryRevenue)}</div>
            <div style={s.statSub}>{inventoryDeals.length} VEHICLES &mdash; VLVA BOUGHT &amp; SOLD</div>
          </div>
          <div style={s.stat}>
            <div style={s.statLabel}>CONSIGNMENT REVENUE</div>
            <div style={s.statValue}>{fmt(kpis.consignmentRevenue)}</div>
            <div style={s.statSub}>{consignmentDeals.length} VEHICLES &mdash; 8% FEE TO VLVA</div>
          </div>
          <div style={{ ...s.stat, borderColor: 'var(--warning)' }}>
            <div style={s.statLabel}>UNCLASSIFIED</div>
            <div style={{ ...s.statValue, color: 'var(--warning)' }}>{fmt(kpis.undocRevenue)}</div>
            <div style={s.statSub}>{kpis.undocumentedCount} VEHICLES &mdash; INV OR CONSIGN UNKNOWN</div>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Inventory Sales Table */}
        <div style={s.sectionLabel}>INVENTORY SALES &mdash; VLVA-OWNED VEHICLES</div>
        <div style={s.sectionDesc}>
          Vehicles purchased with partner capital. Profit = Sale - Purchase - Expenses. ACL (5% of sale) taken off top. Remainder split 50/50.
          {' '}<span style={s.tag('s')}>S</span> SKYLAR CAPITAL{' '}
          <span style={s.tag('d')}>D</span> DOUG/OTHER CAPITAL
        </div>

        <div style={s.card}>
          <div style={s.cardHeader}>
            SP2024 + INV2024 CONFIRMED DEALS
            <span style={{ fontWeight: 400, fontSize: '8px', color: 'var(--text-secondary)' }}>{inventoryDeals.length} VEHICLES</span>
          </div>
          <div style={{ padding: 0, overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>VEHICLE</th>
                  <th style={s.th}>RECEIVED</th>
                  <th style={s.th}>SOLD</th>
                  <th style={s.th}>DAYS</th>
                  <th style={s.th}>CHANNEL</th>
                  <th style={s.thR}>PURCHASE</th>
                  <th style={s.thR}>EXPENSES</th>
                  <th style={s.thR}>SOLD</th>
                  <th style={s.thR}>PROFIT</th>
                  <th style={s.thR}>ACL 5%</th>
                  <th style={s.th}>CAP</th>
                </tr>
              </thead>
              <tbody>
                {inventoryDeals.map(deal => {
                  const name = vehicleName(deal);
                  const days = daysBetween(deal.acquisition_date, deal.sold_date);
                  const channel = channelFromNotes(deal.notes);
                  const acl = deal.sale_price_inc_doc ? Math.round(deal.sale_price_inc_doc * 0.05) : null;
                  const cap = capitalTag(deal.notes);
                  const src = sourceTag(deal.notes);

                  return (
                    <tr key={deal.id}>
                      <td style={s.td}>
                        <span style={s.vname}>{name}</span>
                        {deal.vehicle?.vin && <><br /><span style={s.vdetail}>VIN {deal.vehicle.vin}</span></>}
                        {src && <><br /><span style={{ ...s.vdetail, color: 'var(--info, #38bdf8)' }}>{src}</span></>}
                      </td>
                      <td style={{ ...s.td, ...s.mono }}>{fmtDate(deal.acquisition_date)}</td>
                      <td style={{ ...s.td, ...s.mono }}>{fmtDate(deal.sold_date)}</td>
                      <td style={{ ...s.td, ...s.mono }}>{days ?? <span style={s.blank}>&mdash;</span>}</td>
                      <td style={s.td}>
                        {channel === 'BAT' ? <span style={s.tag('bat')}>BAT</span> :
                         channel === 'OFF' ? <span style={s.tag('off')}>OFF-BAT</span> :
                         <span style={s.blank}>&mdash;</span>}
                      </td>
                      <td style={s.tdR}>{deal.initial_cost != null ? fmt(deal.initial_cost) : <span style={s.blank}>&mdash;</span>}</td>
                      <td style={s.tdR}>{deal.reconditioning_total != null ? fmt(deal.reconditioning_total) : <span style={s.blank}>&mdash;</span>}</td>
                      <td style={s.tdR}>{deal.sale_price_inc_doc != null ? fmt(deal.sale_price_inc_doc) : <span style={s.blank}>PROJ</span>}</td>
                      <td style={{ ...s.tdR, color: deal.gross_profit && deal.gross_profit > 0 ? 'var(--success)' : deal.gross_profit && deal.gross_profit < 0 ? 'var(--error)' : undefined }}>
                        {deal.gross_profit != null ? fmt(deal.gross_profit) : <span style={s.blank}>&mdash;</span>}
                      </td>
                      <td style={s.tdR}>{acl != null ? fmt(acl) : <span style={s.blank}>&mdash;</span>}</td>
                      <td style={s.td}><span style={s.tag(cap.cls)}>{cap.label}</span></td>
                    </tr>
                  );
                })}
                {inventoryDeals.length > 0 && (
                  <tr style={s.totalsRow}>
                    <td style={s.td} colSpan={5}><strong>INVENTORY TOTAL</strong></td>
                    <td style={s.tdR}>{fmt(inventoryDeals.reduce((sum, d) => sum + (d.initial_cost || 0), 0))}</td>
                    <td style={s.tdR}>{fmt(inventoryDeals.reduce((sum, d) => sum + (d.reconditioning_total || 0), 0))}</td>
                    <td style={s.tdR}>{fmt(inventoryDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0))}</td>
                    <td style={{ ...s.tdR, color: 'var(--success)' }}>{fmt(inventoryDeals.reduce((sum, d) => sum + (d.gross_profit || 0), 0))}</td>
                    <td style={s.tdR}>{fmt(Math.round(inventoryDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0) * 0.05))}</td>
                    <td style={s.td}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Consignment Sales */}
        <div style={s.sectionLabel}>CONSIGNMENT SALES</div>
        <div style={s.sectionDesc}>Vehicles VLVA did not purchase. VLVA provided listing, prep, storage. Earns 8% of sale price. All three found by Doug.</div>

        <div style={s.card}>
          <div style={s.cardHeader}>
            CONSIGNMENTS
            <span style={{ fontWeight: 400, fontSize: '8px', color: 'var(--text-secondary)' }}>{consignmentDeals.length} VEHICLES &bull; 8% FEE</span>
          </div>
          <div style={{ padding: 0, overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>VEHICLE</th>
                  <th style={s.th}>RECEIVED</th>
                  <th style={s.th}>SOLD</th>
                  <th style={s.th}>DAYS</th>
                  <th style={s.thR}>EXPENSES</th>
                  <th style={s.thR}>SALE PRICE</th>
                  <th style={s.thR}>VLVA 8% FEE</th>
                  <th style={s.th}>FINDER</th>
                </tr>
              </thead>
              <tbody>
                {consignmentDeals.map(deal => {
                  const name = vehicleName(deal);
                  const days = daysBetween(deal.acquisition_date, deal.sold_date);
                  const fee = deal.sale_price_inc_doc ? Math.round(deal.sale_price_inc_doc * 0.08) : null;
                  const src = sourceTag(deal.notes);

                  return (
                    <tr key={deal.id}>
                      <td style={s.td}>
                        <span style={s.vname}>{name}</span>
                        {deal.vehicle?.vin && <><br /><span style={s.vdetail}>VIN {deal.vehicle.vin}</span></>}
                        {src && <><br /><span style={{ ...s.vdetail, color: 'var(--info, #38bdf8)' }}>{src}</span></>}
                      </td>
                      <td style={{ ...s.td, ...s.mono }}>{fmtDate(deal.acquisition_date)}</td>
                      <td style={{ ...s.td, ...s.mono }}>{fmtDate(deal.sold_date)}</td>
                      <td style={{ ...s.td, ...s.mono }}>{days ?? ''}</td>
                      <td style={s.tdR}>{fmt(deal.reconditioning_total)}</td>
                      <td style={s.tdR}>{fmt(deal.sale_price_inc_doc)}</td>
                      <td style={{ ...s.tdR, color: 'var(--success)' }}>{fee != null ? fmt(fee) : ''}</td>
                      <td style={s.td}><span style={s.tag('d')}>D</span></td>
                    </tr>
                  );
                })}
                {consignmentDeals.length > 0 && (
                  <tr style={s.totalsRow}>
                    <td style={s.td} colSpan={4}><strong>CONSIGNMENT TOTAL</strong></td>
                    <td style={s.tdR}>{fmt(consignmentDeals.reduce((sum, d) => sum + (d.reconditioning_total || 0), 0))}</td>
                    <td style={s.tdR}>{fmt(consignmentDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0))}</td>
                    <td style={{ ...s.tdR, color: 'var(--success)' }}>{fmt(Math.round(consignmentDeals.reduce((sum, d) => sum + (d.sale_price_inc_doc || 0), 0) * 0.08))}</td>
                    <td style={s.td}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Undocumented BaT Sales */}
        <div style={s.sectionLabel}>UNDOCUMENTED BAT SALES</div>
        <div style={s.sectionDesc}>
          Sold under VivaLasVegasAutos on BaT but NO entry in SP2024 or any internal spreadsheet. Inventory vs consignment unknown. All cost data blank.
        </div>

        <div style={s.card}>
          <div style={s.cardHeader}>
            NO INTERNAL DOCS
            <span style={{ fontWeight: 400, fontSize: '8px', color: 'var(--text-secondary)' }}>
              {undocumentedBat.length} VEHICLES &bull; {fmt(kpis.undocRevenue)} TOTAL HAMMER
            </span>
          </div>
          <div style={{ padding: 0, overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>VEHICLE</th>
                  <th style={s.th}>BAT DATE</th>
                  <th style={s.thR}>HAMMER</th>
                  <th style={s.th}>BUYER</th>
                  <th style={s.thR}>ACQ COST</th>
                  <th style={s.thR}>EXPENSES</th>
                  <th style={s.thR}>PROFIT</th>
                  <th style={s.th}>TYPE</th>
                </tr>
              </thead>
              <tbody>
                {undocumentedBat.map((v, i) => (
                  <tr key={i}>
                    <td style={s.td}>
                      <span style={s.vname}>{v.year} {v.make} {v.model}</span>
                      {v.vin && <><br /><span style={s.vdetail}>VIN {v.vin}</span></>}
                    </td>
                    <td style={{ ...s.td, ...s.mono }}>{fmtDate(v.bat.auction_end_date)}</td>
                    <td style={s.tdR}>{fmt(v.bat.sold_price)}</td>
                    <td style={{ ...s.td, ...s.mono }}>{v.bat.buyer_username || <span style={s.blank}>???</span>}</td>
                    <td style={{ ...s.td, textAlign: 'right', ...s.blank }}>???</td>
                    <td style={{ ...s.td, textAlign: 'right', ...s.blank }}>???</td>
                    <td style={{ ...s.td, textAlign: 'right', ...s.blank }}>???</td>
                    <td style={s.td}><span style={s.tag('blank')}>???</span></td>
                  </tr>
                ))}
                {undocumentedBat.length > 0 && (
                  <tr style={s.totalsRow}>
                    <td style={s.td} colSpan={2}><strong>UNDOCUMENTED TOTAL</strong></td>
                    <td style={s.tdR}>{fmt(kpis.undocRevenue)}</td>
                    <td style={s.td} colSpan={5}></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Flagged: Yukon XL self-purchase */}
        <div style={{ ...s.card, borderColor: 'var(--error)' }}>
          <div style={{ ...s.cardHeader, borderBottomColor: 'var(--error)' }}>
            <span style={{ color: 'var(--error)' }}>FLAGGED TRANSACTION</span>
          </div>
          <div style={{ padding: 0 }}>
            <table style={s.table}>
              <tbody>
                <tr>
                  <td style={s.td}><span style={s.vname}>2001 GMC YUKON XL SLT 4X4</span><br /><span style={s.vdetail}>VIN 3GKGK26G11G271515</span></td>
                  <td style={{ ...s.td, ...s.mono }}>11/15/23</td>
                  <td style={s.td}><span style={s.tag('flag')}>SELF-PURCHASE</span></td>
                  <td style={s.tdR}>$22,000</td>
                  <td style={{ ...s.td, fontSize: '9px', color: 'var(--text-secondary)' }}>BUYER = VIVALASVEGASAUTOS. VLVA WON ITS OWN AUCTION. NOT REVENUE.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Partner Economics */}
        <div style={s.sectionLabel}>PARTNER ECONOMICS</div>
        <div style={s.sectionDesc}>Computed from deal_jackets. Inventory deals only.</div>

        <div style={s.cols}>
          <div style={s.card}>
            <div style={s.cardHeader}>INCOME SPLIT (INVENTORY ONLY)</div>
            <div style={s.cardBody}>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>TOTAL INVENTORY PROFIT</span><span style={s.mono}>{fmt(partnerEconomics.totalProfit)}</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>LESS: ACL (5% OF SALES)</span><span style={{ ...s.mono, color: 'var(--error)' }}>-{fmt(partnerEconomics.acl)}</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>DISTRIBUTABLE PROFIT</span><span style={s.mono}>{fmt(partnerEconomics.distributable)}</span></div>
              <div style={{ ...s.expLine, borderTop: '2px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>SKYLAR SHARE (50%)</span>
                <span style={{ ...s.mono, fontWeight: 700, color: 'var(--success)' }}>{fmt(partnerEconomics.skylarShare)}</span>
              </div>
              <div style={s.expLine}>
                <span style={{ fontWeight: 700, color: 'var(--text)' }}>DOUG SHARE (50%)</span>
                <span style={{ ...s.mono, fontWeight: 700, color: 'var(--success)' }}>{fmt(partnerEconomics.dougShare)}</span>
              </div>
            </div>
          </div>
          <div style={s.card}>
            <div style={s.cardHeader}>CAPITAL DEPLOYED &amp; RETURNS</div>
            <div style={s.cardBody}>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>SKYLAR CAPITAL IN</span><span style={s.mono}>{fmt(partnerEconomics.skylarCapital)}</span></div>
              <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>DOUG CAPITAL IN</span><span style={s.mono}>{fmt(partnerEconomics.dougCapital)}</span></div>
            </div>
          </div>
        </div>

        {/* Operating Expenses */}
        <div style={{ ...s.card, marginTop: 'var(--space-3)' }}>
          <div style={s.cardHeader}>
            2024 OPERATING EXPENSES
            <span style={{ fontWeight: 400, fontSize: '8px', color: 'var(--text-secondary)' }}>NOT SUBTRACTED FROM DEAL PROFITS &bull; SOURCE: SP2024</span>
          </div>
          <div style={s.cardBody}>
            <div style={s.cols}>
              <div>
                {OPERATING_EXPENSES.slice(0, 4).map((e, i) => (
                  <div key={i} style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>{e.label}</span><span style={s.mono}>{fmt(e.amount)}</span></div>
                ))}
              </div>
              <div>
                {OPERATING_EXPENSES.slice(4).map((e, i) => (
                  <div key={i} style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>{e.label}</span><span style={s.mono}>{fmt(e.amount)}</span></div>
                ))}
              </div>
            </div>
            <div style={{ ...s.expLine, borderTop: '2px solid var(--border)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>TOTAL 2024 OVERHEAD</span>
              <span style={{ ...s.mono, fontWeight: 700, color: 'var(--error)' }}>{fmt(opexTotal)}</span>
            </div>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Unaccounted Gap */}
        <div style={s.sectionLabel}>THE UNACCOUNTED GAP</div>
        <div style={s.sectionDesc}>From "WHERE'S THE MONEY 2024" spreadsheet</div>

        <div style={{ ...s.statGrid, gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div style={{ ...s.stat, borderColor: 'var(--error)' }}>
            <div style={s.statLabel}>UNACCOUNTED</div>
            <div style={{ ...s.statValue, color: 'var(--error)' }}>{fmt(WHERES_THE_MONEY.unaccounted)}</div>
            <div style={s.statSub}>PER YOUR SPREADSHEET</div>
          </div>
          <div style={s.stat}>
            <div style={s.statLabel}>DOUG "OTHER SOURCES"</div>
            <div style={s.statValue}>{fmt(WHERES_THE_MONEY.doug_other_sources)}</div>
            <div style={s.statSub}>CONSIGN + RANDOM + ACL + CAP</div>
          </div>
          <div style={s.stat}>
            <div style={s.statLabel}>SKYLAR "OTHER SOURCES"</div>
            <div style={s.statValue}>{fmt(WHERES_THE_MONEY.skylar_other_sources)}</div>
            <div style={s.statSub}>78 K20 $3K + 72 K10 YLW $7.5K</div>
          </div>
          <div style={{ ...s.stat, borderColor: 'var(--warning)' }}>
            <div style={s.statLabel}>CASH OUT ON CARS</div>
            <div style={{ ...s.statValue, color: 'var(--warning)' }}>{fmt(WHERES_THE_MONEY.cash_out_on_cars)}</div>
          </div>
        </div>

        <div style={s.alert('error')}>
          <div style={s.alertTitle}>DOUG'S "OTHER SOURCES" BREAKDOWN</div>
          <div style={{ fontSize: '9px' }}>
            {WHERES_THE_MONEY.doug_breakdown.map((item, i) => (
              <div key={i} style={s.expLine}>
                <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                <span style={s.mono}>{fmt(item.amount)}</span>
              </div>
            ))}
            <div style={{ ...s.expLine, borderTop: '2px solid var(--error)' }}>
              <span style={{ fontWeight: 700 }}>TOTAL</span>
              <span style={{ ...s.mono, fontWeight: 700 }}>{fmt(WHERES_THE_MONEY.doug_breakdown.reduce((s, i) => s + i.amount, 0))}</span>
            </div>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Projections vs Reality */}
        <div style={s.sectionLabel}>SP2024 PROJECTIONS VS REALITY</div>
        <div style={s.card}>
          <div style={s.cardHeader}>UNSOLD AS OF 10/5/24 &mdash; PROJECTED VS ACTUAL</div>
          <div style={{ padding: 0, overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>VEHICLE</th>
                  <th style={s.thR}>PURCHASE</th>
                  <th style={s.thR}>PROJ EXPENSES</th>
                  <th style={s.thR}>PROJ SALE</th>
                  <th style={s.thR}>PROJ PROFIT</th>
                  <th style={s.thR}>ACTUAL BAT SALE</th>
                  <th style={s.th}>DELTA</th>
                </tr>
              </thead>
              <tbody>
                {PROJECTIONS.map((p, i) => (
                  <tr key={i}>
                    <td style={{ ...s.td, ...s.vname }}>{p.vehicle}</td>
                    <td style={s.tdR}>{fmt(p.purchase)}</td>
                    <td style={s.tdR}>{fmt(p.proj_expenses)}</td>
                    <td style={s.tdR}>{fmt(p.proj_sale)}</td>
                    <td style={s.tdR}>{fmt(p.proj_profit)}</td>
                    <td style={s.tdR}>
                      {p.actual_sale != null ? fmt(p.actual_sale) : <span style={s.blank}>???</span>}
                    </td>
                    <td style={{
                      ...s.td, fontSize: '8px',
                      color: p.deltaClass === 'error' ? 'var(--error)' :
                             p.deltaClass === 'success' ? 'var(--success)' :
                             p.deltaClass === 'muted' ? 'var(--text-secondary)' :
                             'var(--text-disabled, #656565)',
                      fontStyle: p.deltaClass === 'blank' ? 'italic' : undefined,
                    }}>
                      {p.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <hr style={s.divider} />

        {/* Mystery Deal Jacket */}
        <div style={{ ...s.card, borderColor: 'var(--warning)' }}>
          <div style={{ ...s.cardHeader, borderBottomColor: 'var(--warning)' }}>
            <span style={{ color: 'var(--warning)' }}>UNIDENTIFIED DEAL JACKET: VLVA-13-0000-0534</span>
          </div>
          <div style={s.cardBody}>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>STOCK NUMBER</span><span style={s.mono}>VLVA-13-0000-0534</span></div>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>SOLD DATE</span><span style={s.mono}>JANUARY 30, 2025</span></div>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>SALE PRICE INC DOC</span><span style={s.mono}>$44,000</span></div>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>DOC FEE</span><span style={s.mono}>$250</span></div>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>TOTAL SELLING PRICE</span><span style={s.mono}>$44,250</span></div>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>GROSS PROFIT</span><span style={{ ...s.mono, color: 'var(--success)' }}>{fmtExact(3594.61)}</span></div>
            <div style={s.expLine}><span style={{ color: 'var(--text-secondary)' }}>VEHICLE</span><span style={s.blank}>NOT LINKED &mdash; WHICH CAR IS THIS?</span></div>
          </div>
        </div>

        {/* What's Missing */}
        <div style={{ ...s.card, borderColor: 'var(--accent, var(--text))', marginTop: 'var(--space-4)' }}>
          <div style={s.cardHeader}>WHAT WOULD COMPLETE THIS REPORT</div>
          <div style={{ ...s.cardBody, fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 2 }}>
            <div>1. CLASSIFY {kpis.undocumentedCount} UNDOCUMENTED VEHICLES AS INVENTORY OR CONSIGNMENT</div>
            <div>2. GET ACQUISITION COSTS FOR UNDOCUMENTED VEHICLES</div>
            <div>3. MATCH 931 DOCUMENT PHOTOS TO VEHICLES BY VIN/STOCK NUMBER</div>
            <div>4. IDENTIFY VLVA-13-0000-0534 &mdash; WHICH VEHICLE SOLD 1/30/25 FOR $44,250?</div>
            <div>5. GET BAT PAYOUT STATEMENTS FOR ACTUAL NET PROCEEDS</div>
            <div>6. RECONCILE BENTLEY &mdash; BAT SAYS $26,500, SP2024 SAYS $42,000</div>
            <div>7. ACCOUNT FOR 3 PROJECTED VEHICLES WITH NO BAT RECORD (1978 K20, 1977 K10, 1988 SUBURBAN)</div>
            <div>8. UPDATE NOV 2024 &ndash; MAR 2026 &mdash; SP2024 ONLY COVERS THROUGH 10/5/24</div>
          </div>
        </div>

        {/* Pre-Oct 2023 Deals (if any in DB) */}
        {preWindowDeals.length > 0 && (
          <>
            <hr style={s.divider} />
            <div style={s.sectionLabel}>PRE-OCT 2023 DEAL JACKETS (HISTORICAL)</div>
            <div style={s.sectionDesc}>Earlier deals in the database predating the Oct 2023 VLVA analysis window.</div>
            <div style={s.card}>
              <div style={{ padding: 0, overflowX: 'auto' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>STOCK #</th><th style={s.th}>TYPE</th><th style={s.th}>SOLD</th>
                      <th style={s.thR}>INITIAL COST</th><th style={s.thR}>SALE PRICE</th><th style={s.thR}>PROFIT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preWindowDeals.map(d => (
                      <tr key={d.id}>
                        <td style={{ ...s.td, ...s.mono }}>{d.stock_number || '&mdash;'}</td>
                        <td style={s.td}>{d.deal_type}</td>
                        <td style={{ ...s.td, ...s.mono }}>{fmtDate(d.sold_date)}</td>
                        <td style={s.tdR}>{fmt(d.initial_cost)}</td>
                        <td style={s.tdR}>{fmt(d.sale_price_inc_doc)}</td>
                        <td style={{ ...s.tdR, color: d.gross_profit && d.gross_profit > 0 ? 'var(--success)' : d.gross_profit && d.gross_profit < 0 ? 'var(--error)' : undefined }}>
                          {d.gross_profit != null ? fmtExact(d.gross_profit) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{
          fontSize: '8px', color: 'var(--text-disabled, #656565)', textAlign: 'center',
          padding: 'var(--space-6) 0', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          GENERATED LIVE FROM NUKE DATABASE &bull; DEAL_JACKETS + BAT_LISTINGS + SP2024.PDF + INVENTORY_2024.NUMBERS<br />
          ALL FIGURES SUBJECT TO VERIFICATION &bull; {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase()}
        </div>
      </div>
    </div>
  );
};

export default VLVAFinancialReport;
