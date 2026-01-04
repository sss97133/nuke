import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminNotificationService } from '../../services/adminNotificationService';
import { useToast } from '../../hooks/useToast';
import { StreamActionsService, type StreamAction } from '../../services/streamActionsService';

type StreamActionPackRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  is_active: boolean;
};

function slugify(s: string) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

export default function MemeLibraryAdmin() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState<StreamActionPackRow[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [actions, setActions] = useState<StreamAction[]>([]);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);

  const [packSlug, setPackSlug] = useState('');
  const [packName, setPackName] = useState('');
  const [packDescription, setPackDescription] = useState('');
  const [packPriceCents, setPackPriceCents] = useState<number>(0);
  const [packActive, setPackActive] = useState(true);

  const [actionTitle, setActionTitle] = useState('');
  const [actionSlug, setActionSlug] = useState('');
  const [actionDurationMs, setActionDurationMs] = useState<number>(1800);
  const [actionCooldownMs, setActionCooldownMs] = useState<number>(2500);
  const [actionActive, setActionActive] = useState(true);
  const [actionFile, setActionFile] = useState<File | null>(null);
  const [actionSourceUrl, setActionSourceUrl] = useState('');
  const [actionAttribution, setActionAttribution] = useState('');
  const [actionLicense, setActionLicense] = useState('');
  const [actionTags, setActionTags] = useState('');
  const [actionImportUrl, setActionImportUrl] = useState('');

  const selectedPack = useMemo(() => packs.find((p) => p.id === selectedPackId) || null, [packs, selectedPackId]);
  const selectedPackSlug = selectedPack?.slug || '';

  const addTags = (next: string[]) => {
    const existing = actionTags
      ? actionTags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const set = new Set(existing);
    for (const t of next) set.add(t);
    setActionTags(Array.from(set).join(', '));
  };

  const refresh = async () => {
    try {
      const { data, error } = await supabase
        .from('stream_action_packs')
        .select('id, slug, name, description, price_cents, is_active')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPacks((data || []) as StreamActionPackRow[]);
      
      if (selectedPackId) {
        await refreshActions();
      }
    } catch (e: any) {
      showToast(e?.message || 'Failed to refresh packs', 'error');
    }
  };

  const refreshActions = async () => {
    if (!selectedPackId) return;
    try {
      const acts = await StreamActionsService.listActionsForPacks([selectedPackId], true);
      setActions(acts);
    } catch (e: any) {
      showToast(e?.message || 'Failed to load actions', 'error');
    }
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsAdmin(false);
        navigate('/login');
        return;
      }

      const ok = await AdminNotificationService.isCurrentUserAdmin();
      if (!ok) {
        setIsAdmin(false);
        navigate('/org/dashboard');
        return;
      }

      setIsAdmin(true);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!packs.length) return;
    setSelectedPackId((prev) => (prev && packs.some((p) => p.id === prev) ? prev : packs[0].id));
  }, [packs]);

  useEffect(() => {
    if (selectedPackId) {
      void refreshActions();
    } else {
      setActions([]);
    }
  }, [selectedPackId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!packName) return;
    if (!packSlug) setPackSlug(slugify(packName));
  }, [packName, packSlug]);

  useEffect(() => {
    if (!actionTitle) return;
    if (!actionSlug) setActionSlug(slugify(actionTitle));
  }, [actionTitle, actionSlug]);

  const createOrUpdatePack = async () => {
    try {
      setLoading(true);
      const slug = slugify(packSlug || packName);
      const name = String(packName || '').trim();
      if (!slug || !name) throw new Error('Missing pack slug/name');

      const { data, error } = await supabase.rpc('admin_upsert_stream_action_pack', {
        p_slug: slug,
        p_name: name,
        p_description: packDescription ? packDescription : null,
        p_price_cents: Number.isFinite(packPriceCents) ? packPriceCents : 0,
        p_is_active: packActive,
      });
      if (error) throw error;

      await refresh();
      if (data) setSelectedPackId(String(data));

      setPackSlug('');
      setPackName('');
      setPackDescription('');
      setPackPriceCents(0);
      setPackActive(true);
      showToast('Pack saved successfully', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to save pack', 'error');
    } finally {
      setLoading(false);
    }
  };

  const deletePack = async (packId: string) => {
    if (!confirm('Delete this pack? All actions in the pack will also be deleted.')) return;
    try {
      setLoading(true);
      const { error } = await supabase.rpc('admin_delete_stream_action_pack', { p_pack_id: packId });
      if (error) throw error;
      await refresh();
      showToast('Pack deleted successfully', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to delete pack', 'error');
    } finally {
      setLoading(false);
    }
  };

  const clearActionForm = () => {
    setActionTitle('');
    setActionSlug('');
    setActionDurationMs(1800);
    setActionCooldownMs(2500);
    setActionActive(true);
    setActionFile(null);
    setActionSourceUrl('');
    setActionAttribution('');
    setActionLicense('');
    setActionTags('');
    setActionImportUrl('');
    setEditingActionId(null);
  };

  const loadActionForEdit = (action: StreamAction) => {
    setEditingActionId(action.id);
    setActionTitle(action.title);
    setActionSlug(action.slug);
    setActionDurationMs(action.duration_ms);
    setActionCooldownMs(action.cooldown_ms);
    setActionActive(action.is_active);
    setActionSourceUrl(action.source_url || '');
    setActionAttribution(action.attribution || '');
    setActionLicense(action.license || '');
    setActionTags(action.tags?.join(', ') || '');
    setActionFile(null);
    setActionImportUrl('');
  };

  const uploadAndCreateAction = async () => {
    if (!selectedPack) {
      showToast('Select a pack first', 'warning');
      return;
    }
    if (!editingActionId && !actionFile && !actionImportUrl) {
      showToast('Choose an image/gif file or provide an import URL', 'warning');
      return;
    }

    const title = String(actionTitle || '').trim();
    const slug = slugify(actionSlug || actionTitle);
    if (!title || !slug) {
      showToast('Missing action title/slug', 'warning');
      return;
    }

    try {
      setLoading(true);

      let publicUrl = editingActionId ? actions.find((a) => a.id === editingActionId)?.image_url || null : null;

      if (actionFile) {
        const ext = (actionFile.name.split('.').pop() || 'png').toLowerCase();
        const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';
        const objectPath = `packs/${selectedPack.slug}/${slug}.${safeExt}`;

        const { error: uploadErr, data: uploadData } = await supabase.storage
          .from('meme-assets')
          .upload(objectPath, actionFile, { upsert: true, cacheControl: '3600' });
        if (uploadErr) throw uploadErr;

        publicUrl = supabase.storage.from('meme-assets').getPublicUrl(uploadData.path).data.publicUrl;
        if (!publicUrl) throw new Error('Failed to create public URL');
      }

      const { data: actionId, error } = await supabase.rpc('admin_upsert_stream_action', {
        p_pack_id: selectedPack.id,
        p_slug: slug,
        p_title: title,
        p_kind: 'image_popup',
        p_render_text: null,
        p_image_url: publicUrl,
        p_sound_key: null,
        p_duration_ms: actionDurationMs,
        p_cooldown_ms: actionCooldownMs,
        p_is_active: actionActive,
        p_source_url: actionSourceUrl ? actionSourceUrl : null,
        p_attribution: actionAttribution ? actionAttribution : null,
        p_license: actionLicense ? actionLicense : null,
        p_tags: actionTags
          ? actionTags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        p_metadata: {},
      });
      if (error) throw error;

      clearActionForm();
      await refreshActions();
      showToast(editingActionId ? 'Action updated successfully' : 'Action created successfully', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to save action', 'error');
    } finally {
      setLoading(false);
    }
  };

  const deleteAction = async (actionId: string) => {
    if (!confirm('Delete this action?')) return;
    try {
      setLoading(true);
      const { error } = await supabase.rpc('admin_delete_stream_action', { p_action_id: actionId });
      if (error) throw error;
      await refreshActions();
      showToast('Action deleted successfully', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to delete action', 'error');
    } finally {
      setLoading(false);
    }
  };

  const importFromUrl = async () => {
    if (!selectedPack) {
      showToast('Select a pack first', 'warning');
      return;
    }
    const title = String(actionTitle || '').trim();
    const slug = slugify(actionSlug || actionTitle);
    const url = String(actionImportUrl || '').trim();
    const license = String(actionLicense || '').trim();
    if (!title || !slug) {
      showToast('Missing action title/slug', 'warning');
      return;
    }
    if (!url) {
      showToast('Missing URL', 'warning');
      return;
    }
    if (!license) {
      showToast('License is required for URL imports', 'warning');
      return;
    }

    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/admin-import-meme-url`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          pack_slug: selectedPack.slug,
          action_slug: slug,
          title,
          url,
          tags: actionTags
            ? actionTags.split(',').map((t) => t.trim()).filter(Boolean)
            : [],
          source_url: actionSourceUrl || null,
          attribution: actionAttribution || null,
          license,
          duration_ms: actionDurationMs,
          cooldown_ms: actionCooldownMs,
          is_active: actionActive,
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || `Import failed (${resp.status})`);
      }

      clearActionForm();
      await refreshActions();
      showToast('Action imported successfully', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Failed to import action', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (isAdmin === false) return null;

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: '14pt', fontWeight: 700 }}>Meme Library Indexer</div>
          <div style={{ fontSize: '9pt', color: '#6b7280' }}>
            Upload assets into <code>meme-assets</code>, then attach them to packs as <code>image_popup</code> actions.
          </div>
        </div>
        <button className="button button-secondary" onClick={() => navigate('/admin/mission-control')} disabled={loading}>
          BACK
        </button>
      </div>

      <div className="card">
        <div className="card-header">Packs</div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: '8pt', color: '#6b7280' }}>Active pack</div>
            <select value={selectedPackId} onChange={(e) => setSelectedPackId(e.target.value)} disabled={loading}>
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.slug}) · ${((p.price_cents || 0) / 100).toFixed(2)} · {p.is_active ? 'active' : 'inactive'}
                </option>
              ))}
            </select>
          </label>

          <div style={{ borderTop: '1px solid #eee', paddingTop: 10 }}>
            <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: 8 }}>Create / Update Pack</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '8pt', color: '#6b7280' }}>Name</span>
                <input value={packName} onChange={(e) => setPackName(e.target.value)} disabled={loading} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '8pt', color: '#6b7280' }}>Slug</span>
                <input value={packSlug} onChange={(e) => setPackSlug(e.target.value)} disabled={loading} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '8pt', color: '#6b7280' }}>Price (cents)</span>
                <input
                  type="number"
                  value={packPriceCents}
                  onChange={(e) => setPackPriceCents(Number(e.target.value))}
                  disabled={loading}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '8pt', color: '#6b7280' }}>Active</span>
                <select value={packActive ? 'true' : 'false'} onChange={(e) => setPackActive(e.target.value === 'true')} disabled={loading}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: '8pt', color: '#6b7280' }}>Description</span>
                <input value={packDescription} onChange={(e) => setPackDescription(e.target.value)} disabled={loading} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, alignItems: 'center' }}>
              <div style={{ fontSize: '8pt', color: '#6b7280' }}>
                {selectedPackId && selectedPack ? (
                  <button
                    className="button button-secondary"
                    onClick={() => void deletePack(selectedPack.id)}
                    disabled={loading}
                    style={{ fontSize: '8pt', padding: '6px 10px' }}
                  >
                    DELETE PACK
                  </button>
                ) : null}
              </div>
              <button className="button button-primary" onClick={() => void createOrUpdatePack()} disabled={loading}>
                {loading ? 'WORKING...' : 'SAVE PACK'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Index a Meme (Upload + Create Action)</div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: '9pt', color: '#6b7280' }}>
            You can upload a file, or import by URL from an allowlisted source (with license/provenance).
          </div>

          {(selectedPackSlug === 'frog' || selectedPackSlug === 'pepe') ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <div style={{ fontSize: '8pt', color: '#6b7280' }}>Quick tags</div>
              <button className="button button-secondary" disabled={loading} onClick={() => addTags(['frog', 'reaction'])} style={{ fontSize: '8pt', padding: '6px 10px' }}>
                frog + reaction
              </button>
              <button className="button button-secondary" disabled={loading} onClick={() => addTags(['pepe', 'frog'])} style={{ fontSize: '8pt', padding: '6px 10px' }}>
                pepe + frog
              </button>
              <button className="button button-secondary" disabled={loading} onClick={() => addTags(['template', 'blank'])} style={{ fontSize: '8pt', padding: '6px 10px' }}>
                template + blank
              </button>
              <button className="button button-secondary" disabled={loading} onClick={() => addTags(['wojak_adjacent'])} style={{ fontSize: '8pt', padding: '6px 10px' }}>
                wojak_adjacent
              </button>
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Title</span>
              <input value={actionTitle} onChange={(e) => setActionTitle(e.target.value)} disabled={loading} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Slug</span>
              <input value={actionSlug} onChange={(e) => setActionSlug(e.target.value)} disabled={loading} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Tags (comma-separated)</span>
              <input value={actionTags} onChange={(e) => setActionTags(e.target.value)} disabled={loading} placeholder="chad, stick_guys, reaction" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Source URL</span>
              <input value={actionSourceUrl} onChange={(e) => setActionSourceUrl(e.target.value)} disabled={loading} placeholder="Where did this come from?" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Attribution</span>
              <input value={actionAttribution} onChange={(e) => setActionAttribution(e.target.value)} disabled={loading} placeholder="Author/creator, if known" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>License</span>
              <input value={actionLicense} onChange={(e) => setActionLicense(e.target.value)} disabled={loading} placeholder="CC0, CC-BY, original, unknown" />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Import URL (https)</span>
              <input
                value={actionImportUrl}
                onChange={(e) => setActionImportUrl(e.target.value)}
                disabled={loading}
                placeholder="https://upload.wikimedia.org/.../file.png"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Duration (ms)</span>
              <input
                type="number"
                value={actionDurationMs}
                onChange={(e) => setActionDurationMs(Number(e.target.value))}
                disabled={loading}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Cooldown (ms)</span>
              <input
                type="number"
                value={actionCooldownMs}
                onChange={(e) => setActionCooldownMs(Number(e.target.value))}
                disabled={loading}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>Active</span>
              <select value={actionActive ? 'true' : 'false'} onChange={(e) => setActionActive(e.target.value === 'true')} disabled={loading}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: '8pt', color: '#6b7280' }}>File (png/jpg/webp/gif)</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setActionFile(e.target.files?.[0] || null)}
                disabled={loading}
              />
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: '8pt', color: '#6b7280' }}>
              Target pack: <b>{selectedPack ? `${selectedPack.name} (${selectedPack.slug})` : 'none'}</b>
              {editingActionId ? <span style={{ marginLeft: 8, color: '#f59e0b' }}>(EDITING)</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {editingActionId ? (
                <button className="button button-secondary" onClick={() => clearActionForm()} disabled={loading}>
                  CANCEL
                </button>
              ) : null}
              <button className="button button-secondary" onClick={() => void importFromUrl()} disabled={loading || !selectedPackId || !!editingActionId}>
                {loading ? 'WORKING...' : 'IMPORT URL'}
              </button>
              <button className="button button-primary" onClick={() => void uploadAndCreateAction()} disabled={loading || !selectedPackId}>
                {loading ? 'WORKING...' : editingActionId ? 'UPDATE ACTION' : 'UPLOAD + CREATE'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedPackId && actions.length > 0 ? (
        <div className="card">
          <div className="card-header">Existing Actions ({actions.length})</div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {actions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {action.image_url ? (
                    <img
                      src={action.image_url}
                      alt={action.title}
                      style={{
                        width: '100%',
                        height: 120,
                        objectFit: 'cover',
                        border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: '4px',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  <div style={{ fontSize: '9pt', fontWeight: 700 }}>{action.title}</div>
                  <div style={{ fontSize: '7pt', color: '#6b7280' }}>
                    {action.tags?.length ? `Tags: ${action.tags.join(', ')}` : 'No tags'}
                  </div>
                  <div style={{ fontSize: '7pt', color: '#6b7280' }}>
                    {action.is_active ? 'Active' : 'Inactive'} · {action.duration_ms}ms
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      className="button button-secondary"
                      onClick={() => loadActionForEdit(action)}
                      disabled={loading}
                      style={{ fontSize: '8pt', padding: '6px 10px', flex: 1 }}
                    >
                      EDIT
                    </button>
                    <button
                      className="button button-secondary"
                      onClick={() => void deleteAction(action.id)}
                      disabled={loading}
                      style={{ fontSize: '8pt', padding: '6px 10px', flex: 1, color: '#dc2626' }}
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


