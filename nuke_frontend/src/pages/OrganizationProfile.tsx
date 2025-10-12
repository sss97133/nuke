import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import ActivityTimeline from '../components/profile/ActivityTimeline';
import DocumentVault from '../components/profile/DocumentVault';
import WorkSessionsPanel from '../components/profile/WorkSessionsPanel';
import CompliancePanel from '../components/profile/CompliancePanel';
import VehiclesPanel from '../components/profile/VehiclesPanel';
import LinkRequestsPanel from '../components/profile/LinkRequestsPanel';
import OrgNotificationsPanel from '../components/profile/OrgNotificationsPanel';
import ProfileShell, { type ProfileTabDef } from '../components/profile/ProfileShell';
import MembersPanel from '../components/profile/MembersPanel';
import InviteMemberModal from '../components/profile/InviteMemberModal';
import AddLicenseModal from '../components/profile/AddLicenseModal';
import AddLocationModal from '../components/profile/AddLocationModal';
import AddDepartmentModal from '../components/profile/AddDepartmentModal';
import '../design-system.css';

interface Org {
  id: string;
  name: string;
  business_type?: string | null;
  website_url?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  verification_status?: string | null;
}

interface OrgEvent {
  org_id: string;
  event_id: string;
  event_type: string;
  title: string | null;
  description: string | null;
  event_date: string | null;
  created_at: string;
  vehicle_id?: string | null;
  source_table: string;
  metadata?: any;
}

const badgeStyle: React.CSSProperties = {
  fontSize: '10px',
  padding: '2px 6px',
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: '4px',
  textTransform: 'uppercase'
};

