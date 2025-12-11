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

interface ValueProvenancePopupProps {
  vehicleId: string;
  field: 'current_value' | 'sale_price' | 'purchase_price' | 'asking_price';
  value: number;
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
        .select('bat_auction_url, sale_date, bat_sale_date, updated_at, user_id, uploaded_by')
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
      if (field === 'sale_price' && vehicle?.bat_auction_url) {
        const { data: saleEvent } = await supabase
          .from('timeline_events')
          .select('event_date, cost_amount, metadata')
          .eq('vehicle_id', vehicleId)
          .eq('event_type', 'auction_sold')
          .eq('cost_amount', value)
          .order('event_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (saleEvent) {
          batAuctionInfo = {
            url: vehicle.bat_auction_url,
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
          confidence: 95,
          inserted_by: 'system',
          inserted_by_name: 'BAT Import',
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
          source_confidence: 95,
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
        background: '#fff',
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
          background: '#fff',
          border: '2px solid #000',
          minWidth: '500px',
          maxWidth: '600px',
          fontFamily: 'Arial, sans-serif'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '2px solid #000',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f5f5f5'
        }}>
          <div>
            <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
              Value Provenance
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
              ${value.toLocaleString()}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: '2px solid #000',
              background: '#fff',
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
          {/* Source */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
              Source
            </div>
            <div style={{ fontSize: '9pt', fontWeight: 'bold' }}>
              {provenance && getSourceLabel(provenance.source)}
            </div>
          </div>

          {/* Confidence */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
              Confidence
            </div>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold',
              color: getConfidenceColor(provenance?.confidence || 0)
            }}>
              {provenance?.confidence}%
            </div>
          </div>

          {/* Inserted By */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
              Inserted By
            </div>
            <div style={{ fontSize: '9pt' }}>
              {provenance?.inserted_by_name || 'Unknown'}
              <span style={{ fontSize: '7pt', color: '#999', marginLeft: '8px' }}>
                {provenance?.inserted_at && new Date(provenance.inserted_at).toLocaleString()}
              </span>
            </div>
          </div>

          {/* BAT Auction Details */}
          {(provenance?.bat_url || provenance?.lot_number) && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#f9f9f9', border: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: '7pt', color: '#666', textTransform: 'uppercase', marginBottom: '8px' }}>
                Auction Details
              </div>
              {provenance.lot_number && (
                <div style={{ fontSize: '9pt', marginBottom: '4px' }}>
                  <strong>Lot #:</strong> {provenance.lot_number}
                </div>
              )}
              {provenance.sale_date && (
                <div style={{ fontSize: '9pt', marginBottom: '4px' }}>
                  <strong>Sale Date:</strong> {new Date(provenance.sale_date).toLocaleDateString()}
                </div>
              )}
              {provenance.bat_url && (
                <div style={{ marginTop: '8px' }}>
                  <a 
                    href={provenance.bat_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{
                      fontSize: '9pt',
                      color: '#0066cc',
                      textDecoration: 'underline'
                    }}
                  >
                    View Auction Listing →
                  </a>
                </div>
              )}
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
          {evidence.length === 0 && (
            <div style={{
              padding: '12px',
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '4px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '7pt', fontWeight: 'bold', color: '#856404', marginBottom: '4px' }}>
                ⚠️ NO EVIDENCE FOUND
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
                    background: '#fff',
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
                        background: '#fff',
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

