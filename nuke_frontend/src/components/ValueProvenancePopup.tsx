/**
 * VALUE PROVENANCE POPUP
 * 
 * Click any value → See where it came from
 * Permission-based editing (only inserter can modify)
 * 
 * Simple, instant transparency
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { FaviconIcon } from './common/FaviconIcon';

interface ValueProvenancePopupProps {
  vehicleId: string;
  field: 'current_value' | 'sale_price' | 'purchase_price' | 'asking_price';
  value: number;
  context?: {
    platform?: string | null;
    listing_url?: string | null;
    listing_status?: string | null;
    final_price?: number | null;
    current_bid?: number | null;
    bid_count?: number | null;
    winner_name?: string | null;
    inserted_by_name?: string | null;
    inserted_at?: string | null;
    confidence?: number | null;
    evidence_url?: string | null;
    trend_pct?: number | null;
    trend_period?: string | null;
  };
  onClose: () => void;
  onUpdate?: (newValue: number) => void;
}

interface Provenance {
  source: string;
  confidence: number;
  inserted_by: string;
  inserted_by_name: string;
  inserted_at: string;
  evidence_count: number;
  can_edit: boolean;
  bat_url?: string;
  lot_number?: string;
  sale_date?: string;
}

export const ValueProvenancePopup: React.FC<ValueProvenancePopupProps> = ({
  vehicleId,
  field,
  value,
  context,
  onClose,
  onUpdate
}) => {
  const [provenance, setProvenance] = useState<Provenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState(value);
  const [evidence, setEvidence] = useState<any[]>([]);
  const [batAuctionInfo, setBatAuctionInfo] = useState<{ url?: string; lot_number?: string; sale_date?: string } | null>(null);

  useEffect(() => {
    loadProvenance();
  }, []);

  const loadProvenance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Also load vehicle data to check for BAT auction info
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('bat_auction_url, sale_date, bat_sale_date, updated_at, user_id, uploaded_by, discovery_url, origin_metadata, profile_origin')
        .eq('id', vehicleId)
        .single();
      
      // Check field_evidence for this value
      const { data: evidenceData } = await supabase
        .from('field_evidence')
        .select(`
          *,
          profiles:auth.users(raw_user_meta_data)
        `)
        .eq('vehicle_id', vehicleId)
        .eq('field_name', field)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });
      
      // Check timeline_events for sale_price from BAT auctions
      let batAuctionInfo: any = null;
      if (field === 'sale_price' && (vehicle?.bat_auction_url || vehicle?.discovery_url)) {
        const { data: saleEvent } = await supabase
          .from('timeline_events')
          .select('event_date, cost_amount, metadata')
          .eq('vehicle_id', vehicleId)
          .eq('event_type', 'auction_sold')
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (saleEvent) {
          batAuctionInfo = {
            url: vehicle.bat_auction_url || vehicle?.discovery_url,
            lot_number: saleEvent.metadata?.lot_number,
            sale_date: saleEvent.event_date || vehicle.bat_sale_date || vehicle.sale_date
          };
        }
      }
      
      setEvidence(evidenceData || []);
      
      if (evidenceData && evidenceData.length > 0) {
        const latest = evidenceData[0];
        let sourceLabel = latest.source_type;
        if (batAuctionInfo && field === 'sale_price') {
          sourceLabel = `Bring a Trailer${batAuctionInfo.lot_number ? ` (Lot #${batAuctionInfo.lot_number})` : ''}`;
        }
        
        setProvenance({
          source: sourceLabel,
          confidence: latest.source_confidence,
          inserted_by: latest.profiles?.id || 'Unknown',
          inserted_by_name: latest.profiles?.raw_user_meta_data?.username || 'Unknown',
          inserted_at: latest.created_at,
          evidence_count: evidenceData.length,
          can_edit: user?.id === latest.profiles?.id,
          bat_url: batAuctionInfo?.url,
          lot_number: batAuctionInfo?.lot_number,
          sale_date: batAuctionInfo?.sale_date
        });
        if (batAuctionInfo) setBatAuctionInfo(batAuctionInfo);
      } else if (batAuctionInfo && field === 'sale_price') {
        // No evidence but we have BAT auction info - use that as source
        setProvenance({
          source: `Bring a Trailer${batAuctionInfo.lot_number ? ` (Lot #${batAuctionInfo.lot_number})` : ''}`,
          confidence: 100,
          inserted_by: 'system',
          inserted_by_name: 'System (auction telemetry)',
          inserted_at: batAuctionInfo.sale_date || vehicle?.updated_at || new Date().toISOString(),
          evidence_count: 1,
          can_edit: false,
          bat_url: batAuctionInfo.url,
          lot_number: batAuctionInfo.lot_number,
          sale_date: batAuctionInfo.sale_date
        });
        setBatAuctionInfo(batAuctionInfo);
        // Add BAT info as evidence
        setEvidence([{
          source_type: 'bat_auction',
          proposed_value: value.toString(),
          source_confidence: 100,
          extraction_context: `Auction URL: ${batAuctionInfo.url}`,
          created_at: batAuctionInfo.sale_date || vehicle?.updated_at || new Date().toISOString()
        }]);
      } else {
        // No evidence - check who last updated vehicle
        setProvenance({
          source: 'Manual entry (no evidence)',
          confidence: 50,
          inserted_by: vehicle?.uploaded_by || vehicle?.user_id || 'Unknown',
          inserted_by_name: 'Unknown',
          inserted_at: vehicle?.updated_at || new Date().toISOString(),
          evidence_count: 0,
          can_edit: user?.id === vehicle?.uploaded_by || user?.id === vehicle?.user_id
        });
      }
    } catch (error) {
      console.error('Error loading provenance:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!provenance?.can_edit) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Update vehicle value
      const { error: vehicleError } = await supabase
        .from('vehicles')
        .update({ [field]: newValue })
        .eq('id', vehicleId);
      
      if (vehicleError) throw vehicleError;
      
      // Create evidence record
      await supabase
        .from('field_evidence')
        .insert({
          vehicle_id: vehicleId,
          field_name: field,
          proposed_value: newValue.toString(),
          source_type: 'user_input_verified',
          source_confidence: 70,
          extraction_context: `Updated by ${user?.email}`,
          status: 'accepted'
        });
      
      onUpdate?.(newValue);
      onClose();
    } catch (error: any) {
      alert('Failed to update: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'var(--surface)',
        border: '2px solid #000',
        padding: '20px',
        zIndex: 10000,
        minWidth: '400px'
      }}>
        Loading...
      </div>
    );
  }

  const getConfidenceColor = (conf: number) => {
    if (conf >= 90) return '#10b981';
    if (conf >= 75) return '#3b82f6';
    if (conf >= 60) return '#f59e0b';
    return '#ef4444';
  };

  const isAuctionResultMode = (() => {
    const status = String(context?.listing_status || '').toLowerCase();
    const platform = String(context?.platform || '').toLowerCase();
    const hasFinal = typeof context?.final_price === 'number' && Number.isFinite(context.final_price) && context.final_price > 0;
    if (field !== 'sale_price') return false;
    // Only show "auction result" when the auction is actually final (blank is better than wrong).
    const outcomeIsFinal =
      status === 'sold' ||
      status === 'ended' ||
      status === 'reserve_not_met';
    if (outcomeIsFinal && (hasFinal || (typeof context?.current_bid === 'number' && Number.isFinite(context.current_bid) && context.current_bid > 0))) {
      return true;
    }
    // Fallback: BaT timeline-event-based sale price can be treated as an auction result only when there's an explicit "sold" marker.
    if (
      status === 'sold' &&
      (platform === 'bat' || (context?.listing_url || '').includes('bringatrailer.com')) &&
      (context?.evidence_url || batAuctionInfo?.url)
    ) {
      return true;
    }
    return false;
  })();

  const auctionStatus = String(context?.listing_status || '').toLowerCase();
  const auctionPrice = (() => {
    if (!isAuctionResultMode) return null;
    if (typeof context?.final_price === 'number' && Number.isFinite(context.final_price) && context.final_price > 0) return context.final_price;
    if (typeof context?.current_bid === 'number' && Number.isFinite(context.current_bid) && context.current_bid > 0) return context.current_bid;
    return value;
  })();

  const headerValue = (() => {
    if (isAuctionResultMode) {
      const finalPrice = typeof context?.final_price === 'number' && Number.isFinite(context.final_price) && context.final_price > 0 ? context.final_price : null;
      if (finalPrice !== null) return finalPrice;
    }
    return value;
  })();

  const headerPrefix = (() => {
    if (!isAuctionResultMode) return null;
    if (auctionStatus === 'sold') return 'SOLD';
    if (auctionStatus === 'reserve_not_met') return 'WINNING BID (RNM)';
    return 'WINNING BID';
  })();

  const effectiveConfidence = (() => {
    if (typeof context?.confidence === 'number' && Number.isFinite(context.confidence)) return context.confidence;
    if (isAuctionResultMode && (context?.evidence_url || context?.listing_url)) return 100;
    if (typeof provenance?.confidence === 'number' && Number.isFinite(provenance.confidence)) return provenance.confidence;
    return 0;
  })();

  const insertedAtLabel = (() => {
    const ts = context?.inserted_at || provenance?.inserted_at;
    if (!ts) return null;
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleString();
  })();

  const getSourceLabel = (source: string) => {
    const labels: Record<string, string> = {
      'vin_checksum_valid': 'VIN Decode (Authoritative)',
      'nhtsa_vin_decode': 'NHTSA Official Data',
      'auction_result_bat': 'BaT Auction Result',
      'scraped_listing': 'Scraped Listing',
      'build_estimate_csv': 'Build Estimate CSV',
      'user_input_verified': 'User Entry',
      'receipts_validated': 'Verified Receipts',
      'Manual entry (no evidence)': 'Manual Entry (No Proof)'
    };
    return labels[source] || source;
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          minWidth: '500px',
          maxWidth: '640px',
          fontFamily: 'Arial, sans-serif',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--bg)'
        }}>
          <div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              {isAuctionResultMode ? 'Auction result' : 'Value provenance'}
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
              {isAuctionResultMode
                ? `${headerPrefix || ''} ${Number(auctionPrice ?? headerValue).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`.trim()
                : headerValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            </div>
            {isAuctionResultMode && (context?.winner_name || '').trim() ? (
              <div style={{ marginTop: 4, fontSize: '9pt', color: 'var(--text-muted)', fontWeight: 600 }}>
                Winner: {String(context?.winner_name).trim()}
              </div>
            ) : null}
          </div>
          <button
            onClick={onClose}
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              padding: '4px 12px',
              fontSize: '7pt',
              fontWeight: 'bold',
              cursor: 'pointer',
              textTransform: 'uppercase'
            }}
          >
            CLOSE
          </button>
        </div>

        {/* Provenance Info */}
        <div style={{ padding: '16px' }}>
          {/* Trend (what we think it’s worth based on price signal) */}
          {typeof context?.trend_pct === 'number' && Number.isFinite(context.trend_pct) ? (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
                Trend
              </div>
              <div style={{ fontSize: '9pt', fontWeight: 800, color: context.trend_pct >= 0 ? '#16a34a' : '#dc2626' }}>
                {context.trend_pct >= 0 ? 'UP' : 'DOWN'} {Math.abs(context.trend_pct).toFixed(1)}% {context.trend_period ? String(context.trend_period).toUpperCase() : ''}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 4 }}>
                Based on internal price signal. Open price timeline for details.
              </div>
            </div>
          ) : null}

          {/* Source */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Source
            </div>
            <div style={{ fontSize: '9pt', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              {(context?.evidence_url || provenance?.bat_url) ? (
                <FaviconIcon url={String(context?.evidence_url || provenance?.bat_url)} size={14} preserveAspectRatio={true} />
              ) : null}
              <span>
                {(() => {
                  // Prefer explicit platform label when auction telemetry is present.
                  const platform = String(context?.platform || '').toLowerCase();
                  if (platform === 'bat') return 'Bring a Trailer';
                  return provenance ? getSourceLabel(provenance.source) : 'Unknown';
                })()}
              </span>
            </div>
          </div>

          {/* Confidence */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Confidence
            </div>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold',
              color: getConfidenceColor(effectiveConfidence)
            }}>
              {effectiveConfidence}%
            </div>
          </div>

          {/* Inserted By */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
              Inserted By
            </div>
            <div style={{ fontSize: '9pt' }}>
              {context?.inserted_by_name || provenance?.inserted_by_name || 'Unknown'}
              {insertedAtLabel ? (
                <span style={{ fontSize: '7pt', color: '#999', marginLeft: '8px' }}>
                  {insertedAtLabel}
                </span>
              ) : null}
            </div>
          </div>

          {/* Evidence (at minimum, the listing URL counts as evidence for auction telemetry) */}
          {(context?.evidence_url || provenance?.bat_url) && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.6px', fontWeight: 700 }}>
                Evidence
              </div>
              <a
                href={String(context?.evidence_url || provenance?.bat_url)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '9pt', fontWeight: 700, textDecoration: 'underline' }}
              >
                Open listing
              </a>
            </div>
          )}

          {/* Evidence Count */}
          {evidence.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
                Supporting Evidence
              </div>
              <div style={{ fontSize: '9pt' }}>
                {evidence.length} source{evidence.length > 1 ? 's' : ''}
              </div>
              {evidence.length > 1 && (
                <div style={{ marginTop: '8px', maxHeight: '150px', overflowY: 'auto' }}>
                  {evidence.map((e, idx) => (
                    <div key={idx} style={{
                      padding: '6px',
                      marginBottom: '4px',
                      background: '#f9f9f9',
                      border: '1px solid #e0e0e0',
                      fontSize: '7pt'
                    }}>
                      <div style={{ fontWeight: 'bold' }}>{getSourceLabel(e.source_type)}</div>
                      <div style={{ color: '#666' }}>
                        Value: ${parseFloat(e.proposed_value).toLocaleString()} • 
                        Confidence: {e.source_confidence}%
                      </div>
                      {e.extraction_context && (
                        <div style={{ marginTop: '4px', fontStyle: 'italic' }}>
                          "{e.extraction_context}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No Evidence Warning */}
          {evidence.length === 0 && !(context?.evidence_url || provenance?.bat_url) && (
            <div style={{
              padding: '12px',
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '4px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '7pt', fontWeight: 'bold', color: '#856404', marginBottom: '4px' }}>
                NO EVIDENCE FOUND
              </div>
              <div style={{ fontSize: '7pt', color: '#856404' }}>
                This value has no supporting evidence. Upload receipts or build estimates to verify.
              </div>
            </div>
          )}

          {/* Edit Section (only if user has permission) */}
          {provenance?.can_edit && (
            <div style={{
              borderTop: '1px solid #e0e0e0',
              paddingTop: '16px',
              marginTop: '16px'
            }}>
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '2px solid #000',
                    background: 'var(--surface)',
                    fontSize: '7pt',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  EDIT VALUE
                </button>
              ) : (
                <div>
                  <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
                    New Value
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="number"
                      value={newValue}
                      onChange={(e) => setNewValue(parseFloat(e.target.value))}
                      style={{
                        flex: 1,
                        padding: '8px',
                        border: '2px solid #000',
                        fontSize: '9pt'
                      }}
                    />
                    <button
                      onClick={handleUpdate}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid #000',
                        background: '#000',
                        color: '#fff',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      SAVE
                    </button>
                    <button
                      onClick={() => {
                        setEditing(false);
                        setNewValue(value);
                      }}
                      style={{
                        padding: '8px 16px',
                        border: '2px solid #000',
                        background: 'var(--surface)',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      CANCEL
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Read-only for others */}
          {!provenance?.can_edit && (
            <div style={{
              borderTop: '1px solid #e0e0e0',
              paddingTop: '16px',
              marginTop: '16px',
              fontSize: '7pt',
              color: '#999',
              fontStyle: 'italic'
            }}>
              Only {provenance?.inserted_by_name} can edit this value
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

