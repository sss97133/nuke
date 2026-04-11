/**
 * DailyWorkOrder — Printable one-pager for a single work day.
 * Route: /work-orders/daily?vehicle_id=UUID&date=YYYY-MM-DD
 * Opens in a new tab from the DayCard popup. No auth required (data is RPC-gated).
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { optimizeImageUrl } from '../lib/imageOptimizer';
import './DailyWorkOrder.css';

// ── Helpers ──

const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDateLong = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// ── Types (mirrors DayCard.tsx) ──

interface ExpandedReceipt {
  service_provider?: { name: string; type: string; location_name: string; location_address: string } | null;
  technician?: { id: string; name: string } | null;
  customer_name?: string | null;
  work_order_title?: string | null;
  labor_detail: {
    task_name: string;
    task_category: string;
    hours: number;
    hourly_rate: number;
    total_cost: number;
    industry_standard_hours: number | null;
    difficulty_rating: number | null;
    is_comped: boolean;
    comp_reason: string | null;
    over_under_hours: number | null;
  }[];
  parts_detail: {
    part_name: string;
    part_number: string | null;
    brand: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
    supplier: string | null;
    is_comped: boolean;
    comp_reason: string | null;
  }[];
  quality?: {
    quality_rating: number;
    quality_justification: string;
    value_impact: number;
    industry_standard_comparison: any;
  } | null;
  photo_analysis?: {
    total_photos: number;
    analyzed_count: number;
    avg_condition: number | null;
    avg_quality: number | null;
    images: {
      id: string;
      image_url: string;
      thumbnail_url: string;
      caption: string | null;
      vehicle_zone: string | null;
      photo_quality_score: number | null;
      condition_score: number | null;
      is_analyzed: boolean;
    }[];
  } | null;
}

interface DailyReceipt {
  photos: { id: string; image_url: string; thumbnail_url: string; caption: string | null; area: string | null }[];
  receipts: any[];
  component_events: any[];
  line_items: any[];
  work_session: { duration_minutes: number; total_labor_cost: number; total_job_cost: number } | null;
}

interface DayCardContext {
  session_number: number;
  total_sessions: number;
  total_minutes: number;
}

interface VehicleInfo {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
}

// ══════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════

const DailyWorkOrder: React.FC = () => {
  const [params] = useSearchParams();
  const vehicleId = params.get('vehicle_id') || '';
  const date = params.get('date') || '';

  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<ExpandedReceipt | null>(null);
  const [receipt, setReceipt] = useState<DailyReceipt | null>(null);
  const [context, setContext] = useState<DayCardContext | null>(null);
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null);

  // Fetch all data in parallel
  useEffect(() => {
    if (!vehicleId || !date) { setLoading(false); return; }

    const fetchAll = async () => {
      const [expandedRes, receiptRes, contextRes, vehicleRes] = await Promise.all([
        supabase.rpc('get_day_receipt_expanded', { p_vehicle_id: vehicleId, p_date: date }),
        supabase.rpc('get_daily_work_receipt', { p_vehicle_id: vehicleId, p_date: date }),
        supabase.rpc('get_day_card_context', { p_vehicle_id: vehicleId, p_date: date }),
        supabase.from('vehicles').select('year, make, model, trim, vin').eq('id', vehicleId).single(),
      ]);

      if (expandedRes.data) {
        const d = typeof expandedRes.data === 'string' ? JSON.parse(expandedRes.data) : expandedRes.data;
        setExpanded(d);
      }
      if (receiptRes.data) {
        setReceipt(typeof receiptRes.data === 'string' ? JSON.parse(receiptRes.data) : receiptRes.data);
      }
      if (contextRes.data) {
        const d = typeof contextRes.data === 'string' ? JSON.parse(contextRes.data) : contextRes.data;
        setContext(d);
      }
      if (vehicleRes.data) {
        setVehicle(vehicleRes.data);
      }

      setLoading(false);
    };

    fetchAll();
  }, [vehicleId, date]);

  // Derived values
  const vehicleTitle = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : '—';

  const shopName = expanded?.service_provider?.name || '—';
  const shopLocation = expanded?.service_provider?.location_name || null;
  const shopAddress = expanded?.service_provider?.location_address || null;

  const customerName = expanded?.customer_name || null;
  const workTitle = expanded?.work_order_title || null;

  // Labor totals (exclude comped)
  const laborItems = expanded?.labor_detail || [];
  const laborTotal = laborItems
    .filter(l => !l.is_comped)
    .reduce((sum, l) => sum + (Number(l.total_cost) || 0), 0);

  // Parts totals (exclude comped)
  const partsItems = expanded?.parts_detail || [];
  const partsTotal = partsItems
    .filter(p => !p.is_comped)
    .reduce((sum, p) => sum + (Number(p.total_price) || 0), 0);

  const grandTotal = laborTotal + partsTotal;

  // Best 6 photos sorted by quality_score desc
  const photos = useMemo(() => {
    const analysisImages = expanded?.photo_analysis?.images || [];
    const receiptPhotos = receipt?.photos || [];

    if (analysisImages.length > 0) {
      return [...analysisImages]
        .sort((a, b) => (b.photo_quality_score || 0) - (a.photo_quality_score || 0))
        .slice(0, 6);
    }
    // Fallback to receipt photos
    return receiptPhotos.slice(0, 6);
  }, [expanded, receipt]);

  // Session info
  const sessionNumber = context ? Number(context.session_number) || 0 : 0;
  const totalSessions = context ? Number(context.total_sessions) || 0 : 0;
  const totalMinutes = context ? Number(context.total_minutes) || 0 : 0;
  const qualityRating = expanded?.quality?.quality_rating ?? null;

  const durationStr = totalMinutes > 0
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : receipt?.work_session?.duration_minutes
      ? `${Math.floor(receipt.work_session.duration_minutes / 60)}h ${receipt.work_session.duration_minutes % 60}m`
      : null;

  // ── Missing params ──
  if (!vehicleId || !date) {
    return (
      <div className="dwo-page">
        <div className="dwo-paper">
          <div className="dwo-loading">Missing vehicle_id or date parameter</div>
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="dwo-page">
        <div className="dwo-paper">
          <div className="dwo-loading">Loading work order...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dwo-page">
      {/* Action bar — not printed */}
      <div className="dwo-actions no-print">
        <button onClick={() => window.print()}>PRINT</button>
        <a href={`/vehicle/${vehicleId}?tab=build`}>BACK TO VEHICLE</a>
      </div>

      <div className="dwo-paper">
        {/* ── Header ── */}
        <div className="dwo-header">
          <div>
            <h1 className="dwo-title">DAILY WORK ORDER</h1>
            <div className="dwo-shop">
              <div className="dwo-shop-name">{shopName}</div>
              {shopLocation && <div>{shopLocation}</div>}
              {shopAddress && <div style={{ color: '#888' }}>{shopAddress}</div>}
            </div>
          </div>
          <div className="dwo-date">{fmtDateLong(date)}</div>
        </div>

        <hr className="dwo-divider" />

        {/* ── Vehicle + Customer info ── */}
        <div className="dwo-info-grid">
          <div className="dwo-info-col">
            <h3>VEHICLE</h3>
            <p>
              <strong>{vehicleTitle}</strong>
              {vehicle?.trim && <><br />{vehicle.trim}</>}
              {vehicle?.vin && <><br /><span className="dwo-vin">{vehicle.vin}</span></>}
            </p>
          </div>
          {customerName && (
            <div className="dwo-info-col">
              <h3>CUSTOMER</h3>
              <p>{customerName}</p>
            </div>
          )}
        </div>

        {/* ── Work description ── */}
        {workTitle && (
          <>
            <hr className="dwo-divider-light" />
            <div className="dwo-label">WORK PERFORMED</div>
            <p className="dwo-work-desc">{workTitle}</p>
          </>
        )}

        {/* ── Photos ── */}
        {photos.length > 0 && (
          <>
            <hr className="dwo-divider-light" />
            <div className="dwo-label">PHOTOS</div>
            <div className="dwo-photos">
              {photos.map((p: any, i: number) => (
                <img
                  key={p.id || i}
                  src={optimizeImageUrl(p.thumbnail_url || p.image_url, 'medium') || p.thumbnail_url || p.image_url}
                  alt={p.caption || `Work photo ${i + 1}`}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Labor table ── */}
        {laborItems.length > 0 && (
          <>
            <hr className="dwo-divider-light" />
            <div className="dwo-label">LABOR</div>
            <table className="dwo-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th style={{ width: 50, textAlign: 'right' }}>Hrs</th>
                  <th style={{ width: 70, textAlign: 'right' }}>Rate</th>
                  <th style={{ width: 80, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {laborItems.map((task, i) => (
                  <tr key={i} className={task.is_comped ? 'dwo-comped' : ''}>
                    <td>
                      {task.task_name}
                      {task.is_comped && <span className="dwo-comped-badge">COMPED</span>}
                    </td>
                    <td className="dwo-num">{task.hours != null ? `${Number(task.hours)}h` : '—'}</td>
                    <td className="dwo-num">{task.hourly_rate != null ? `@${fmt(Number(task.hourly_rate))}` : ''}</td>
                    <td className="dwo-num">{task.total_cost != null ? fmt(Number(task.total_cost)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dwo-table-subtotal">LABOR {fmt(laborTotal)}</div>
          </>
        )}

        {/* ── Parts table ── */}
        {partsItems.length > 0 && (
          <>
            <hr className="dwo-divider-light" />
            <div className="dwo-label">PARTS</div>
            <table className="dwo-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th style={{ width: 60 }}>Brand</th>
                  <th style={{ width: 40, textAlign: 'right' }}>Qty</th>
                  <th style={{ width: 70, textAlign: 'right' }}>Price</th>
                  <th style={{ width: 80 }}>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {partsItems.map((part, i) => (
                  <tr key={i} className={part.is_comped ? 'dwo-comped' : ''}>
                    <td>
                      {part.part_name}
                      {part.is_comped && <span className="dwo-comped-badge">COMPED</span>}
                    </td>
                    <td>{part.brand || '—'}</td>
                    <td className="dwo-num">{part.quantity}</td>
                    <td className="dwo-num">{part.total_price != null ? fmt(Number(part.total_price)) : '—'}</td>
                    <td>{part.supplier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dwo-table-subtotal">PARTS {fmt(partsTotal)}</div>
          </>
        )}

        {/* ── Totals ── */}
        {(laborItems.length > 0 || partsItems.length > 0) && (
          <>
            <hr className="dwo-divider" />
            <div className="dwo-totals">
              {laborItems.length > 0 && (
                <div className="dwo-totals-row">
                  <span>LABOR</span>
                  <span>{fmt(laborTotal)}</span>
                </div>
              )}
              {partsItems.length > 0 && (
                <div className="dwo-totals-row">
                  <span>PARTS</span>
                  <span>{fmt(partsTotal)}</span>
                </div>
              )}
              <div className="dwo-totals-row dwo-total-grand">
                <span>TOTAL</span>
                <span>{fmt(grandTotal)}</span>
              </div>
            </div>
          </>
        )}

        {/* ── Footer ── */}
        {(sessionNumber > 0 || durationStr || qualityRating != null) && (
          <>
            <hr className="dwo-divider-light" />
            <div className="dwo-footer">
              {sessionNumber > 0 && totalSessions > 0 && (
                <span>Session {sessionNumber} of {totalSessions}</span>
              )}
              {durationStr && (
                <span>{sessionNumber > 0 ? ' · ' : ''}{durationStr} logged</span>
              )}
              {qualityRating != null && (
                <span> · Quality {qualityRating}/10</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DailyWorkOrder;
