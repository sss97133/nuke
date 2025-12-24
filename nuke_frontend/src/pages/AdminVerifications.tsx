import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { secureDocumentService, type SecureDocument, type PIIAuditLog } from '../services/secureDocumentService';
import { ImageHoverPreview, IDHoverCard } from '../components/admin';
import { FaviconIcon } from '../components/common/FaviconIcon';

const AdminVerifications: React.FC = () => {
  const [pending, setPending] = useState<SecureDocument[]>([]);
  const [orgRequests, setOrgRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [limitedView, setLimitedView] = useState<boolean>(false);
  const [signedUrlMap, setSignedUrlMap] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<'all' | 'id' | 'title' | 'vin' | 'duplicates'>('all');
  const [openDupIds, setOpenDupIds] = useState<Set<string>>(new Set());
  const [authorized, setAuthorized] = useState<boolean>(false);
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Not authenticated');
        setLoading(false);
        return;
      }
      // Verify admin via admin_users table (standardized admin check)
      const { data: adminData } = await supabase
        .from('admin_users')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();
      
      if (!adminData) {
        // Not authorized: redirect to profile and stop
        setAuthorized(false);
        navigate('/profile');
        return;
      } else {
        // Full admin view
        setAuthorized(true);

        // Pending secure documents
        const { data: docs, error: err } = await supabase
          .from('secure_documents')
          .select('*')
          .eq('verification_status', 'pending')
          .order('created_at', { ascending: false });
        if (err) throw err;
        
        // Hydrate user profile data for documents
        const docUserIds = Array.from(new Set((docs || []).map((d: SecureDocument) => d.user_id).filter(Boolean)));
        let docUserMap: Record<string, any> = {};
        if (docUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, avatar_url, full_name, username')
            .in('id', docUserIds);
          (profiles || []).forEach((p: any) => {
            docUserMap[p.id] = {
              avatar_url: p.avatar_url,
              full_name: p.full_name,
              username: p.username
            };
          });
        }
        
        // Attach user profile data to documents
        const docsWithProfiles = (docs || []).map((d: SecureDocument) => ({
          ...d,
          user_avatar_url: docUserMap[d.user_id]?.avatar_url,
          user_name: docUserMap[d.user_id]?.full_name || docUserMap[d.user_id]?.username || 'Unknown'
        }));
        
        setPending(docsWithProfiles);

        // Pending organization verification requests
        const { data: reqs, error: reqErr } = await supabase
          .from('shop_verification_requests')
          .select('id, shop_id, requested_by, status, created_at, legal_name, business_entity_type, extracted_data')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        if (reqErr) throw reqErr;

        const list = reqs || [];
        // Hydrate shop data and user profiles in parallel queries
        const shopIds = Array.from(new Set(list.map((r: any) => r.shop_id).filter(Boolean)));
        const userIds = Array.from(new Set(list.map((r: any) => r.requested_by).filter(Boolean)));
        
        let shopMap: Record<string, any> = {};
        let userMap: Record<string, any> = {};
        
        if (shopIds.length > 0) {
          const { data: shops } = await supabase
            .from('shops')
            .select('id, name, logo_url, website_url, website')
            .in('id', shopIds);
          (shops || []).forEach((s: any) => { 
            shopMap[s.id] = {
              name: s.name,
              logo_url: s.logo_url,
              website_url: s.website_url || s.website
            };
          });
        }
        
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, avatar_url, full_name, username')
            .in('id', userIds);
          (profiles || []).forEach((p: any) => {
            userMap[p.id] = {
              avatar_url: p.avatar_url,
              full_name: p.full_name,
              username: p.username
            };
          });
        }
        
        const hydrated = list.map((r: any) => {
          const shop = r.shop_id ? shopMap[r.shop_id] : null;
          const user = r.requested_by ? userMap[r.requested_by] : null;
          return {
            ...r,
            user_id: r.requested_by, // Map requested_by to user_id for compatibility
            verification_type: 'shop_verification', // Add for compatibility
            submission_data: {
              shop_id: r.shop_id,
              legal_name: r.legal_name,
              business_entity_type: r.business_entity_type,
              ...r.extracted_data
            },
            shop_name: shop?.name || r.shop_id || 'Unknown',
            shop_logo_url: shop?.logo_url,
            shop_website_url: shop?.website_url,
            requester_avatar_url: user?.avatar_url,
            requester_name: user?.full_name || user?.username || 'Unknown'
          };
        });
        setOrgRequests(hydrated);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load pending documents');
    } finally {
      setLoading(false);
    }
  };

  const markPrimary = async (doc: SecureDocument) => {
    try {
      setMessage(null);
      const { error } = await supabase.rpc('set_primary_document', { p_doc_id: doc.id });
      if (error) throw error;
      setMessage('✓ Set as primary');
      await load();
    } catch (e: any) {
      setMessage(`Failed to set primary: ${e?.message || e}`);
    }
  };

  const rejectOtherDuplicates = async (doc: SecureDocument) => {
    try {
      setMessage(null);
      const key = doc.file_hash || `${doc.user_id}:${doc.storage_path}`;
      const sibs = dupGroups.get(key) || [];
      for (const s of sibs) {
        if (s.id === doc.id) continue;
        const ok = await secureDocumentService.updateVerificationStatus(s.id, 'rejected', 'Rejected as duplicate');
        if (ok) {
          await supabase
            .from('profiles')
            .update({ id_verification_status: 'rejected' })
            .eq('id', s.user_id);
        }
      }
      setMessage('Rejected other duplicates');
      await load();
    } catch (e: any) {
      setMessage(`Failed to reject duplicates: ${e?.message || e}`);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // Prefetch thumbnails for images
    (async () => {
      const toFetch = pending.filter(d => (d.mime_type || '').startsWith('image/')).slice(0, 50);
      for (const d of toFetch) {
        if (signedUrlMap[d.id]) continue;
        try {
          const url = await secureDocumentService.getSecureDocumentUrl(d.id, 'Thumbnail preview');
          if (url) setSignedUrlMap((m) => ({ ...m, [d.id]: url }));
        } catch {}
      }
    })();
  }, [pending]);

  const viewDocument = async (doc: SecureDocument) => {
    try {
      const url = await secureDocumentService.getSecureDocumentUrl(doc.id, 'Moderator review');
      if (!url) {
        setMessage('Failed to generate secure link');
        return;
      }
      setSignedUrlMap((m) => ({ ...m, [doc.id]: url }));
      setPreviewUrl(url);
    } catch (e: any) {
      setMessage(e?.message || 'Failed to open document');
    }
  };

  const approve = async (doc: SecureDocument) => {
    setMessage(null);
    const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'approved', 'Approved by admin');
    if (!ok) { setMessage('Failed to approve'); return; }
    // Mark profile approved as well
    await supabase
      .from('profiles')
      .update({ id_verification_status: 'approved', verified_at: new Date().toISOString() })
      .eq('id', doc.user_id);
    setMessage('✓ Approved');
    await load();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(pending.map(p => p.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const approveSelected = async () => {
    if (selectedIds.size === 0) return;
    setMessage(null);
    for (const id of selectedIds) {
      const doc = pending.find(p => p.id === id);
      if (!doc) continue;
      const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'approved', 'Bulk approve');
      if (ok) {
        await supabase
          .from('profiles')
          .update({ id_verification_status: 'approved', verified_at: new Date().toISOString() })
          .eq('id', doc.user_id);
      }
    }
    setMessage('✓ Approved selected');
    setSelectedIds(new Set());
    await load();
  };

  const rejectSelected = async () => {
    if (selectedIds.size === 0) return;
    setMessage(null);
    for (const id of selectedIds) {
      const doc = pending.find(p => p.id === id);
      if (!doc) continue;
      const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'rejected', 'Bulk reject');
      if (ok) {
        await supabase
          .from('profiles')
          .update({ id_verification_status: 'rejected' })
          .eq('id', doc.user_id);
      }
    }
    setMessage('Rejected selected');
    setSelectedIds(new Set());
    await load();
  };

  const reject = async (doc: SecureDocument) => {
    setMessage(null);
    const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'rejected', 'Rejected by admin');
    if (!ok) { setMessage('Failed to reject'); return; }
    await supabase
      .from('profiles')
      .update({ id_verification_status: 'rejected' })
      .eq('id', doc.user_id);
    setMessage('Rejected');
    await load();
  };

  // === Organization verification actions ===
  const approveOrgRequest = async (req: any) => {
    try {
      setMessage(null);
      if (!req.shop_id) throw new Error('Missing shop_id on request');
      const { error: rpcErr } = await supabase.rpc('verify_shop', { p_shop_id: req.shop_id });
      if (rpcErr) throw rpcErr;
      const { error: updErr } = await supabase
        .from('shop_verification_requests')
        .update({ status: 'approved' })
        .eq('id', req.id);
      if (updErr) throw updErr;
      setMessage('✓ Organization verified');
      await load();
    } catch (e: any) {
      setMessage(`Failed to verify org: ${e?.message || e}`);
    }
  };

  const rejectOrgRequest = async (req: any) => {
    try {
      setMessage(null);
      const { error: updErr } = await supabase
        .from('shop_verification_requests')
        .update({ status: 'rejected' })
        .eq('id', req.id);
      if (updErr) throw updErr;
      setMessage('Rejected organization request');
      await load();
    } catch (e: any) {
      setMessage(`Failed to reject org request: ${e?.message || e}`);
    }
  };

  // === Helpers: categorization and duplicate detection ===
  const isIdDoc = (d: SecureDocument) => {
    const t = (d.document_type || '').toLowerCase();
    return ['drivers_license','passport','state_id','other','id','id_document'].some(k => t.includes(k));
  };
  const isTitleDoc = (d: SecureDocument) => {
    const t = (d.document_type || '').toLowerCase();
    return t.includes('title') || t.includes('registration');
  };
  const isVinPhoto = (d: SecureDocument) => {
    const t = (d.document_type || '').toLowerCase();
    return t.includes('vin');
  };

  const dupGroups = useMemo(() => {
    const map = new Map<string, SecureDocument[]>();
    for (const d of pending) {
      const key = d.file_hash || `${d.user_id}:${d.storage_path}`;
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [pending]);

  const isDuplicate = (d: SecureDocument) => {
    const key = d.file_hash || `${d.user_id}:${d.storage_path}`;
    const group = dupGroups.get(key);
    return !!group && group.length > 1;
  };

  const filtered = useMemo(() => {
    return pending.filter((d: SecureDocument) => {
      switch (category) {
        case 'id': return isIdDoc(d);
        case 'title': return isTitleDoc(d);
        case 'vin': return isVinPhoto(d);
        case 'duplicates': return isDuplicate(d);
        default: return true;
      }
    });
  }, [pending, category, dupGroups]);

  const toggleDupOpen = (id: string) => {
    setOpenDupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="container">
        <div className="main">
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-end mb-2">
                <button className="button button-secondary" onClick={load} disabled={loading}>Refresh</button>
              </div>
              {error && <div className="text-small" style={{ color: '#b91c1c' }}>{error}</div>}
              {message && (
                <div className="text-small" style={{ color: message.startsWith('Failed') ? '#b91c1c' : '#16a34a' }}>{message}</div>
              )}
              {loading ? (
                <div className="text-small text-muted">Loading…</div>
              ) : (
                <>
                  {/* Organization Verification Requests */}
                  <div className="section" style={{ marginBottom: 16 }}>
                    <div className="text font-bold" style={{ marginBottom: 8 }}>Organization Verification Requests</div>
                    {orgRequests.length === 0 ? (
                      <div className="text-small text-muted">No pending organization requests.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 12 }}>
                        {orgRequests.map((r) => (
                          <div key={r.id} className="card">
                            <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                                {/* Shop Logo/Favicon */}
                                <div style={{ flexShrink: 0 }}>
                                  {r.shop_logo_url ? (
                                    <img
                                      src={r.shop_logo_url}
                                      alt={r.shop_name}
                                      style={{
                                        width: 48,
                                        height: 48,
                                        objectFit: 'contain',
                                        borderRadius: 4,
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface)',
                                        padding: 4
                                      }}
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  ) : r.shop_website_url ? (
                                    <FaviconIcon
                                      url={r.shop_website_url}
                                      size={48}
                                      style={{
                                        borderRadius: 4,
                                        border: '1px solid var(--border)',
                                        padding: 8,
                                        background: 'var(--surface)'
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 48,
                                        height: 48,
                                        borderRadius: 4,
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface-hover)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '18pt',
                                        fontWeight: 'bold',
                                        color: 'var(--text-muted)'
                                      }}
                                    >
                                      {(r.shop_name || 'S').charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                </div>
                                
                                {/* Shop Info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div className="text" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <strong>{r.shop_name}</strong>
                                    {r.shop_website_url && (
                                      <FaviconIcon
                                        url={r.shop_website_url}
                                        size={16}
                                        matchTextSize={true}
                                        textSize={8}
                                      />
                                    )}
                                    <span className="text-small text-muted">({r.shop_id?.substring(0, 8)}...)</span>
                                  </div>
                                  {/* Requester Profile */}
                                  <div className="text text-small" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span className="text-muted">Requested by:</span>
                                    {r.requester_avatar_url ? (
                                      <img
                                        src={r.requester_avatar_url}
                                        alt={r.requester_name}
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: '50%',
                                          objectFit: 'cover',
                                          border: '1px solid var(--border)',
                                          verticalAlign: 'middle'
                                        }}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: '50%',
                                          background: 'var(--surface-hover)',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: '8pt',
                                          fontWeight: 'bold',
                                          border: '1px solid var(--border)'
                                        }}
                                      >
                                        {(r.requester_name || 'U').charAt(0).toUpperCase()}
                                      </div>
                                    )}
                                    <span>{r.requester_name}</span>
                                  </div>
                                  {r.reason && (
                                    <div className="text text-small text-muted" style={{ marginTop: 4 }}>Reason: {r.reason}</div>
                                  )}
                                  <div className="text text-small text-muted" style={{ marginTop: 4 }}>Requested: {new Date(r.created_at).toLocaleString()}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                                <button className="button button-small" onClick={() => approveOrgRequest(r)}>Approve</button>
                                <button className="button button-small button-secondary" onClick={() => rejectOrgRequest(r)}>Reject</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Secure Document Verifications */}
                  {filtered.length === 0 ? (
                    <div className="text-small text-muted">No pending documents.</div>
                  ) : (
                    <>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-small">Filter:</div>
                    <button className={`button button-small ${category==='all'?'button-primary':''}`} onClick={()=>setCategory('all')}>All</button>
                    <button className={`button button-small ${category==='id'?'button-primary':''}`} onClick={()=>setCategory('id')}>ID Documents</button>
                    <button className={`button button-small ${category==='title'?'button-primary':''}`} onClick={()=>setCategory('title')}>Vehicle Titles</button>
                    <button className={`button button-small ${category==='vin'?'button-primary':''}`} onClick={()=>setCategory('vin')}>VIN Photos</button>
                    <button className={`button button-small ${category==='duplicates'?'button-primary':''}`} onClick={()=>setCategory('duplicates')}>Duplicates Only</button>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <button className="button button-small" onClick={selectAll}>Select All</button>
                    <button className="button button-small button-secondary" onClick={clearSelection}>Clear</button>
                    <div className="text-small text-muted">Selected: {selectedIds.size}</div>
                    <div style={{ flex: 1 }} />
                    <button className="button button-small" onClick={approveSelected} disabled={selectedIds.size === 0}>Approve Selected</button>
                    <button className="button button-small button-secondary" onClick={rejectSelected} disabled={selectedIds.size === 0}>Reject Selected</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                    {filtered.map((d) => {
                      const isImg = (d.mime_type || '').startsWith('image/');
                      const thumb = signedUrlMap[d.id];
                      const checked = selectedIds.has(d.id);
                      const dup = isDuplicate(d);
                      const key = d.file_hash || `${d.user_id}:${d.storage_path}`;
                      const siblings = dup ? (dupGroups.get(key) || []).filter(x => x.id !== d.id) : [];
                      return (
                        <div key={d.id} className="card" style={{ borderColor: checked ? '#3b82f6' : undefined }}>
                          <div className="card-body">
                            <div className="flex items-center justify-between mb-2">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" checked={checked} onChange={() => toggleSelect(d.id)} />
                                <span className="text-small text-muted">{new Date(d.created_at).toLocaleString()}</span>
                              </label>
                              <div className="flex items-center gap-2">
                                {dup && <span className="badge badge-danger">Duplicate</span>}
                                <span className="badge badge-warning">Pending</span>
                              </div>
                            </div>
                            {isImg ? (
                              thumb ? (
                                <ImageHoverPreview
                                  imageUrl={thumb}
                                  imageId={d.id}
                                  vehicleId={d.vehicle_id}
                                >
                                  <img
                                    src={thumb}
                                    alt={d.document_type}
                                    style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 0, marginBottom: 8, cursor: 'zoom-in' }}
                                    onClick={() => viewDocument(d)}
                                  />
                                </ImageHoverPreview>
                              ) : (
                                <div className="text-small text-muted" style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', borderRadius: 0, marginBottom: 8 }}>
                                  Loading preview…
                                </div>
                              )
                            ) : (
                              <div className="text-small text-muted" style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', borderRadius: 0, marginBottom: 8 }}>
                                {d.mime_type || 'Document'}
                              </div>
                            )}
                            <div className="vehicle-details">
                              <div className="vehicle-detail"><span>Document</span><span className="text-small">{d.document_type}</span></div>
                              <div className="vehicle-detail">
                                <span>User</span>
                                <span className="text-small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {(d as any).user_avatar_url ? (
                                    <img
                                      src={(d as any).user_avatar_url}
                                      alt={(d as any).user_name}
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        border: '1px solid var(--border)',
                                        flexShrink: 0
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: '50%',
                                        background: 'var(--surface-hover)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '8pt',
                                        fontWeight: 'bold',
                                        border: '1px solid var(--border)',
                                        flexShrink: 0
                                      }}
                                    >
                                      {((d as any).user_name || d.user_id || 'U').charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <IDHoverCard id={d.user_id} type="user">
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span>{(d as any).user_name || d.user_id.substring(0, 8) + '...'}</span>
                                    </span>
                                  </IDHoverCard>
                                </span>
                              </div>
                              {dup && (
                                <div className="vehicle-detail" style={{ alignItems: 'flex-start' }}>
                                  <span>Duplicates</span>
                                  <div className="text-small">
                                    {siblings.length} other file(s) match this hash
                                    <button className="button button-small button-link" onClick={()=>toggleDupOpen(d.id)} style={{ marginLeft: 8 }}>
                                      {openDupIds.has(d.id) ? 'Hide' : 'View'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                            {dup && openDupIds.has(d.id) && (
                              <div className="card" style={{ background: 'var(--bg)', marginTop: 8 }}>
                                <div className="card-body">
                                  <div className="text-small text-muted" style={{ marginBottom: 6 }}>Matching files:</div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {siblings.map(s => (
                                      <div key={s.id} className="flex items-center justify-between">
                                        <div className="text-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.storage_path}</div>
                                        <div className="flex items-center gap-2">
                                          <button className="button button-small" onClick={()=>viewDocument(s)}>View</button>
                                          <label className="flex items-center gap-1 text-small">
                                            <input type="checkbox" checked={selectedIds.has(s.id)} onChange={()=>toggleSelect(s.id)} /> select
                                          </label>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              <button className="button button-small" onClick={() => approve(d)}>Approve</button>
                              <button className="button button-small button-secondary" onClick={() => reject(d)}>Reject</button>
                              {dup && (
                                <>
                                  <button className="button button-small" onClick={()=>markPrimary(d)}>Mark as Primary</button>
                                  <button className="button button-small button-secondary" onClick={()=>rejectOtherDuplicates(d)}>Reject Other Duplicates</button>
                                </>
                              )}
                            </div>
                            {previewUrl && (
                              <div role="dialog" aria-modal="true" className="card" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
                                <div className="card" style={{ maxWidth: '92vw', maxHeight: '92vh' }}>
                                  <div className="card-body" style={{ position: 'relative' }}>
                                    <button className="button button-small button-secondary" onClick={() => setPreviewUrl(null)} style={{ position: 'absolute', top: 8, right: 8 }}>Close</button>
                                    <img src={previewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 4 }} />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminVerifications;
