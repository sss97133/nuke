import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShopStructureBuilder } from '../components/shops/ShopStructureBuilder';
import AppLayout from '../components/layout/AppLayout';
import ActivityTimeline from '../components/profile/ActivityTimeline';
import DocumentVault from '../components/profile/DocumentVault';
import WorkSessionsPanel from '../components/profile/WorkSessionsPanel';

interface Shop {
  id: string;
  name: string;
  org_type?: string;
  website_url?: string;
  description?: string;
  logo_url?: string;
  verification_status?: string;
}

const Shops: React.FC = () => {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [primaryShopId, setPrimaryShopId] = useState<string | null>(null);
  const [counts, setCounts] = useState<{locations:number;licenses:number;departments:number;documents:number}>({locations:0, licenses:0, departments:0, documents:0});
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [teamLoading, setTeamLoading] = useState<boolean>(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [docsLoading, setDocsLoading] = useState<boolean>(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [licensesRows, setLicensesRows] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => { loadShops(); }, []);

  const loadShops = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      // For now, list shops owned by the user, relying on RLS (public shops are visible). In future, expand to memberships.
      const { data, error } = await supabase
        .from('shops')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        setShops(data);
        // Initialize primary from localStorage or default to first
        const stored = (typeof window !== 'undefined') ? window.localStorage.getItem('primaryShopId') : null;
        const exists = stored && data.some(s => s.id === stored);
        const firstId = data[0]?.id || null;
        const nextPrimary = exists ? stored! : firstId;
        setPrimaryShopId(nextPrimary);
        if (!exists && stored && typeof window !== 'undefined') {
          window.localStorage.removeItem('primaryShopId');
        }
        if (!stored && nextPrimary && typeof window !== 'undefined') {
          window.localStorage.setItem('primaryShopId', nextPrimary);
        }
      }
    } catch (error) {
      console.error('Error loading shops:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load team (members and invitations) for the primary org
  const loadTeam = async () => {
    if (!primaryShopId) { setMembers([]); setInvites([]); return; }
    try {
      setTeamLoading(true);
      setTeamError(null);
      const [memRes, invRes] = await Promise.all([
        supabase.from('shop_members').select('id, user_id, role, status, created_at').eq('shop_id', primaryShopId).order('created_at', { ascending: false }),
        supabase.from('shop_invitations').select('id, email, role, status, created_at').eq('shop_id', primaryShopId).order('created_at', { ascending: false })
      ]);
      if (memRes.error) throw memRes.error;
      if (invRes.error) throw invRes.error;
      setMembers(memRes.data || []);
      setInvites(invRes.data || []);
    } catch (e: any) {
      setTeamError(e?.message || 'Failed to load team');
      setMembers([]);
      setInvites([]);
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => { loadTeam(); }, [primaryShopId]);

  // Inline invite actions removed in favor of Members tab on Organization Profile

  // Load counts for the primary org
  const loadCounts = async () => {
    if (!primaryShopId) { setCounts({ locations:0, licenses:0, departments:0, documents:0 }); return; }
    try {
      const [loc, lic, dept, docs] = await Promise.all([
        supabase.from('shop_locations').select('*', { count: 'exact', head: true }).eq('shop_id', primaryShopId),
        supabase.from('shop_licenses').select('*', { count: 'exact', head: true }).eq('shop_id', primaryShopId),
        supabase.from('shop_departments').select('*', { count: 'exact', head: true }).eq('shop_id', primaryShopId),
        supabase.from('shop_documents').select('*', { count: 'exact', head: true }).eq('shop_id', primaryShopId)
      ]);
      setCounts({
        locations: loc.count || 0,
        licenses: lic.count || 0,
        departments: dept.count || 0,
        documents: docs.count || 0
      });
    } catch {
      setCounts({ locations:0, licenses:0, departments:0, documents:0 });
    }
  };

  useEffect(() => { loadCounts(); }, [primaryShopId]);

  const primaryShop = useMemo(() => shops.find(s => s.id === primaryShopId) || shops[0] || null, [shops, primaryShopId]);

  const makePrimary = (id: string) => {
    setPrimaryShopId(id);
    if (typeof window !== 'undefined') window.localStorage.setItem('primaryShopId', id);
  };

  const requestVerification = async (shopId: string) => {
    try {
      const reason = prompt('Reason for verification request?') || '';
      const { error } = await supabase.rpc('request_shop_verification', { p_shop_id: shopId, p_reason: reason });
      if (error) throw error;
      alert('Verification request submitted');
    } catch (e: any) {
      alert(`Failed to request verification: ${e?.message || e}`);
    }
  };

  // Creation now handled by the dedicated onboarding wizard

  // Load recent documents for primary org
  const loadDocuments = async () => {
    if (!primaryShopId) { setDocs([]); return; }
    try {
      setDocsLoading(true);
      setDocsError(null);
      const { data, error } = await supabase
        .from('shop_documents')
        .select('id, document_type, title, file_url, visibility, created_at')
        .eq('shop_id', primaryShopId)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      setDocs(data || []);
    } catch (e: any) {
      setDocs([]);
      setDocsError(e?.message || 'Failed to load documents');
    } finally {
      setDocsLoading(false);
    }
  };

  // Load vehicles for primary org
  const loadVehicles = async () => {
    if (!primaryShopId) { setVehicles([]); return; }
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin, created_at')
        .eq('owner_shop_id', primaryShopId)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      setVehicles(data || []);
    } catch {
      setVehicles([]);
    }
  };

  // Load license rows for compliance checks
  const loadLicensesForCompliance = async () => {
    if (!primaryShopId) { setLicensesRows([]); return; }
    try {
      const { data } = await supabase
        .from('shop_licenses')
        .select('id, license_type, expiration_date')
        .eq('shop_id', primaryShopId)
        .order('expiration_date', { ascending: true });
      setLicensesRows(data || []);
    } catch {
      setLicensesRows([]);
    }
  };

  useEffect(() => { loadDocuments(); loadVehicles(); loadLicensesForCompliance(); }, [primaryShopId]);

  // Document uploads handled in Organization Profile > Documents

  // Compliance helpers
  const compliance = useMemo(() => {
    const hasEIN = docs.some(d => d.document_type === 'ein_assignment_notice');
    const hasStateLic = docs.some(d => d.document_type === 'state_business_license');
    const now = new Date();
    const soon = new Date(now.getTime() + 60*24*3600*1000); // 60 days
    const expiring = licensesRows.filter((l:any) => l.expiration_date && new Date(l.expiration_date) <= soon);
    const missingCount = (hasEIN ? 0 : 1) + (hasStateLic ? 0 : 1);
    return { hasEIN, hasStateLic, expiringCount: expiring.length, missingCount };
  }, [docs, licensesRows]);

  return (
    <AppLayout>
      <div className="layout">
        <div className="container">
          <div className="main">
            <div className="section">
              <h1 className="heading-1">Organizations</h1>
              <p className="text text-muted">Manage your business organizations and team members</p>
            </div>

            {/* Organizations Hub */}
            {loading ? (
              <div className="section"><div className="text text-muted">Loading...</div></div>
            ) : shops.length === 0 ? (
              <>
                <div className="section">
                  <button 
                    className="button button-primary"
                    onClick={() => navigate('/shops/onboarding')}
                  >
                    + New Organization
                  </button>
                </div>
                <div className="section">
                  <div className="card">
                    <div className="card-body text-center">
                      <p className="text text-muted">No organizations yet.</p>
                      <p className="text text-small text-muted">Click "New Organization" to start onboarding.</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Primary Organization Hero */}
                {primaryShop && (
                  <div className="section">
                    <div className="card">
                      <div className="card-body">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="heading-3" style={{ display:'flex', gap:8, alignItems:'center' }}>
                              {primaryShop.name}
                              {primaryShop.verification_status && (
                                <span className={`badge ${primaryShop.verification_status === 'verified' ? 'badge-success' : 'badge-warning'}`}>{primaryShop.verification_status}</span>
                              )}
                            </h3>
                            {primaryShop.website_url && (
                              <a href={primaryShop.website_url} target="_blank" rel="noreferrer" className="text text-small">
                                {primaryShop.website_url}
                              </a>
                            )}
                            {primaryShop.description && (
                              <p className="text text-small text-muted" style={{ marginTop:4 }}>{primaryShop.description}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button className="button button-small" onClick={() => setSelectedShop(primaryShop)}>Manage</button>
                            <button className="button button-small" onClick={() => navigate(`/org/${primaryShop.id}`)}>View Profile</button>
                            <button className="button button-small" onClick={() => navigate(`/org/${primaryShop.id}?tab=documents`)}>Documents</button>
                            <button className="button button-small" onClick={() => navigate(`/org/${primaryShop.id}?tab=members`)}>Invite Members</button>
                            <button className="button button-small button-secondary" onClick={() => requestVerification(primaryShop.id)}>Request Verification</button>
                          </div>
                        </div>
                        {/* KPI chips */}
                        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
                          <button className="badge" onClick={()=>navigate(`/org/${primaryShop.id}?tab=locations`)}>Locations: {counts.locations}</button>
                          <button className="badge" onClick={()=>navigate(`/org/${primaryShop.id}?tab=licenses`)}>Licenses: {counts.licenses}</button>
                          <button className="badge" onClick={()=>navigate(`/org/${primaryShop.id}?tab=departments`)}>Departments: {counts.departments}</button>
                          <button className="badge" onClick={()=>navigate(`/org/${primaryShop.id}?tab=documents`)}>Documents: {counts.documents}</button>
                          <button className="badge" onClick={()=>navigate(`/org/${primaryShop.id}?tab=compliance`)}>Compliance: {compliance.missingCount} missing • {compliance.expiringCount} expiring</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions Row */}
                <div className="section" style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <button 
                    className="button button-secondary"
                    onClick={() => navigate('/shops/onboarding')}
                  >
                    + New Organization
                  </button>
                </div>

                {/* Activity Preview */}
                {primaryShopId && (
                  <div className="section">
                    <div className="card">
                      <div className="card-header"><h3 className="heading-3">Recent Activity</h3></div>
                      <div className="card-body">
                        <ActivityTimeline scope="org" id={primaryShopId as string} limit={10} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Today's Work Sessions */}
                {primaryShopId && (
                  <div className="section">
                    <div className="card">
                      <div className="card-header"><h3 className="heading-3">Today's Work Sessions</h3></div>
                      <div className="card-body">
                        <WorkSessionsPanel scope="org" id={primaryShopId as string} todayOnly={true} limit={6} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Team & Invites (compact) */}
                <div className="section">
                  <div className="card">
                    <div className="card-header"><h3 className="heading-3">Team & Invites</h3></div>
                    <div className="card-body">
                      {teamLoading && <div className="text text-small text-muted">Loading team…</div>}
                      {teamError && <div className="text text-small" style={{ color:'#b91c1c' }}>{teamError}</div>}
                      {!teamLoading && !teamError && (
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                          <div>
                            <div className="text text-small text-muted" style={{ marginBottom:6 }}>Members</div>
                            {members.length === 0 ? (
                              <div className="text text-small text-muted">No members.</div>
                            ) : (
                              <div className="space-y-1">
                                {members.slice(0,5).map(m => (
                                  <div key={m.id} className="text text-small">{m.user_id} — {m.role} ({m.status})</div>
                                ))}
                                {members.length > 5 && <div className="text text-small text-muted">+{members.length-5} more</div>}
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text text-small text-muted" style={{ marginBottom:6 }}>Pending invitations</div>
                            {invites.length === 0 ? (
                              <div className="text text-small text-muted">No pending invites.</div>
                            ) : (
                              <div className="space-y-1">
                                {invites.slice(0,5).map(inv => (
                                  <div key={inv.id} className="text text-small">{inv.email} — {inv.role} ({inv.status})</div>
                                ))}
                                {invites.length > 5 && <div className="text text-small text-muted">+{invites.length-5} more</div>}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <div style={{ marginTop:8 }}>
                        <button className="button button-small" onClick={() => navigate(`/org/${primaryShopId}?tab=members`)}>Open Members</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Documents (read-only preview) */}
                {primaryShopId && (
                  <div className="section">
                    <div className="card">
                      <div className="card-header"><h3 className="heading-3">Documents</h3></div>
                      <div className="card-body">
                        <DocumentVault scope="org" id={primaryShopId as string} allowUpload={false} />
                        <div style={{ marginTop:8 }}>
                          <button className="button button-small" onClick={() => navigate(`/org/${primaryShopId}?tab=documents`)}>Open Documents</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Compliance */}
                <div className="section">
                  <div className="card">
                    <div className="card-header"><h3 className="heading-3">Compliance</h3></div>
                    <div className="card-body">
                      <div className="grid grid-cols-3 gap-2" style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:8 }}>
                        <div className="card"><div className="card-body text-center"><div className="text">EIN Doc</div><div className="heading-3" style={{ color: compliance.hasEIN ? '#16a34a' : '#b91c1c' }}>{compliance.hasEIN ? '✓' : '×'}</div></div></div>
                        <div className="card"><div className="card-body text-center"><div className="text">State License Doc</div><div className="heading-3" style={{ color: compliance.hasStateLic ? '#16a34a' : '#b91c1c' }}>{compliance.hasStateLic ? '✓' : '×'}</div></div></div>
                        <div className="card"><div className="card-body text-center"><div className="text">Expiring Licenses (≤60d)</div><div className="heading-3">{compliance.expiringCount}</div></div></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Vehicles */}
                <div className="section">
                  <div className="card">
                    <div className="card-header"><h3 className="heading-3">Vehicles</h3></div>
                    <div className="card-body">
                      {vehicles.length === 0 ? (
                        <div className="text text-small text-muted">No vehicles linked to this organization.</div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2" style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0, 1fr))', gap:8 }}>
                          {vehicles.map(v => (
                            <div key={v.id} className="card"><div className="card-body">
                              <div className="text text-small text-bold">{v.year} {v.make} {v.model}</div>
                              <div className="text text-small text-muted">{v.vin}</div>
                            </div></div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Other Organizations */}
                {shops.length > 1 && (
                  <div className="section">
                    <h2 className="heading-2">Other Organizations</h2>
                    <div className="grid grid-cols-1 gap-3">
                      {shops.filter(s => s.id !== primaryShop?.id).map((shop) => (
                        <div key={shop.id} className="card">
                          <div className="card-body">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="heading-3">{shop.name}</h3>
                                {shop.verification_status && (
                                  <span className={`badge ${shop.verification_status === 'verified' ? 'badge-success' : 'badge-warning'}`}>
                                    {shop.verification_status}
                                  </span>
                                )}
                              </div>
                              <button className="button button-small button-secondary" onClick={() => makePrimary(shop.id)}>Make Primary</button>
                            </div>
                            {shop.website_url && (
                              <a href={shop.website_url} target="_blank" rel="noreferrer" className="text text-small">
                                {shop.website_url}
                              </a>
                            )}
                            {shop.description && (
                              <p className="text text-small text-muted">{shop.description}</p>
                            )}
                            <div className="flex gap-2">
                              <button
                                className="button button-small"
                                onClick={() => setSelectedShop(shop)}
                              >
                                Manage
                              </button>
                              <button
                                className="button button-small"
                                onClick={() => navigate(`/org/${shop.id}`)}
                              >
                                View Profile
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Shop Structure Builder Modal */}
            {selectedShop && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000
              }}>
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '8px',
                  maxWidth: '900px',
                  width: '90%',
                  maxHeight: '90vh',
                  overflow: 'auto',
                  position: 'relative'
                }}>
                  <button
                    onClick={() => setSelectedShop(null)}
                    style={{
                      position: 'absolute',
                      top: '16px',
                      right: '16px',
                      background: 'none',
                      border: 'none',
                      fontSize: '24px',
                      cursor: 'pointer',
                      color: '#6b7280',
                      zIndex: 1001
                    }}
                  >
                    ×
                  </button>
                  <ShopStructureBuilder
                    shopId={selectedShop.id}
                    shopName={selectedShop.name}
                    orgType={(selectedShop as any).business_type || selectedShop.org_type || 'shop'}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Shops;
