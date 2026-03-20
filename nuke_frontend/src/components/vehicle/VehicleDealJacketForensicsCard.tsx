import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { FileWarning, CheckCircle, AlertTriangle, XCircle, HelpCircle, DollarSign, Eye } from 'lucide-react';

interface DealJacketForensics {
  image_id: string;
  analyzed_at: string;
  analyzed_by: string;
  stock_number: string;
  sold_date: string;
  buyer: string;
  sale_price: number;
  purchase_cost: number;
  total_recon: number;
  total_cost: number;
  reported_profit: number;
  profit_before_lwi?: number;
  lwi_deduction?: number;
  true_profit_estimate: number;
  expense_count: number;
  verified_expenses: number;
  suspicious_expenses: number;
  suspicious_amount: number;
  red_flag_count: number;
  trade_in?: {
    year: number;
    make: string;
    model: string;
    vin: string;
  };
}

interface FullExtraction {
  type: string;
  result: {
    deal_header: any;
    vehicle: any;
    acquisition: any;
    reconditioning: {
      line_items: ReconLine[];
      total: number;
    };
    sale: any;
    trade_in: any;
    profit: any;
    investments: any[];
    math_verification: any;
  };
  trust_analysis: {
    expense_trust: ExpenseTrust[];
    investment_trust: InvestmentTrust[];
  };
  forensic_summary: {
    headline: string;
    red_flags: string[];
    reported_profit: number;
    true_profit_estimate: number;
    validation_needed: ValidationItem[];
  };
}

interface ReconLine {
  line_number: number;
  description: string;
  amount: number;
  vendor_named: boolean;
  vendor_name?: string;
  is_round_number: boolean;
}

interface ExpenseTrust {
  line_number: number;
  description: string;
  amount: number;
  vendor?: string;
  trust: {
    level: 'verified' | 'partially_verified' | 'unverified' | 'suspicious';
    score: number;
    reasons: string[];
  };
}

interface InvestmentTrust {
  name: string;
  amount: number;
  trust: {
    level: string;
    score: number;
    reasons: string[];
  };
}

interface ValidationItem {
  description: string;
  amount: number;
  proof_needed: string;
}

const formatUSD = (v: number | null | undefined) => {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v);
};

const trustColor = (level: string) => {
  switch (level) {
    case 'verified': return 'var(--success)';
    case 'partially_verified': return 'var(--warning)';
    case 'unverified': return 'var(--warning-bright, #f97316)';
    case 'suspicious': return 'var(--error)';
    default: return 'var(--text-secondary)';
  }
};

const trustIcon = (level: string) => {
  switch (level) {
    case 'verified': return <CheckCircle size={12} color="var(--success)" />;
    case 'partially_verified': return <HelpCircle size={12} color="var(--warning)" />;
    case 'unverified': return <AlertTriangle size={12} color="var(--warning-bright, #f97316)" />;
    case 'suspicious': return <XCircle size={12} color="var(--error)" />;
    default: return <HelpCircle size={12} color="var(--text-secondary)" />;
  }
};

const trustLabel = (level: string) => {
  switch (level) {
    case 'verified': return 'Verified';
    case 'partially_verified': return 'Partial';
    case 'unverified': return 'Unverified';
    case 'suspicious': return 'Suspicious';
    default: return level;
  }
};

