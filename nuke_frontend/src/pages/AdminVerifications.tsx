import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { secureDocumentService, type SecureDocument, type PIIAuditLog } from '../services/secureDocumentService';
import { ImageHoverPreview, IDHoverCard } from '../components/admin';
import { FaviconIcon } from '../components/common/FaviconIcon';

// Statistics interface
interface VerificationStats {
  totalPending: number;
  idDocuments: number;
  titles: number;
  vinPhotos: number;
  duplicates: number;
  orgRequests: number;
  oldestPending: string | null;
}

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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'user' | 'type'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [stats, setStats] = useState<VerificationStats | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [rejectionNote, setRejectionNote] = useState<string>('');
  const [showRejectionModal, setShowRejectionModal] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const autoRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messageTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear message after 5 seconds
  useEffect(() => {
    if (message) {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
      messageTimeoutRef.current = setTimeout(() => {
        setMessage(null);
      }, 5000);
    }
    return () => {
      if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
    };
  }, [message]);

  // Auto-refresh functionality
  useEffect(() => {
    if (autoRefresh && authorized) {
      autoRefreshIntervalRef.current = setInterval(() => {
        load();
      }, 30000); // Refresh every 30 seconds
    } else {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
        autoRefreshIntervalRef.current = null;
      }
    }
    return () => {
      if (autoRefreshIntervalRef.current) {
        clearInterval(autoRefreshIntervalRef.current);
      }
    };
  }, [autoRefresh, authorized]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Ctrl/Cmd + K: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('input[type="search"]') as HTMLInputElement;
        if (searchInput) searchInput.focus();
      }

      // Ctrl/Cmd + A: Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
        e.preventDefault();
        selectAll();
      }

      // Escape: Close modals/previews
      if (e.key === 'Escape') {
        setPreviewUrl(null);
        setShowRejectionModal(null);
        setRejectionNote('');
      }

      // Ctrl/Cmd + Enter: Approve selected
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && selectedIds.size > 0) {
        e.preventDefault();
        approveSelected();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedIds.size]);

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

        // Calculate statistics
        const idDocs = docsWithProfiles.filter(d => isIdDoc(d)).length;
        const titleDocs = docsWithProfiles.filter(d => isTitleDoc(d)).length;
        const vinDocs = docsWithProfiles.filter(d => isVinPhoto(d)).length;
        const dupDocs = docsWithProfiles.filter(d => isDuplicate(d)).length;
        const oldest = docsWithProfiles.length > 0 
          ? docsWithProfiles.reduce((oldest, d) => 
              new Date(d.created_at) < new Date(oldest.created_at) ? d : oldest, 
              docsWithProfiles[0]
            ).created_at
          : null;

        setStats({
          totalPending: docsWithProfiles.length,
          idDocuments: idDocs,
          titles: titleDocs,
          vinPhotos: vinDocs,
          duplicates: dupDocs,
          orgRequests: hydrated.length,
          oldestPending: oldest
        });
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load pending documents');
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const markPrimary = async (doc: SecureDocument) => {
    try {
      setMessage(null);
      setProcessing(prev => new Set(prev).add(doc.id));
      const { error } = await supabase.rpc('set_primary_document', { p_doc_id: doc.id });
      if (error) throw error;
      setMessage('✓ Set as primary');
      await load();
    } catch (e: any) {
      setMessage(`Failed to set primary: ${e?.message || e}`);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  const rejectOtherDuplicates = async (doc: SecureDocument) => {
    try {
      setMessage(null);
      setProcessing(prev => new Set(prev).add(doc.id));
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
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    // Prefetch thumbnails for images (lazy load, limit to 20 at a time)
    (async () => {
      const toFetch = pending
        .filter(d => (d.mime_type || '').startsWith('image/'))
        .filter(d => !signedUrlMap[d.id])
        .slice(0, 20);
      
      for (const d of toFetch) {
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
    setProcessing(prev => new Set(prev).add(doc.id));
    const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'approved', 'Approved by admin');
    if (!ok) { 
      setMessage('Failed to approve');
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      return; 
    }
    // Mark profile approved as well
    await supabase
      .from('profiles')
      .update({ id_verification_status: 'approved', verified_at: new Date().toISOString() })
      .eq('id', doc.user_id);
    setMessage('✓ Approved');
    setProcessing(prev => {
      const next = new Set(prev);
      next.delete(doc.id);
      return next;
    });
    await load();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(pending.map(p => p.id)));
  }, [pending]);

  const clearSelection = () => setSelectedIds(new Set());

  const approveSelected = async () => {
    if (selectedIds.size === 0) return;
    setMessage(null);
    setProcessing(prev => new Set([...prev, ...Array.from(selectedIds)]));
    let successCount = 0;
    for (const id of selectedIds) {
      const doc = pending.find(p => p.id === id);
      if (!doc) continue;
      const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'approved', 'Bulk approve');
      if (ok) {
        await supabase
          .from('profiles')
          .update({ id_verification_status: 'approved', verified_at: new Date().toISOString() })
          .eq('id', doc.user_id);
        successCount++;
      }
    }
    setMessage(`✓ Approved ${successCount} of ${selectedIds.size} documents`);
    setSelectedIds(new Set());
    setProcessing(prev => {
      const next = new Set(prev);
      selectedIds.forEach(id => next.delete(id));
      return next;
    });
    await load();
  };

  const rejectSelected = async () => {
    if (selectedIds.size === 0) return;
    setMessage(null);
    setProcessing(prev => new Set([...prev, ...Array.from(selectedIds)]));
    let successCount = 0;
    for (const id of selectedIds) {
      const doc = pending.find(p => p.id === id);
      if (!doc) continue;
      const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'rejected', 'Bulk reject');
      if (ok) {
        await supabase
          .from('profiles')
          .update({ id_verification_status: 'rejected' })
          .eq('id', doc.user_id);
        successCount++;
      }
    }
    setMessage(`Rejected ${successCount} of ${selectedIds.size} documents`);
    setSelectedIds(new Set());
    setProcessing(prev => {
      const next = new Set(prev);
      selectedIds.forEach(id => next.delete(id));
      return next;
    });
    await load();
  };

  const reject = async (doc: SecureDocument, note?: string) => {
    setMessage(null);
    setProcessing(prev => new Set(prev).add(doc.id));
    const rejectionReason = note || 'Rejected by admin';
    const ok = await secureDocumentService.updateVerificationStatus(doc.id, 'rejected', rejectionReason);
    if (!ok) { 
      setMessage('Failed to reject');
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      return; 
    }
    await supabase
      .from('profiles')
      .update({ id_verification_status: 'rejected' })
      .eq('id', doc.user_id);
    setMessage('Rejected');
    setShowRejectionModal(null);
    setRejectionNote('');
    setProcessing(prev => {
      const next = new Set(prev);
      next.delete(doc.id);
      return next;
    });
    await load();
  };

  // === Organization verification actions ===
  const approveOrgRequest = async (req: any) => {
    try {
      setMessage(null);
      setProcessing(prev => new Set(prev).add(req.id));
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
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(req.id);
        return next;
      });
    }
  };

  const rejectOrgRequest = async (req: any) => {
    try {
      setMessage(null);
      setProcessing(prev => new Set(prev).add(req.id));
      const { error: updErr } = await supabase
        .from('shop_verification_requests')
        .update({ status: 'rejected' })
        .eq('id', req.id);
      if (updErr) throw updErr;
      setMessage('Rejected organization request');
      await load();
    } catch (e: any) {
      setMessage(`Failed to reject org request: ${e?.message || e}`);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(req.id);
        return next;
      });
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

  // Search and filter
  const filtered = useMemo(() => {
    let result = pending.filter((d: SecureDocument) => {
      // Category filter
      switch (category) {
        case 'id': return isIdDoc(d);
        case 'title': return isTitleDoc(d);
        case 'vin': return isVinPhoto(d);
        case 'duplicates': return isDuplicate(d);
        default: return true;
      }
    });

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((d: SecureDocument) => {
        const docType = (d.document_type || '').toLowerCase();
        const userName = ((d as any).user_name || '').toLowerCase();
        const userId = d.user_id.toLowerCase();
        return docType.includes(query) || userName.includes(query) || userId.includes(query);
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case 'user':
          const aName = ((a as any).user_name || '').toLowerCase();
          const bName = ((b as any).user_name || '').toLowerCase();
          comparison = aName.localeCompare(bName);
          break;
        case 'type':
          comparison = (a.document_type || '').localeCompare(b.document_type || '');
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [pending, category, searchQuery, sortBy, sortOrder, dupGroups]);

  const toggleDupOpen = (id: string) => {
    setOpenDupIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Export function
  const exportData = useCallback(() => {
    const data = filtered.map(d => ({
      id: d.id,
      document_type: d.document_type,
      user_id: d.user_id,
      user_name: (d as any).user_name,
      created_at: d.created_at,
      file_hash: d.file_hash,
      is_duplicate: isDuplicate(d)
    }));
    const csv = [
      ['ID', 'Document Type', 'User ID', 'User Name', 'Created At', 'File Hash', 'Is Duplicate'],
      ...data.map(d => [
        d.id,
        d.document_type,
        d.user_id,
        d.user_name,
        d.created_at,
        d.file_hash || '',
        d.is_duplicate ? 'Yes' : 'No'
      ])
    ].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `verifications_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('✓ Data exported');
  }, [filtered]);

  return (
    <div className="container">
      <div className="main">
        <div className="card">
          <div className="card-body">
            {/* Header with controls */}
            <div className="flex items-center justify-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 className="text font-bold" style={{ margin: 0 }}>Verification Dashboard</h2>
                {stats && (
                  <div className="text-small text-muted" style={{ marginTop: 4 }}>
                    {stats.totalPending} pending documents • {stats.orgRequests} org requests
                    {stats.oldestPending && (
                      <span> • Oldest: {new Date(stats.oldestPending).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-small">
                  <input 
                    type="checkbox" 
                    checked={autoRefresh} 
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                  Auto-refresh
                </label>
                <button className="button button-secondary" onClick={load} disabled={loading}>
                  {loading ? 'Loading...' : 'Refresh'}
                </button>
                {filtered.length > 0 && (
                  <button className="button button-secondary" onClick={exportData}>
                    Export CSV
                  </button>
                )}
              </div>
            </div>

            {/* Statistics Dashboard */}
            {stats && stats.totalPending > 0 && (
              <div className="card" style={{ marginBottom: 16, background: 'var(--surface)' }}>
                <div className="card-body">
                  <div className="text-small font-bold" style={{ marginBottom: 8 }}>Statistics</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                    <div>
                      <div className="text-small text-muted">Total Pending</div>
                      <div className="text font-bold">{stats.totalPending}</div>
                    </div>
                    <div>
                      <div className="text-small text-muted">ID Documents</div>
                      <div className="text font-bold">{stats.idDocuments}</div>
                    </div>
                    <div>
                      <div className="text-small text-muted">Titles</div>
                      <div className="text font-bold">{stats.titles}</div>
                    </div>
                    <div>
                      <div className="text-small text-muted">VIN Photos</div>
                      <div className="text font-bold">{stats.vinPhotos}</div>
                    </div>
                    <div>
                      <div className="text-small text-muted">Duplicates</div>
                      <div className="text font-bold">{stats.duplicates}</div>
                    </div>
                    <div>
                      <div className="text-small text-muted">Org Requests</div>
                      <div className="text font-bold">{stats.orgRequests}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Messages */}
            {error && (
              <div className="card" style={{ marginBottom: 16, background: '#fee2e2', borderColor: '#dc2626' }}>
                <div className="card-body">
                  <div className="text-small" style={{ color: '#b91c1c' }}>{error}</div>
                </div>
              </div>
            )}
            {message && (
              <div className="card" style={{ 
                marginBottom: 16, 
                background: message.startsWith('Failed') ? '#fee2e2' : '#dcfce7',
                borderColor: message.startsWith('Failed') ? '#dc2626' : '#16a34a'
              }}>
                <div className="card-body">
                  <div className="text-small" style={{ color: message.startsWith('Failed') ? '#b91c1c' : '#16a34a' }}>
                    {message}
                  </div>
                </div>
              </div>
            )}

            {loading && !stats ? (
              <div className="text-small text-muted" style={{ textAlign: 'center', padding: '48px' }}>
                Loading…
              </div>
            ) : (
              <>
                {/* Organization Verification Requests */}
                {orgRequests.length > 0 && (
                  <div className="section" style={{ marginBottom: 24 }}>
                    <div className="text font-bold" style={{ marginBottom: 12 }}>Organization Verification Requests ({orgRequests.length})</div>
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
                                  <IDHoverCard id={r.requested_by} type="user">
                                    <span>{r.requester_name}</span>
                                  </IDHoverCard>
                                </div>
                                {r.reason && (
                                  <div className="text text-small text-muted" style={{ marginTop: 4 }}>Reason: {r.reason}</div>
                                )}
                                <div className="text text-small text-muted" style={{ marginTop: 4 }}>
                                  Requested: {new Date(r.created_at).toLocaleString()}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                              <button 
                                className="button button-small" 
                                onClick={() => approveOrgRequest(r)}
                                disabled={processing.has(r.id)}
                              >
                                {processing.has(r.id) ? 'Processing...' : 'Approve'}
                              </button>
                              <button 
                                className="button button-small button-secondary" 
                                onClick={() => rejectOrgRequest(r)}
                                disabled={processing.has(r.id)}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Secure Document Verifications */}
                <div className="section">
                  <div className="text font-bold" style={{ marginBottom: 12 }}>
                    Secure Document Verifications ({filtered.length} of {pending.length})
                  </div>

                  {/* Search and Filters */}
                  <div className="flex items-center gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
                    <input
                      type="search"
                      placeholder="Search by document type, user name, or ID (Ctrl+K)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="input"
                      style={{ flex: 1, minWidth: 200, maxWidth: 400 }}
                    />
                    <select 
                      className="input" 
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as 'date' | 'user' | 'type')}
                      style={{ width: 120 }}
                    >
                      <option value="date">Sort by Date</option>
                      <option value="user">Sort by User</option>
                      <option value="type">Sort by Type</option>
                    </select>
                    <button 
                      className="button button-small"
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                    >
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
                    <div className="text-small">Filter:</div>
                    <button className={`button button-small ${category==='all'?'button-primary':''}`} onClick={()=>setCategory('all')}>All</button>
                    <button className={`button button-small ${category==='id'?'button-primary':''}`} onClick={()=>setCategory('id')}>ID Documents</button>
                    <button className={`button button-small ${category==='title'?'button-primary':''}`} onClick={()=>setCategory('title')}>Vehicle Titles</button>
                    <button className={`button button-small ${category==='vin'?'button-primary':''}`} onClick={()=>setCategory('vin')}>VIN Photos</button>
                    <button className={`button button-small ${category==='duplicates'?'button-primary':''}`} onClick={()=>setCategory('duplicates')}>Duplicates Only</button>
                  </div>

                  {/* Bulk Actions */}
                  <div className="flex items-center gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
                    <button className="button button-small" onClick={selectAll}>Select All</button>
                    <button className="button button-small button-secondary" onClick={clearSelection}>Clear</button>
                    <div className="text-small text-muted">Selected: {selectedIds.size}</div>
                    <div style={{ flex: 1 }} />
                    <button 
                      className="button button-small" 
                      onClick={approveSelected} 
                      disabled={selectedIds.size === 0 || Array.from(selectedIds).some(id => processing.has(id))}
                    >
                      Approve Selected ({selectedIds.size})
                    </button>
                    <button 
                      className="button button-small button-secondary" 
                      onClick={rejectSelected} 
                      disabled={selectedIds.size === 0 || Array.from(selectedIds).some(id => processing.has(id))}
                    >
                      Reject Selected ({selectedIds.size})
                    </button>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="text-small text-muted" style={{ textAlign: 'center', padding: '48px' }}>
                      {searchQuery ? 'No documents match your search.' : 'No pending documents.'}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                      {filtered.map((d) => {
                        const isImg = (d.mime_type || '').startsWith('image/');
                        const thumb = signedUrlMap[d.id];
                        const checked = selectedIds.has(d.id);
                        const dup = isDuplicate(d);
                        const key = d.file_hash || `${d.user_id}:${d.storage_path}`;
                        const siblings = dup ? (dupGroups.get(key) || []).filter(x => x.id !== d.id) : [];
                        const isProcessing = processing.has(d.id);
                        return (
                          <div key={d.id} className="card" style={{ 
                            borderColor: checked ? '#3b82f6' : undefined,
                            opacity: isProcessing ? 0.6 : 1,
                            position: 'relative'
                          }}>
                            {isProcessing && (
                              <div style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                background: 'var(--surface)',
                                padding: '4px 8px',
                                borderRadius: 4,
                                fontSize: '8pt',
                                zIndex: 10
                              }}>
                                Processing...
                              </div>
                            )}
                            <div className="card-body">
                              <div className="flex items-center justify-between mb-2">
                                <label className="flex items-center gap-2">
                                  <input 
                                    type="checkbox" 
                                    checked={checked} 
                                    onChange={() => toggleSelect(d.id)}
                                    disabled={isProcessing}
                                  />
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
                                <button 
                                  className="button button-small" 
                                  onClick={() => approve(d)}
                                  disabled={isProcessing}
                                >
                                  Approve
                                </button>
                                <button 
                                  className="button button-small button-secondary" 
                                  onClick={() => setShowRejectionModal(d.id)}
                                  disabled={isProcessing}
                                >
                                  Reject
                                </button>
                                {dup && (
                                  <>
                                    <button 
                                      className="button button-small" 
                                      onClick={()=>markPrimary(d)}
                                      disabled={isProcessing}
                                    >
                                      Mark Primary
                                    </button>
                                    <button 
                                      className="button button-small button-secondary" 
                                      onClick={()=>rejectOtherDuplicates(d)}
                                      disabled={isProcessing}
                                    >
                                      Reject Others
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {previewUrl && (
        <div 
          role="dialog" 
          aria-modal="true" 
          className="card" 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.8)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 60 
          }}
          onClick={() => setPreviewUrl(null)}
        >
          <div 
            className="card" 
            style={{ maxWidth: '92vw', maxHeight: '92vh', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-body" style={{ position: 'relative' }}>
              <button 
                className="button button-small button-secondary" 
                onClick={() => setPreviewUrl(null)} 
                style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}
              >
                Close (Esc)
              </button>
              <img 
                src={previewUrl} 
                alt="Preview" 
                style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 4 }} 
              />
            </div>
          </div>
        </div>
      )}

      {/* Rejection Note Modal */}
      {showRejectionModal && (
        <div 
          role="dialog" 
          aria-modal="true" 
          className="card" 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.6)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            zIndex: 60 
          }}
          onClick={() => {
            setShowRejectionModal(null);
            setRejectionNote('');
          }}
        >
          <div 
            className="card" 
            style={{ maxWidth: 500, width: '90vw', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-body">
              <div className="text font-bold" style={{ marginBottom: 12 }}>Reject Document</div>
              <div className="text-small text-muted" style={{ marginBottom: 12 }}>
                Add a note explaining why this document is being rejected (optional):
              </div>
              <textarea
                className="input"
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Rejection reason..."
                rows={4}
                style={{ width: '100%', marginBottom: 12 }}
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <button 
                  className="button button-secondary" 
                  onClick={() => {
                    setShowRejectionModal(null);
                    setRejectionNote('');
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="button" 
                  onClick={() => {
                    const doc = pending.find(d => d.id === showRejectionModal);
                    if (doc) reject(doc, rejectionNote || undefined);
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminVerifications;
