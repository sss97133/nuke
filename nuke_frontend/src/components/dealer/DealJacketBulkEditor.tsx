/**
 * Deal Jacket Bulk Editor
 * Review and edit AI-parsed deal jackets before importing
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface DealJacket {
  id: string;
  image_url: string;
  parsed_data: any;
  status: string;
  confidence_score: number;
  created_at: string;
}

interface DealJacketBulkEditorProps {
  organizationId: string;
  onClose: () => void;
}

export default function DealJacketBulkEditor({ organizationId, onClose }: DealJacketBulkEditorProps) {
  const [dealJackets, setDealJackets] = useState<DealJacket[]>([]);
  const [selectedJacket, setSelectedJacket] = useState<DealJacket | null>(null);
  const [editedData, setEditedData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadDealJackets();
  }, [organizationId]);

  const loadDealJackets = async () => {
    try {
      const { data, error } = await supabase
        .from('deal_jacket_imports')
        .select('*')
        .eq('organization_id', organizationId)
        .in('status', ['parsed', 'needs_review'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDealJackets(data || []);
    } catch (error: any) {
      console.error('Error loading deal jackets:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectJacket = (jacket: DealJacket) => {
    setSelectedJacket(jacket);
    setEditedData(JSON.parse(JSON.stringify(jacket.parsed_data)));
  };

  const handleUpdateField = (path: string[], value: any) => {
    const newData = { ...editedData };
    let current = newData;
    
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) current[path[i]] = {};
      current = current[path[i]];
    }
    
    current[path[path.length - 1]] = value;
    setEditedData(newData);
  };

  const handleApprove = async () => {
    if (!selectedJacket) return;

    try {
      const { error } = await supabase
        .from('deal_jacket_imports')
        .update({
          parsed_data: editedData,
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', selectedJacket.id);

      if (error) throw error;

      alert('Deal jacket approved!');
      loadDealJackets();
      setSelectedJacket(null);
    } catch (error: any) {
      console.error('Error approving:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleReject = async () => {
    if (!selectedJacket || !confirm('Reject this deal jacket?')) return;

    try {
      const { error } = await supabase
        .from('deal_jacket_imports')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', selectedJacket.id);

      if (error) throw error;

      alert('Deal jacket rejected');
      loadDealJackets();
      setSelectedJacket(null);
    } catch (error: any) {
      console.error('Error rejecting:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleImportAll = async () => {
    if (!confirm('Import all approved deal jackets?')) return;

    setImporting(true);
    try {
      // TODO: Implement bulk import logic
      // This would create vehicles, transactions, contractor contributions, etc.
      alert('Bulk import feature coming soon!');
    } catch (error: any) {
      console.error('Error importing:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div className="card" style={{ padding: '24px' }}>
          Loading deal jackets...
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      overflow: 'auto',
      padding: '20px'
    }}>
      <div style={{
        background: 'var(--white)',
        maxWidth: '1400px',
        width: '100%',
        height: '90vh',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '4px'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ fontSize: '13pt', fontWeight: 700, margin: 0 }}>
            Deal Jacket Bulk Editor ({dealJackets.length} pending)
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleImportAll}
              disabled={importing || dealJackets.length === 0}
              className="button button-primary"
              style={{ fontSize: '9pt' }}
            >
              {importing ? 'Importing...' : 'Import All Approved'}
            </button>
            <button
              onClick={onClose}
              className="button button-secondary"
              style={{ fontSize: '9pt' }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: List of deal jackets */}
          <div style={{
            width: '300px',
            borderRight: '1px solid var(--border)',
            overflow: 'auto'
          }}>
            {dealJackets.map(jacket => (
              <div
                key={jacket.id}
                onClick={() => handleSelectJacket(jacket)}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selectedJacket?.id === jacket.id ? 'var(--gray-100)' : 'transparent'
                }}
              >
                <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '4px' }}>
                  {jacket.parsed_data?.vehicle?.year} {jacket.parsed_data?.vehicle?.make} {jacket.parsed_data?.vehicle?.model}
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  Confidence: {jacket.confidence_score}%
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  {new Date(jacket.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
            {dealJackets.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '9pt' }}>
                No deal jackets pending review
              </div>
            )}
          </div>

          {/* Right: Editor */}
          {selectedJacket ? (
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Image preview */}
              <div style={{ width: '40%', borderRight: '1px solid var(--border)', overflow: 'auto', padding: '16px' }}>
                <img
                  src={selectedJacket.image_url}
                  alt="Deal Jacket"
                  style={{ width: '100%', height: 'auto' }}
                />
              </div>

              {/* Editable data */}
              <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                <h3 style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '16px' }}>
                  Extracted Data (Edit as needed)
                </h3>

                {/* Vehicle */}
                <div style={{ marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                    Vehicle
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <input
                      className="form-input"
                      placeholder="VIN"
                      value={editedData?.vehicle?.vin || ''}
                      onChange={(e) => handleUpdateField(['vehicle', 'vin'], e.target.value)}
                      style={{ fontSize: '9pt' }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Year"
                      value={editedData?.vehicle?.year || ''}
                      onChange={(e) => handleUpdateField(['vehicle', 'year'], parseInt(e.target.value))}
                      style={{ fontSize: '9pt' }}
                    />
                    <input
                      className="form-input"
                      placeholder="Make"
                      value={editedData?.vehicle?.make || ''}
                      onChange={(e) => handleUpdateField(['vehicle', 'make'], e.target.value)}
                      style={{ fontSize: '9pt' }}
                    />
                    <input
                      className="form-input"
                      placeholder="Model"
                      value={editedData?.vehicle?.model || ''}
                      onChange={(e) => handleUpdateField(['vehicle', 'model'], e.target.value)}
                      style={{ fontSize: '9pt' }}
                    />
                  </div>
                </div>

                {/* Financial */}
                <div style={{ marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                    Financial
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Purchase Cost"
                      value={editedData?.financial?.purchase_cost || ''}
                      onChange={(e) => handleUpdateField(['financial', 'purchase_cost'], parseFloat(e.target.value))}
                      style={{ fontSize: '9pt' }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Sale Price"
                      value={editedData?.financial?.sale_price || ''}
                      onChange={(e) => handleUpdateField(['financial', 'sale_price'], parseFloat(e.target.value))}
                      style={{ fontSize: '9pt' }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Total Reconditioning"
                      value={editedData?.financial?.total_reconditioning || ''}
                      onChange={(e) => handleUpdateField(['financial', 'total_reconditioning'], parseFloat(e.target.value))}
                      style={{ fontSize: '9pt' }}
                    />
                    <input
                      className="form-input"
                      type="number"
                      placeholder="Gross Profit"
                      value={editedData?.financial?.gross_profit || ''}
                      onChange={(e) => handleUpdateField(['financial', 'gross_profit'], parseFloat(e.target.value))}
                      style={{ fontSize: '9pt' }}
                    />
                  </div>
                </div>

                {/* Raw JSON (for advanced editing) */}
                <div style={{ marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                    Raw Data (Advanced)
                  </h4>
                  <textarea
                    className="form-input"
                    value={JSON.stringify(editedData, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditedData(JSON.parse(e.target.value));
                      } catch (err) {
                        // Invalid JSON, don't update
                      }
                    }}
                    rows={20}
                    style={{ fontSize: '8pt', fontFamily: 'monospace' }}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={handleApprove}
                    className="button button-primary"
                    style={{ fontSize: '9pt' }}
                  >
                    Approve & Save
                  </button>
                  <button
                    onClick={handleReject}
                    className="button"
                    style={{ fontSize: '9pt', color: 'var(--color-danger)' }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '10pt'
            }}>
              Select a deal jacket to review
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

