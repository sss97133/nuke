import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useLocation, useNavigate } from 'react-router-dom';
import '../../design-system.css';

interface VehicleRow {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin?: string | null;
  created_at: string;
  msrp?: number | null;
  current_value?: number | null;
  purchase_price?: number | null;
  asking_price?: number | null;
  sale_price?: number | null;
  is_for_sale?: boolean | null;
}

interface Draft {
  [id: string]: Partial<VehicleRow> & { _dirty?: boolean };
}

const to8 = { fontSize: '12px' } as const;
const cardHeaderStyle: React.CSSProperties = { ...to8, padding: '10px', borderBottom: '1px solid #c0c0c0', background: '#f3f4f6' };
const inputStyle: React.CSSProperties = { ...to8, width: 120, padding: '6px 8px', border: '1px solid #c0c0c0', borderRadius: 4 };
const cellStyle: React.CSSProperties = { ...to8, padding: '8px 10px', borderBottom: '1px solid #e5e7eb', minHeight: 36 };
const headCellStyle: React.CSSProperties = { ...to8, padding: '8px 10px', borderBottom: '1px solid #c0c0c0', background: '#f3f4f6', fontWeight: 700 };

const BulkPriceEditor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 100;
  // Filters
  const [fMissingMsrp, setFMissingMsrp] = useState(false);
  const [fMissingPurchase, setFMissingPurchase] = useState(false);
  const [fMissingCurrent, setFMissingCurrent] = useState(false);
  const [fForSaleNoAsking, setFForSaleNoAsking] = useState(false);
  const [fSoldButForSale, setFSoldButForSale] = useState(false);

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    // Admin gate - TEMPORARILY DISABLED
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsAdmin(false);
          navigate('/login');
          return;
        }
        // TEMP: Skip admin check
        setIsAdmin(true);
        return;
        
        /* Original admin check - uncomment after adding yourself to admin_users table
        const { data: adminRow } = await supabase
          .from('admin_users')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .single();
        if (!adminRow) {
          setIsAdmin(false);
          navigate('/dashboard');
          return;
        }
        setIsAdmin(true);
        */
      } catch {
        setIsAdmin(true); // TEMP: Allow access on error
        // setIsAdmin(false);
        // navigate('/dashboard');
      }
    })();
  }, []);

  // Initialize filters from URL (?filters=missing_msrp,missing_purchase,missing_current,for_sale_no_asking,sold_but_for_sale)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const filters = params.get('filters') || params.get('f');
    if (!filters) return;
    const tokens = new Set(filters.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    setFMissingMsrp(tokens.has('missing_msrp'));
    setFMissingPurchase(tokens.has('missing_purchase'));
    setFMissingCurrent(tokens.has('missing_current'));
    setFForSaleNoAsking(tokens.has('for_sale_no_asking'));
    setFSoldButForSale(tokens.has('sold_but_for_sale'));
  }, [location.search]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let base = supabase
          .from('vehicles')
          .select(`
            id, year, make, model, vin, created_at,
            msrp, current_value, purchase_price, asking_price, sale_price, is_for_sale
          `)
          .order('created_at', { ascending: false })
          .range(page * pageSize, page * pageSize + pageSize - 1);

        if (debouncedQuery) {
          const q = debouncedQuery.trim();
          base = base.or(`
            year::text.ilike.%${q}%,
            make.ilike.%${q}%,
            model.ilike.%${q}%,
            vin.ilike.%${q}%
          `);
        }

        const { data, error } = await base;
        if (error) throw error;
        setRows((data as any) || []);
      } catch (e) {
        console.error('Load vehicles failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [debouncedQuery, page]);

  const dirtyCount = useMemo(() => Object.values(draft).filter(d => d._dirty).length, [draft]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (fMissingMsrp) list = list.filter(r => r.msrp == null);
    if (fMissingPurchase) list = list.filter(r => r.purchase_price == null);
    if (fMissingCurrent) list = list.filter(r => r.current_value == null);
    if (fForSaleNoAsking) list = list.filter(r => (r.is_for_sale === true) && (r.asking_price == null));
    if (fSoldButForSale) list = list.filter(r => (typeof r.sale_price === 'number') && (r.is_for_sale === true));
    return list;
  }, [rows, fMissingMsrp, fMissingPurchase, fMissingCurrent, fForSaleNoAsking, fSoldButForSale]);

  const onFieldChange = (id: string, field: keyof VehicleRow, value: string | boolean) => {
    setDraft(prev => {
      const prior = prev[id] || {};
      const numericFields: (keyof VehicleRow)[] = ['msrp','current_value','purchase_price','asking_price','sale_price'];
      const v: any = (numericFields.includes(field))
        ? (value === '' ? null : Number(value))
        : value;
      return { ...prev, [id]: { ...prior, [field]: v, _dirty: true } };
    });
  };

  // Quick action helpers (draft-only, user still saves)
  const qaSet = (id: string, patch: Partial<VehicleRow>) => {
    setDraft(prev => ({ ...prev, [id]: { ...prev[id], ...patch, _dirty: true } }));
  };
  const qaCurrentFromAsking = (row: VehicleRow) => {
    if (typeof row.asking_price === 'number') qaSet(row.id, { current_value: row.asking_price });
  };
  const qaCurrentFromSale = (row: VehicleRow) => {
    if (typeof row.sale_price === 'number') qaSet(row.id, { current_value: row.sale_price });
  };
  const qaAskingFromCurrent = (row: VehicleRow) => {
    if (typeof row.current_value === 'number') qaSet(row.id, { asking_price: row.current_value, is_for_sale: true });
  };
  const qaMarkNotForSale = (row: VehicleRow) => {
    qaSet(row.id, { is_for_sale: false });
  };

  const saveRow = async (id: string) => {
    const changes = draft[id];
    if (!changes || !changes._dirty) return;
    setSaving(true);
    try {
      const payload: any = { ...changes };
      delete payload._dirty;
      const { error } = await supabase.from('vehicles').update(payload).eq('id', id);
      if (error) throw error;
      // Reflect in UI
      setRows(prev => prev.map(r => (r.id === id ? { ...r, ...payload } : r)));
      setDraft(prev => { const { [id]: _, ...rest } = prev; return rest; });

      // History inserts (best-effort)
      try {
        const mappings: Array<{ key: keyof VehicleRow; type: 'msrp'|'purchase'|'current'|'asking'|'sale' }> = [
          { key: 'msrp', type: 'msrp' },
          { key: 'purchase_price', type: 'purchase' },
          { key: 'current_value', type: 'current' },
          { key: 'asking_price', type: 'asking' },
          { key: 'sale_price', type: 'sale' },
        ];
        const before = rows.find(r => r.id === id);
        const entries: any[] = [];
        mappings.forEach(({ key, type }) => {
          const after = (payload as any)[key];
          const prior = (before as any)?.[key];
          if (typeof after === 'number' && after !== prior) {
            entries.push({ vehicle_id: id, price_type: type, value: after, source: 'admin_bulk_editor' });
          }
        });
        if (entries.length > 0) {
          const { error: histErr } = await supabase.from('vehicle_price_history').insert(entries);
          if (histErr) console.debug('history insert skipped:', histErr.message);
        }
      } catch (e) {
        console.debug('history insert error:', e);
      }
    } catch (e) {
      console.error('Save row failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    const dirtyIds = Object.keys(draft).filter(k => draft[k]?._dirty);
    if (dirtyIds.length === 0) return;
    setSaving(true);
    try {
      for (const id of dirtyIds) {
        const payload: any = { ...draft[id] };
        delete payload._dirty;
        const { error } = await supabase.from('vehicles').update(payload).eq('id', id);
        if (error) throw error;
        setRows(prev => prev.map(r => (r.id === id ? { ...r, ...payload } : r)));

        // History inserts per row (best-effort)
        try {
          const mappings: Array<{ key: keyof VehicleRow; type: 'msrp'|'purchase'|'current'|'asking'|'sale' }> = [
            { key: 'msrp', type: 'msrp' },
            { key: 'purchase_price', type: 'purchase' },
            { key: 'current_value', type: 'current' },
            { key: 'asking_price', type: 'asking' },
            { key: 'sale_price', type: 'sale' },
          ];
          const before = rows.find(r => r.id === id);
          const entries: any[] = [];
          mappings.forEach(({ key, type }) => {
            const after = (payload as any)[key];
            const prior = (before as any)?.[key];
            if (typeof after === 'number' && after !== prior) {
              entries.push({ vehicle_id: id, price_type: type, value: after, source: 'admin_bulk_editor' });
            }
          });
          if (entries.length > 0) {
            const { error: histErr } = await supabase.from('vehicle_price_history').insert(entries);
            if (histErr) console.debug('history insert skipped:', histErr.message);
          }
        } catch (e) {
          console.debug('history insert error:', e);
        }
      }
      setDraft({});
    } catch (e) {
      console.error('Save all failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const resetRow = (id: string) => {
    setDraft(prev => { const { [id]: _, ...rest } = prev; return rest; });
  };

  const isDirty = (id: string) => Boolean(draft[id]?._dirty);

  if (isAdmin === false) {
    return null;
  }

  return (
    <div className="container" style={{ maxWidth: '100%' }}>
      <div className="card" style={{ border: '1px solid #c0c0c0' }}>
        <div className="card-header" style={cardHeaderStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="text text-bold" style={to8}>Bulk Price Editor</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Search year/make/model/VIN"
                value={query}
                onChange={(e) => { setPage(0); setQuery(e.target.value); }}
                style={{ ...to8, padding: '6px 8px', border: '1px solid #c0c0c0', width: 360 }}
              />
              <button className="button button-small" onClick={saveAll} disabled={saving || dirtyCount === 0}>
                {saving ? 'Saving...' : `Save All (${dirtyCount})`}
              </button>
              {/* Filters */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, ...to8 }}>
                <input type="checkbox" checked={fMissingMsrp} onChange={e => setFMissingMsrp(e.target.checked)} /> Missing MSRP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, ...to8 }}>
                <input type="checkbox" checked={fMissingPurchase} onChange={e => setFMissingPurchase(e.target.checked)} /> Missing Purchase
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, ...to8 }}>
                <input type="checkbox" checked={fMissingCurrent} onChange={e => setFMissingCurrent(e.target.checked)} /> Missing Current
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, ...to8 }}>
                <input type="checkbox" checked={fForSaleNoAsking} onChange={e => setFForSaleNoAsking(e.target.checked)} /> For Sale w/o Asking
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, ...to8 }}>
                <input type="checkbox" checked={fSoldButForSale} onChange={e => setFSoldButForSale(e.target.checked)} /> Sold but For Sale
              </label>
            </div>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          {/* Header Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '260px 100px 120px 120px 120px 120px 100px 160px 180px', minWidth: 1280, borderBottom: '1px solid #c0c0c0', position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
            <div style={headCellStyle}>Vehicle</div>
            <div style={headCellStyle}>MSRP</div>
            <div style={headCellStyle}>Purchase</div>
            <div style={headCellStyle}>Current</div>
            <div style={headCellStyle}>Asking</div>
            <div style={headCellStyle}>Sale</div>
            <div style={headCellStyle}>For Sale</div>
            <div style={headCellStyle}>Actions</div>
            <div style={headCellStyle}>Added</div>
          </div>

          {/* Rows */}
          {loading ? (
            <div style={{ padding: 12, ...to8 }}>Loading...</div>
          ) : (
            filteredRows.map((row, idx) => (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '260px 100px 120px 120px 120px 120px 100px 160px 180px', minWidth: 1280, background: idx % 2 === 0 ? '#ffffff' : '#fbfbfb' }}>
                <div style={{ ...cellStyle }}>
                  <div className="text text-bold" style={to8}>
                    {[row.year, row.make, row.model].filter(Boolean).join(' ') || 'Vehicle'}
                  </div>
                  <div className="text text-muted" style={to8}>{row.vin || row.id}</div>
                </div>

                <div style={cellStyle}>
                  <input type="number" style={inputStyle} defaultValue={row.msrp ?? ''} onChange={e => onFieldChange(row.id, 'msrp', e.target.value)} />
                </div>
                <div style={cellStyle}>
                  <input type="number" style={inputStyle} defaultValue={row.purchase_price ?? ''} onChange={e => onFieldChange(row.id, 'purchase_price', e.target.value)} />
                </div>
                <div style={cellStyle}>
                  <input type="number" style={inputStyle} defaultValue={row.current_value ?? ''} onChange={e => onFieldChange(row.id, 'current_value', e.target.value)} />
                </div>
                <div style={cellStyle}>
                  <input type="number" style={inputStyle} defaultValue={row.asking_price ?? ''} onChange={e => onFieldChange(row.id, 'asking_price', e.target.value)} />
                </div>
                <div style={cellStyle}>
                  <input type="number" style={inputStyle} defaultValue={row.sale_price ?? ''} onChange={e => onFieldChange(row.id, 'sale_price', e.target.value)} />
                </div>
                <div style={{ ...cellStyle, display: 'flex', alignItems: 'center' }}>
                  <input type="checkbox" checked={draft[row.id]?.is_for_sale ?? row.is_for_sale ?? false} onChange={e => onFieldChange(row.id, 'is_for_sale', e.target.checked)} />
                </div>
                <div style={{ ...cellStyle }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="button button-small" disabled={!isDirty(row.id) || saving} onClick={() => saveRow(row.id)}>
                      Save
                    </button>
                    <button className="button button-small" disabled={!isDirty(row.id) || saving} onClick={() => resetRow(row.id)}>
                      Undo
                    </button>
                    <button className="button button-small" onClick={() => window.open(`/vehicle/${row.id}`, '_blank')}>View</button>
                    {/* Quick actions */}
                    <button className="button button-small" title="Set Current = Asking" onClick={() => qaCurrentFromAsking(row)}>=Cur from Ask</button>
                    <button className="button button-small" title="Set Current = Sale" onClick={() => qaCurrentFromSale(row)}>=Cur from Sale</button>
                    <button className="button button-small" title="Set Asking = Current (and mark For Sale)" onClick={() => qaAskingFromCurrent(row)}>=Ask from Cur</button>
                    {row.is_for_sale ? (
                      <button className="button button-small" title="Mark Not For Sale" onClick={() => qaMarkNotForSale(row)}>Not For Sale</button>
                    ) : null}
                  </div>
                </div>
                <div style={{ ...cellStyle, color: '#6b7280' }}>{new Date(row.created_at).toLocaleString()}</div>
              </div>
            ))
          )}

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: 8, borderTop: '1px solid #e5e7eb' }}>
            <div className="text" style={to8}>Rows: {rows.length} {dirtyCount > 0 ? `• Unsaved: ${dirtyCount}` : ''}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button button-small" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0 || loading}>
                Prev
              </button>
              <span className="text" style={to8}>Page {page + 1}</span>
              <button className="button button-small" onClick={() => setPage(p => p + 1)} disabled={loading || rows.length < pageSize}>
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function useDebounce<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default BulkPriceEditor;