export default function VehicleDealJacketForensicsCard({ vehicleId }: { vehicleId: string }) {
  const [summary, setSummary] = useState<DealJacketForensics | null>(null);
  const [fullExtraction, setFullExtraction] = useState<FullExtraction | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showLineItems, setShowLineItems] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);

        // Get summary from vehicle origin_metadata
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('origin_metadata')
          .eq('id', vehicleId)
          .single();

        if (cancelled) return;

        const forensics = vehicle?.origin_metadata?.deal_jacket_forensics;
        if (!forensics) {
          setSummary(null);
          setLoading(false);
          return;
        }
        setSummary(forensics);

        // Get full extraction from vehicle_images
        if (forensics.image_id) {
          const { data: img } = await supabase
            .from('vehicle_images')
            .select('ai_extractions')
            .eq('id', forensics.image_id)
            .single();

          if (cancelled) return;

          const extraction = img?.ai_extractions?.find(
            (e: any) => e.type === 'forensic_deal_jacket'
          );
          if (extraction) setFullExtraction(extraction);
        }
      } catch (e) {
        console.error('Failed to load deal jacket forensics:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  if (loading) {
    return <div style={{ padding: 12, fontSize: '13px', color: 'var(--text-muted)' }}>Loading forensics...</div>;
  }

  if (!summary) return (
    <div style={{ padding: '8px', fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
      No deal jacket forensics available for this vehicle.
    </div>
  );

  const reconPct = summary.purchase_cost > 0
    ? Math.round((summary.total_recon / summary.purchase_cost) * 100)
    : 0;

  const rawReported = Number(summary.reported_profit);
  const rawTrue = Number(summary.true_profit_estimate);
  const profitDelta = (Number.isFinite(rawTrue) && Number.isFinite(rawReported)) ? rawTrue - rawReported : NaN;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
        <FileWarning size={14} color="var(--error)" />
        <span style={{ fontWeight: 700 }}>
          {summary.red_flag_count} red flag{summary.red_flag_count !== 1 ? 's' : ''} detected
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          &mdash; analyzed {new Date(summary.analyzed_at).toLocaleDateString()}
        </span>
      </div>

      {/* Profit Comparison */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 8,
        padding: 8,
        background: 'var(--grey-50)', fontSize: '11px'
      }}>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>REPORTED PROFIT</div>
          <div style={{ fontSize: '13px', fontWeight: 700 }}>{formatUSD(summary.reported_profit)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>ESTIMATED TRUE PROFIT</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--error)' }}>{formatUSD(summary.true_profit_estimate)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>HIDDEN PROFIT</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: Number.isFinite(profitDelta) && profitDelta > 0 ? 'var(--error)' : Number.isFinite(profitDelta) && profitDelta < 0 ? 'var(--success)' : 'inherit' }}>
            {Number.isFinite(profitDelta) ? (profitDelta >= 0 ? '+' : '') + formatUSD(profitDelta) : formatUSD(profitDelta)}
          </div>
        </div>
      </div>

      {/* Cost Breakdown Bar */}
      <div style={{ fontSize: '11px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span>Purchase: {formatUSD(summary.purchase_cost)}</span>
          <span>Recon: {formatUSD(summary.total_recon)} ({reconPct}%)</span>
          <span>Sale: {formatUSD(summary.sale_price)}</span>
        </div>
        {Number(summary.sale_price) > 0 && (
          <div style={{ height: 6, background: 'var(--grey-200)', overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${Math.min(100, (Number(summary.purchase_cost) / Number(summary.sale_price)) * 100)}%`, background: 'var(--accent)' }} />
            <div style={{ width: `${Math.min(100, (Number(summary.total_recon) / Number(summary.sale_price)) * 100)}%`, background: reconPct > 80 ? 'var(--error)' : 'var(--warning-bright, #f97316)' }} />
          </div>
        )}
      </div>

      {/* Deal Info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: '11px', color: 'var(--text-muted)' }}>
        <div>Stock: {summary.stock_number}</div>
        <div>Sold: {summary.sold_date}</div>
        <div>Buyer: {summary.buyer}</div>
        {summary.lwi_deduction ? <div style={{ color: 'var(--error)' }}>LWI deduction: {formatUSD(summary.lwi_deduction)}</div> : null}
        {summary.trade_in ? (
          <div>Trade: {summary.trade_in.year} {summary.trade_in.make} {summary.trade_in.model}</div>
        ) : null}
      </div>

      {/* Expense Trust Summary */}
      <div style={{
        display: 'flex', gap: 8, fontSize: '11px',
        padding: '4px 0',
        borderTop: '1px solid var(--border-light)',
        borderBottom: '1px solid var(--border-light)'
      }}>
        <span>{summary.expense_count} expenses:</span>
        <span style={{ color: 'var(--success)' }}>{summary.verified_expenses} verified</span>
        <span style={{ color: 'var(--error)' }}>{summary.suspicious_expenses} suspicious</span>
        <span style={{ color: 'var(--error)' }}>{formatUSD(summary.suspicious_amount)} unvalidated</span>
      </div>

      {/* Toggle Details */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-medium)', background: showDetails ? 'var(--grey-100)' : 'var(--white)',
            cursor: 'pointer'
          }}
        >
          {showDetails ? 'Hide' : 'Show'} Red Flags
        </button>
        {fullExtraction && (
          <button
            onClick={() => setShowLineItems(!showLineItems)}
            style={{
              fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-medium)', background: showLineItems ? 'var(--grey-100)' : 'var(--white)',
              cursor: 'pointer'
            }}
          >
            {showLineItems ? 'Hide' : 'Show'} Line Items
          </button>
        )}
        {summary.image_id && (
          <button
            onClick={() => {
              // Navigate to image viewer - you can customize this
              window.open(`/vehicle/${vehicleId}?image=${summary.image_id}`, '_blank');
            }}
            style={{
              fontSize: '11px', padding: '2px 8px', border: '1px solid var(--border-medium)', background: 'var(--white)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 3
            }}
          >
            <Eye size={10} /> Source
          </button>
        )}
      </div>

      {/* Red Flags */}
      {showDetails && fullExtraction?.forensic_summary?.red_flags && (
        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {fullExtraction.forensic_summary.red_flags.map((flag, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
              <AlertTriangle size={10} color="var(--error)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{flag}</span>
            </div>
          ))}

          {/* Validation Items */}
          {fullExtraction.forensic_summary.validation_needed?.length > 0 && (
            <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontWeight: 700, marginBottom: 3 }}>Proof Needed:</div>
              {fullExtraction.forensic_summary.validation_needed.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                  <span>{item.description}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{formatUSD(item.amount)} &mdash; {item.proof_needed}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Line Items with Trust Scores */}
      {showLineItems && fullExtraction?.trust_analysis?.expense_trust && (
        <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '20px 1fr 80px 80px 80px',
            gap: 4, fontWeight: 700, padding: '2px 0',
            borderBottom: '1px solid var(--border-medium)'
          }}>
            <span>#</span>
            <span>Description</span>
            <span style={{ textAlign: 'right' }}>Amount</span>
            <span>Vendor</span>
            <span>Trust</span>
          </div>
          {fullExtraction.trust_analysis.expense_trust.map((item) => (
            <div
              key={item.line_number}
              style={{
                display: 'grid', gridTemplateColumns: '20px 1fr 80px 80px 80px',
                gap: 4, padding: '2px 0',
                borderBottom: '1px solid var(--border-light)',
                background: item.trust.level === 'suspicious' ? 'color-mix(in srgb, var(--error) 5%, transparent)' : 'transparent'
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{item.line_number}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.description}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{formatUSD(item.amount)}</span>
              <span style={{ color: item.vendor ? 'var(--success)' : 'var(--text-disabled)' }}>
                {item.vendor || 'none'}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {trustIcon(item.trust.level)}
                <span style={{ color: trustColor(item.trust.level) }}>{trustLabel(item.trust.level)}</span>
              </span>
            </div>
          ))}

          {/* Investments */}
          {fullExtraction.trust_analysis.investment_trust?.map((inv, i) => (
            <div
              key={`inv-${i}`}
              style={{
                display: 'grid', gridTemplateColumns: '20px 1fr 80px 80px 80px',
                gap: 4, padding: '2px 0',
                background: 'color-mix(in srgb, var(--error) 8%, transparent)',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>$</span>
              <span style={{ fontWeight: 600 }}>INVESTMENT: {inv.name}</span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{formatUSD(inv.amount)}</span>
              <span style={{ color: 'var(--text-disabled)' }}>phantom</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {trustIcon(inv.trust.level)}
                <span style={{ color: trustColor(inv.trust.level) }}>{trustLabel(inv.trust.level)}</span>
              </span>
            </div>
          ))}

          {/* Totals */}
          <div style={{
            display: 'grid', gridTemplateColumns: '20px 1fr 80px 80px 80px',
            gap: 4, padding: '4px 0', fontWeight: 700,
            borderTop: '2px solid var(--border-dark)'
          }}>
            <span></span>
            <span>TOTAL RECONDITIONING</span>
            <span style={{ textAlign: 'right' }}>{formatUSD(fullExtraction.result.reconditioning.total)}</span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}
    </div>
  );
}