export default function OrganizationProfile() {
  const { orgId } = useParams();
  const [org, setOrg] = useState<Org | null>(null);
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [updating, setUpdating] = useState<boolean>(false);
  const INLINE_VERIFY_ENABLED = ((import.meta as any).env?.VITE_ENABLE_INLINE_ORG_VERIFY === 'true');
  const initialTab = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = (params.get('tab') || '').toLowerCase();
      const allowed = ['overview','locations','licenses','departments','members','documents','activity','work','compliance','vehicles','notifications'];
      return (allowed.includes(t) ? (t as any) : 'overview') as 'overview'|'locations'|'licenses'|'departments'|'members'|'documents'|'activity'|'work'|'compliance'|'vehicles'|'notifications';
    } catch { return 'overview' as const; }
  })();
  const [activeTab, setActiveTab] = useState<'overview'|'locations'|'licenses'|'departments'|'members'|'documents'|'activity'|'work'|'compliance'|'vehicles'|'notifications'>(initialTab);
  const [counts, setCounts] = useState<{locations:number;licenses:number;departments:number;members:number;documents:number}>({locations:0, licenses:0, departments:0, members:0, documents:0});
  const [locations, setLocations] = useState<any[]>([]);
  const [licenses, setLicenses] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [tabLoading, setTabLoading] = useState<boolean>(false);
  const [tabError, setTabError] = useState<string | null>(null);
  const PAGE_SIZE = 50;
  const [pageLoc, setPageLoc] = useState(0);
  const [pageLic, setPageLic] = useState(0);
  const [pageDept, setPageDept] = useState(0);
  const [pageDocs, setPageDocs] = useState(0);
  const [pageMem, setPageMem] = useState(0);
  const [hasMoreLoc, setHasMoreLoc] = useState(true);
  const [hasMoreLic, setHasMoreLic] = useState(true);
  const [hasMoreDept, setHasMoreDept] = useState(true);
  const [hasMoreDocs, setHasMoreDocs] = useState(true);
  const [hasMoreMem, setHasMoreMem] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [showAddLicense, setShowAddLicense] = useState(false);
  const [openDocUploadOnce, setOpenDocUploadOnce] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [showAddDepartment, setShowAddDepartment] = useState(false);

  // Sidecar data
  const [sideExpiring, setSideExpiring] = useState<any[]>([]);
  const [sideDocs, setSideDocs] = useState<any[]>([]);
  const [sideInvites, setSideInvites] = useState<any[]>([]);

  // Keep ?tab= in sync with activeTab
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('tab', activeTab);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newUrl);
    } catch {}
  }, [activeTab]);

  useEffect(() => {
    if (!orgId) return;
    const load = async () => {
      try {
        setLoading(true);
        setErrorMsg(null);
        // Load org
        const { data: orgData, error: orgError } = await supabase
          .from('shops')
          .select('id, name, business_type, website_url, description, phone, email, verification_status')
          .eq('id', orgId)
          .single();
        if (orgError) {
          console.error('Shop load error:', orgError);
          setOrg(null);
          setErrorMsg(`Shop query failed: ${orgError.message}`);
        } else {
          setOrg(orgData as any);
        }

        // Determine if current user is admin/moderator
        try {
          const { data: authData } = await supabase.auth.getUser();
          const userId = authData.user?.id;
          if (userId) {
            // Global admin/moderator?
            const { data: prof } = await supabase
              .from('profiles')
              .select('user_type')
              .eq('id', userId)
              .single();
            let adminLike = !!prof && ['admin','moderator'].includes((prof as any).user_type);
            // Shop owner?
            if (!adminLike && orgId) {
              const { data: own } = await supabase
                .from('shops')
                .select('id')
                .eq('id', orgId)
                .eq('owner_user_id', userId)
                .single();
              if (own?.id) adminLike = true;
            }
            setIsAdmin(adminLike);
          } else {
            setIsAdmin(false);
          }
        } catch {
          setIsAdmin(false);
        }

        // Load aggregated activity (actions-first)
        const { data: evts, error: evtError } = await supabase
          .from('organization_activity_view')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .limit(200);
        if (evtError) {
          console.warn('Activity view load error:', evtError.message);
        }
        setEvents((evts as any[]) || []);
      } catch (e) {
        console.debug('org profile load error', e);
        setErrorMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [orgId]);

  // Load simple counts once org loads
  useEffect(() => {
    const loadCounts = async () => {
      if (!orgId) return;
      try {
        const [loc, lic, dept, docs] = await Promise.all([
          supabase.from('shop_locations').select('*', { count: 'exact', head: true }).eq('shop_id', orgId),
          supabase.from('shop_licenses').select('*', { count: 'exact', head: true }).eq('shop_id', orgId),
          supabase.from('shop_departments').select('*', { count: 'exact', head: true }).eq('shop_id', orgId),
          supabase.from('shop_documents').select('*', { count: 'exact', head: true }).eq('shop_id', orgId)
        ]);
        setCounts({
          locations: loc.count || 0,
          licenses: lic.count || 0,
          departments: dept.count || 0,
          members: 0,
          documents: docs.count || 0
        });
        // If admin, try to fetch members count separately to avoid policy recursion for public
        if (isAdmin) {
          const mem = await supabase.from('shop_members').select('*', { count: 'exact', head: true }).eq('shop_id', orgId);
          setCounts((c) => ({ ...c, members: mem.count || 0 }));
        }
      } catch (e: any) {
        // non-blocking; surface friendly error if permissions
        if (e?.message?.toLowerCase?.().includes('permission') || e?.message?.includes('RLS')) {
          setErrorMsg('You may not have access to some organization data.');
        }
      }
    };
    loadCounts();
  }, [orgId, isAdmin]);

  const refreshCounts = async () => {
    if (!orgId) return;
    try {
      const [loc, lic, dept, docs] = await Promise.all([
        supabase.from('shop_locations').select('*', { count: 'exact', head: true }).eq('shop_id', orgId),
        supabase.from('shop_licenses').select('*', { count: 'exact', head: true }).eq('shop_id', orgId),
        supabase.from('shop_departments').select('*', { count: 'exact', head: true }).eq('shop_id', orgId),
        supabase.from('shop_documents').select('*', { count: 'exact', head: true }).eq('shop_id', orgId)
      ]);
      setCounts({
        locations: loc.count || 0,
        licenses: lic.count || 0,
        departments: dept.count || 0,
        members: counts.members,
        documents: docs.count || 0
      });
    } catch {}
  };

  // Load sidecar widgets (expiring licenses, recent docs, open invites)
  useEffect(() => {
    const loadSidecar = async () => {
      if (!orgId) { setSideExpiring([]); setSideDocs([]); setSideInvites([]); return; }
      try {
        // Expiring licenses within 60 days
        const soon = new Date(Date.now() + 60 * 24 * 3600 * 1000);
        const { data: lic } = await supabase
          .from('shop_licenses')
          .select('id, license_type, expiration_date')
          .eq('shop_id', orgId)
          .order('expiration_date', { ascending: true })
          .limit(20);
        const expiring = (lic || []).filter((l: any) => l.expiration_date && new Date(l.expiration_date) <= soon);
        setSideExpiring(expiring);

        // Recent documents
        const { data: docs } = await supabase
          .from('shop_documents')
          .select('id, document_type, title, created_at')
          .eq('shop_id', orgId)
          .order('created_at', { ascending: false })
          .limit(5);
        setSideDocs(docs || []);

        // Open invites (admin only)
        if (isAdmin) {
          const { data: inv } = await supabase
            .from('shop_invitations')
            .select('id, email, role, status, created_at')
            .eq('shop_id', orgId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(5);
          setSideInvites(inv || []);
        } else {
          setSideInvites([]);
        }
      } catch {
        setSideExpiring([]); setSideDocs([]); if (isAdmin) setSideInvites([]);
      }
    };
    loadSidecar();
  }, [orgId, isAdmin]);

  const loadTab = async (tab: typeof activeTab) => {
    if (!orgId) return;
    setActiveTab(tab);
    setTabError(null);
    setTabLoading(true);
    try {
      if (tab === 'locations') {
        const from = pageLoc * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase.from('shop_locations').select('*').eq('shop_id', orgId).order('created_at', { ascending: false }).range(from, to);
        if (error) throw error; setLocations(data || []); setHasMoreLoc((data?.length || 0) === PAGE_SIZE);
      } else if (tab === 'licenses') {
        const from = pageLic * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase.from('shop_licenses').select('*').eq('shop_id', orgId).order('created_at', { ascending: false }).range(from, to);
        if (error) throw error; setLicenses(data || []); setHasMoreLic((data?.length || 0) === PAGE_SIZE);
      } else if (tab === 'departments') {
        const from = pageDept * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase.from('shop_departments').select('*').eq('shop_id', orgId).order('created_at', { ascending: false }).range(from, to);
        if (error) throw error; setDepartments(data || []); setHasMoreDept((data?.length || 0) === PAGE_SIZE);
      } else if (tab === 'members') {
        if (!isAdmin) { setMembers([]); setTabError('Admin only'); setTabLoading(false); return; }
        const from = pageMem * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase.from('shop_members').select('id, user_id, role, status, created_at').eq('shop_id', orgId).order('created_at', { ascending: false }).range(from, to);
        if (error) throw error; setMembers(data || []); setHasMoreMem((data?.length || 0) === PAGE_SIZE);
      } else if (tab === 'documents') {
        const from = pageDocs * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await supabase.from('shop_documents').select('id, document_type, title, file_url, created_at').eq('shop_id', orgId).order('created_at', { ascending: false }).range(from, to);
        if (error) throw error; setDocuments(data || []); setHasMoreDocs((data?.length || 0) === PAGE_SIZE);
      }
    } catch (e: any) {
      setTabError(e?.message || String(e));
    } finally {
      setTabLoading(false);
    }
  };

  const verificationBadge = org?.verification_status
    ? (() => {
        const v = org.verification_status as string;
        const color = v === 'verified' ? '#16a34a' : v === 'pending' ? '#ca8a04' : '#6b7280';
        return <span style={{ ...badgeStyle, color }}>{v}</span>;
      })()
    : null;

  if (loading) {
    return (
      <AppLayout>
        <div className="container compact">
          <div className="main">
            <div className="card"><div className="card-body">Loading organization…</div></div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!org) {
    return (
      <AppLayout>
        <div className="container compact">
          <div className="main">
            <div className="card">
              <div className="card-body">
                Organization not found.
                {errorMsg && (
                  <div className="text text-small text-muted" style={{ marginTop: 8 }}>
                    {errorMsg}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const tabs: ProfileTabDef[] = (() => {
    const t: ProfileTabDef[] = [
      { key: 'overview', label: 'Overview' },
      { key: 'activity', label: 'Activity' },
      { key: 'documents', label: 'Documents', badge: counts.documents },
    ];
    if (isAdmin) t.push({ key: 'members', label: 'Members', badge: counts.members });
    t.push({ key: 'licenses', label: 'Licenses', badge: counts.licenses });
    t.push({ key: 'locations', label: 'Locations', badge: counts.locations });
    t.push({ key: 'departments', label: 'Departments', badge: counts.departments });
    t.push({ key: 'work', label: 'Work Sessions' });
    t.push({ key: 'compliance', label: 'Compliance' });
    t.push({ key: 'vehicles', label: 'Vehicles' });
    t.push({ key: 'notifications', label: 'Notifications' });
    return t;
  })();

  const header = (
    <div>
      <div className="heading-1" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {org.name}
        {verificationBadge}
      </div>
      {org.website_url && (
        <a className="text" href={org.website_url} target="_blank" rel="noreferrer">{org.website_url}</a>
      )}
      {org.description && (
        <p className="text text-muted" style={{ marginTop: 6 }}>{org.description}</p>
      )}

      <div style={{ display:'flex', gap:6, marginTop:8, flexWrap:'wrap' }}>
        <button className="button button-small" onClick={() => { setOpenDocUploadOnce(true); setActiveTab('documents'); }}>Upload Document</button>
        <button
          className="button button-small"
          disabled={!isAdmin}
          title={isAdmin ? '' : 'Admins only'}
          onClick={() => setShowInvite(true)}
        >Invite Member</button>
        <button
          className="button button-small"
          disabled={!isAdmin}
          title={isAdmin ? '' : 'Admins only'}
          onClick={() => setShowAddLicense(true)}
        >Add License</button>
        <button
          className="button button-small"
          disabled={!isAdmin}
          title={isAdmin ? '' : 'Admins only'}
          onClick={() => setShowAddLocation(true)}
        >Add Location</button>
        <button
          className="button button-small"
          disabled={!isAdmin}
          title={isAdmin ? '' : 'Admins only'}
          onClick={() => setShowAddDepartment(true)}
        >Add Department</button>
      </div>

      {isAdmin && INLINE_VERIFY_ENABLED && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="text text-small text-muted">Admin controls:</span>
          {org.verification_status !== 'verified' ? (
            <button
              className="button button-small button-success"
              disabled={updating}
              onClick={async () => {
                if (!orgId) return;
                setUpdating(true);
                const { error } = await supabase.from('shops').update({ verification_status: 'verified' }).eq('id', orgId);
                if (error) alert(`Failed to verify: ${error.message}`);
                else setOrg((prev) => prev ? { ...prev, verification_status: 'verified' } : prev);
                setUpdating(false);
              }}
            >
              {updating ? 'Verifying…' : 'Verify Organization'}
            </button>
          ) : (
            <button
              className="button button-small button-secondary"
              disabled={updating}
              onClick={async () => {
                if (!orgId) return;
                setUpdating(true);
                const { error } = await supabase.from('shops').update({ verification_status: 'unverified' }).eq('id', orgId);
                if (error) alert(`Failed to revoke: ${error.message}`);
                else setOrg((prev) => prev ? { ...prev, verification_status: 'unverified' } : prev);
                setUpdating(false);
              }}
            >
              {updating ? 'Updating…' : 'Revoke Verification'}
            </button>
          )}
        </div>
      )}
    </div>
  );

  const sidecar = (
    <>
      {/* Expiring licenses */}
      <div className="card">
        <div className="card-header">Expiring Licenses (≤60d)</div>
        <div className="card-body">
          {sideExpiring.length === 0 ? (
            <div className="text text-small text-muted">None</div>
          ) : (
            <div className="space-y-1">
              {sideExpiring.map((l:any) => (
                <div key={l.id} className="text text-small">{l.license_type} — {new Date(l.expiration_date).toLocaleDateString()}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent documents */}
      <div className="card">
        <div className="card-header">Recent Documents</div>
        <div className="card-body">
          {sideDocs.length === 0 ? (
            <div className="text text-small text-muted">No documents</div>
          ) : (
            <div className="space-y-1">
              {sideDocs.map((d:any) => (
                <div key={d.id} className="text text-small">{d.document_type} — {d.title || 'Untitled'}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Open invites */}
      {isAdmin && (
        <div className="card">
          <div className="card-header">Open Invites</div>
          <div className="card-body">
            {sideInvites.length === 0 ? (
              <div className="text text-small text-muted">None</div>
            ) : (
              <div className="space-y-1">
                {sideInvites.map((inv:any) => (
                  <div key={inv.id} className="text text-small">{inv.email} — {inv.role}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Today's Work Sessions */}
      <div className="card">
        <div className="card-header">Today's Work Sessions</div>
        <div className="card-body">
          <WorkSessionsPanel scope="org" id={orgId as string} todayOnly={true} limit={6} />
        </div>
      </div>
    </>
  );

  return (
    <AppLayout>
      <div className="layout compact">
        <div className="container compact">
          <div className="main">
            <ProfileShell
              tabs={tabs}
              activeKey={activeTab}
              onChange={(key) => {
                if (key === 'activity' || key === 'overview' || key === 'work' || key === 'compliance' || key === 'vehicles' || key === 'notifications') setActiveTab(key as any);
                else loadTab(key as any);
              }}
              header={header}
              sidecar={sidecar}
            >
              {/* Main tab content */}
              {activeTab === 'overview' && (
                <>
                  {/* KPI strip */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                    <span className="badge">Locations: {counts.locations}</span>
                    <span className="badge">Licenses: {counts.licenses}</span>
                    <span className="badge">Departments: {counts.departments}</span>
                    <span className="badge">Documents: {counts.documents}</span>
                    {isAdmin && <span className="badge">Members: {counts.members}</span>}
                  </div>

                  {/* Activity preview */}
                  <div className="card">
                    <div className="card-header">Recent Activity</div>
                    <div className="card-body">
                      <ActivityTimeline scope="org" id={orgId as string} limit={10} />
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'activity' && (
                <ActivityTimeline scope="org" id={orgId as string} limit={200} />
              )}

              {activeTab === 'documents' && (
                <>
                  <DocumentVault scope="org" id={orgId as string} allowUpload={true} openOnMount={openDocUploadOnce} />
                  {hasMoreDocs && (
                    <div style={{ marginTop: 8 }}>
                      <button className="button button-small" disabled={tabLoading} onClick={()=>{ setPageDocs(p=>p+1); loadTab('documents'); }}>Load more</button>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'members' && isAdmin && (
                <MembersPanel shopId={orgId as string} allowInvite={true} />
              )}

              {activeTab === 'work' && (
                <div className="card"><div className="card-body">
                  <WorkSessionsPanel scope="org" id={orgId as string} todayOnly={false} limit={50} />
                </div></div>
              )}

              {activeTab === 'compliance' && (
                <CompliancePanel
                  orgId={orgId as string}
                  onNavigateTab={(tab) => {
                    if (tab === 'documents') setActiveTab('documents');
                    if (tab === 'licenses') setActiveTab('licenses');
                  }}
                />
              )}

              {activeTab === 'vehicles' && (
                <>
                  <VehiclesPanel orgId={orgId as string} />
                  {isAdmin && (
                    <div style={{ marginTop: 8 }}>
                      <LinkRequestsPanel shopId={orgId as string} />
                    </div>
                  )}
                </>
              )}

              {activeTab === 'notifications' && (
                <OrgNotificationsPanel
                  orgId={orgId as string}
                  isAdmin={isAdmin}
                  onNavigateTab={(tab) => setActiveTab(tab as any)}
                />
              )}

              {activeTab === 'licenses' && (
                <div className="card"><div className="card-body">
                  {tabLoading && <div className="text text-small text-muted">Loading…</div>}
                  {tabError && <div className="text text-small" style={{ color: '#b91c1c' }}>{tabError}</div>}
                  {!tabLoading && !tabError && (
                    <div className="space-y-2">
                      {licenses.length === 0 ? <div className="text text-muted">No licenses.</div> : licenses.map((l:any)=> (
                        <div key={l.id} className="text">{l.license_type}: {l.license_number} {l.issuing_state ? `(${l.issuing_state})` : ''}</div>
                      ))}
                      {hasMoreLic && (
                        <div>
                          <button className="button button-small" disabled={tabLoading} onClick={()=>{ setPageLic(p=>p+1); loadTab('licenses'); }}>Load more</button>
                        </div>
                      )}
                    </div>
                  )}
                </div></div>
              )}

              {activeTab === 'locations' && (
                <div className="card"><div className="card-body">
                  {tabLoading && <div className="text text-small text-muted">Loading…</div>}
                  {tabError && <div className="text text-small" style={{ color: '#b91c1c' }}>{tabError}</div>}
                  {!tabLoading && !tabError && (
                    <div className="space-y-2">
                      {locations.length === 0 ? <div className="text text-muted">No locations.</div> : locations.map((l:any)=> (
                        <div key={l.id} className="text">{l.name || 'Location'} — {l.city || ''} {l.state || ''}</div>
                      ))}
                      {hasMoreLoc && (
                        <div>
                          <button className="button button-small" disabled={tabLoading} onClick={()=>{ setPageLoc(p=>p+1); loadTab('locations'); }}>Load more</button>
                        </div>
                      )}
                    </div>
                  )}
                </div></div>
              )}

              {activeTab === 'departments' && (
                <div className="card"><div className="card-body">
                  {tabLoading && <div className="text text-small text-muted">Loading…</div>}
                  {tabError && <div className="text text-small" style={{ color: '#b91c1c' }}>{tabError}</div>}
                  {!tabLoading && !tabError && (
                    <div className="space-y-2">
                      {departments.length === 0 ? <div className="text text-muted">No departments.</div> : departments.map((d:any)=> (
                        <div key={d.id} className="text">{d.name} — {d.department_type}</div>
                      ))}
                      {hasMoreDept && (
                        <div>
                          <button className="button button-small" disabled={tabLoading} onClick={()=>{ setPageDept(p=>p+1); loadTab('departments'); }}>Load more</button>
                        </div>
                      )}
                    </div>
                  )}
                </div></div>
              )}
            </ProfileShell>
          </div>
        </div>
      </div>
      {/* Modals */}
      {isAdmin && (
        <InviteMemberModal shopId={orgId as string} isOpen={showInvite} onClose={()=>setShowInvite(false)} />
      )}
      {isAdmin && (
        <AddLicenseModal shopId={orgId as string} isOpen={showAddLicense} onClose={async (created) => {
          setShowAddLicense(false);
          if (created) {
            await refreshCounts();
            await loadTab('licenses');
          }
        }} />
      )}
      {isAdmin && (
        <AddLocationModal shopId={orgId as string} isOpen={showAddLocation} onClose={async (created) => {
          setShowAddLocation(false);
          if (created) {
            await refreshCounts();
            await loadTab('locations');
          }
        }} />
      )}
      {isAdmin && (
        <AddDepartmentModal shopId={orgId as string} isOpen={showAddDepartment} onClose={async (created) => {
          setShowAddDepartment(false);
          if (created) {
            await refreshCounts();
            await loadTab('departments');
          }
        }} />
      )}
    </AppLayout>
  );
}
