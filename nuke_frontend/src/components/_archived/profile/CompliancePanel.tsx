import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface CompliancePanelProps {
  orgId: string;
  onNavigateTab?: (tab: 'documents' | 'licenses') => void;
}

interface LicenseRow {
  id: string;
  license_type: string;
  license_number?: string | null;
  issuing_state?: string | null;
  expiration_date?: string | null;
}

interface DocRow {
  id: string;
  document_type: string;
  title?: string | null;
  created_at: string;
}

const REQUIRED_DOCS = [
  'ein_assignment_notice',
  'state_business_license',
  'insurance_policy'
];

const CompliancePanel: React.FC<CompliancePanelProps> = ({ orgId, onNavigateTab }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);

  const soonDate = useMemo(() => new Date(Date.now() + 60 * 24 * 3600 * 1000), []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [licRes, docRes] = await Promise.all([
        supabase.from('shop_licenses')
          .select('id, license_type, license_number, issuing_state, expiration_date')
          .eq('shop_id', orgId)
          .order('expiration_date', { ascending: true }),
        supabase.from('shop_documents')
          .select('id, document_type, title, created_at')
          .eq('shop_id', orgId)
          .in('document_type', REQUIRED_DOCS)
          .order('created_at', { ascending: false })
      ]);
      if (licRes.error) throw licRes.error;
      if (docRes.error) throw docRes.error;
      setLicenses((licRes.data as LicenseRow[]) || []);
      setDocs((docRes.data as DocRow[]) || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load compliance');
      setLicenses([]);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId]);

  const hasDoc = (t: string) => docs.some(d => d.document_type === t);
  const expiring = useMemo(() => licenses.filter(l => l.expiration_date && new Date(l.expiration_date) <= soonDate), [licenses, soonDate]);

  if (loading) return <div className="text text-small text-muted">Loading compliance…</div>;
  if (error) return <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>;

  return (
    <div className="space-y-2">
      {/* Required docs checklist */}
      <div className="card">
        <div className="card-header">Required Documents</div>
        <div className="card-body">
          <div className="space-y-1">
            <div className="text">EIN Assignment: {hasDoc('ein_assignment_notice') ? '✓' : '×'}</div>
            <div className="text">State Business License: {hasDoc('state_business_license') ? '✓' : '×'}</div>
            <div className="text">Insurance Policy: {hasDoc('insurance_policy') ? '✓' : '×'}</div>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              className="button button-small"
              onClick={() => {
                if (onNavigateTab) onNavigateTab('documents');
                else window.location.assign('?tab=documents');
              }}
            >
              Upload Document
            </button>
          </div>
        </div>
      </div>

      {/* Licenses table */}
      <div className="card">
        <div className="card-header">Licenses</div>
        <div className="card-body">
          {licenses.length === 0 ? (
            <div className="text text-small text-muted">No licenses added.</div>
          ) : (
            <div className="space-y-1">
              {licenses.map(l => (
                <div key={l.id} className="text text-small" style={{ display:'flex', justifyContent:'space-between' }}>
                  <span>{l.license_type}{l.issuing_state ? ` (${l.issuing_state})` : ''}{l.license_number ? ` • ${l.license_number}` : ''}</span>
                  <span className="text text-small text-muted">{l.expiration_date ? new Date(l.expiration_date).toLocaleDateString() : '—'}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              className="button button-small"
              onClick={() => {
                if (onNavigateTab) onNavigateTab('licenses');
                else window.location.assign('?tab=licenses');
              }}
            >
              Add License
            </button>
          </div>
        </div>
      </div>

      {/* Expiring soon */}
      <div className="card">
        <div className="card-header">Expiring Soon (≤60d)</div>
        <div className="card-body">
          {expiring.length === 0 ? (
            <div className="text text-small text-muted">None</div>
          ) : (
            <div className="space-y-1">
              {expiring.map(l => (
                <div key={l.id} className="text text-small">{l.license_type}{l.issuing_state ? ` (${l.issuing_state})` : ''} — {new Date(l.expiration_date!).toLocaleDateString()}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CompliancePanel;
