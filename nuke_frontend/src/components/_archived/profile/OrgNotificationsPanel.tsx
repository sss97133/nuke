import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface OrgNotificationsPanelProps {
  orgId: string;
  isAdmin?: boolean;
  onNavigateTab?: (tab: 'documents' | 'licenses' | 'members') => void;
}

interface InviteRow { id: string; email: string; role: string; status: string; created_at: string }
interface LicenseRow { id: string; license_type: string; issuing_state?: string | null; expiration_date?: string | null }
interface DocRow { id: string; document_type: string; title?: string | null; created_at: string }

const REQUIRED_DOCS = ['ein_assignment_notice','state_business_license','insurance_policy'];

const OrgNotificationsPanel: React.FC<OrgNotificationsPanelProps> = ({ orgId, isAdmin = false, onNavigateTab }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [docs, setDocs] = useState<DocRow[]>([]);

  const soon = useMemo(() => new Date(Date.now() + 60 * 24 * 3600 * 1000), []);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const licRes = await supabase
        .from('shop_licenses')
        .select('id, license_type, issuing_state, expiration_date')
        .eq('shop_id', orgId)
        .order('expiration_date', { ascending: true });

      const docRes = await supabase
        .from('shop_documents')
        .select('id, document_type, title, created_at')
        .eq('shop_id', orgId)
        .in('document_type', REQUIRED_DOCS)
        .order('created_at', { ascending: false });

      const invRes = isAdmin
        ? await supabase
            .from('shop_invitations')
            .select('id, email, role, status, created_at')
            .eq('shop_id', orgId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
        : null;
      if (licRes.error) throw licRes.error;
      if (docRes.error) throw docRes.error;
      if (invRes && invRes.error) throw invRes.error;
      setLicenses((licRes.data as LicenseRow[]) || []);
      setDocs((docRes.data as DocRow[]) || []);
      setInvites((invRes?.data as InviteRow[]) || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load notifications');
      setInvites([]); setLicenses([]); setDocs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId, isAdmin]);

  const expiringLicenses = useMemo(() => licenses.filter(l => l.expiration_date && new Date(l.expiration_date) <= soon), [licenses, soon]);
  const missingDocs = useMemo(() => REQUIRED_DOCS.filter(t => !docs.some(d => d.document_type === t)), [docs]);

  if (loading) return <div className="text text-small text-muted">Loading notifications…</div>;
  if (error) return <div className="text text-small" style={{ color: '#b91c1c' }}>{error}</div>;

  return (
    <div className="space-y-2">
      {/* Missing required docs */}
      <div className="card">
        <div className="card-header">Missing Required Documents</div>
        <div className="card-body">
          {missingDocs.length === 0 ? (
            <div className="text text-small text-muted">All required documents present</div>
          ) : (
            <div className="space-y-1">
              {missingDocs.map(d => (<div key={d} className="text text-small">{d.split('_').join(' ')}</div>))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button className="button button-small" onClick={() => onNavigateTab ? onNavigateTab('documents') : null}>Go to Documents</button>
          </div>
        </div>
      </div>

      {/* Expiring licenses */}
      <div className="card">
        <div className="card-header">Licenses Expiring Soon (≤60d)</div>
        <div className="card-body">
          {expiringLicenses.length === 0 ? (
            <div className="text text-small text-muted">None</div>
          ) : (
            <div className="space-y-1">
              {expiringLicenses.map(l => (
                <div key={l.id} className="text text-small">{l.license_type}{l.issuing_state ? ` (${l.issuing_state})` : ''} — {new Date(l.expiration_date!).toLocaleDateString()}</div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button className="button button-small" onClick={() => onNavigateTab ? onNavigateTab('licenses') : null}>Go to Licenses</button>
          </div>
        </div>
      </div>

      {/* Pending invites */}
      {isAdmin && (
        <div className="card">
          <div className="card-header">Pending Invitations</div>
          <div className="card-body">
            {invites.length === 0 ? (
              <div className="text text-small text-muted">None</div>
            ) : (
              <div className="space-y-1">
                {invites.map(i => (
                  <div key={i.id} className="text text-small">{i.email} — {i.role} ({i.status})</div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <button className="button button-small" onClick={() => onNavigateTab ? onNavigateTab('members') : null}>Go to Members</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrgNotificationsPanel;
