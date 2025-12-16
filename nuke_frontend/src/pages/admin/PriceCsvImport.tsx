import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AdminNotificationService } from '../../services/adminNotificationService';
import '../../design-system.css';

interface CsvRow {
  id: string;
  msrp?: number | null;
  current_value?: number | null;
  purchase_price?: number | null;
  asking_price?: number | null;
  sale_price?: number | null;
  is_for_sale?: boolean | null;
}

const NUMERIC_KEYS: (keyof CsvRow)[] = ['msrp','current_value','purchase_price','asking_price','sale_price'];

const to8 = { fontSize: '8pt' } as const;
const inputStyle: React.CSSProperties = { ...to8, padding: '2px 4px', border: '1px solid #c0c0c0', borderRadius: 0 };
const chip: React.CSSProperties = { ...to8, background: 'var(--bg)', border: '1px solid #c0c0c0', padding: '1px 4px', borderRadius: 2 };

const PriceCsvImport: React.FC = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  const [text, setText] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; errors: number }>({ done: 0, total: 0, errors: 0 });

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setIsAdmin(false); navigate('/login'); return; }
        const ok = await AdminNotificationService.isCurrentUserAdmin();
        if (!ok) { setIsAdmin(false); navigate('/org/dashboard'); return; }
        setIsAdmin(true);
      } catch {
        setIsAdmin(false); navigate('/org/dashboard');
      }
    })();
  }, []);

  const parseCsv = (csv: string) => {
    setParsingError(null);
    try {
      const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length === 0) { setRows([]); return; }
      const header = splitCsvLine(lines[0]).map(h => h.trim());
      const out: CsvRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        if (cols.length === 1 && cols[0].trim() === '') continue;
        const obj: any = {};
        header.forEach((h, idx) => {
          const raw = (cols[idx] ?? '').trim();
          if (h === 'id') {
            obj.id = raw;
          } else if (NUMERIC_KEYS.includes(h as keyof CsvRow)) {
            obj[h] = raw === '' ? null : Number(raw);
          } else if (h === 'is_for_sale') {
            obj.is_for_sale = raw === '' ? null : /^true|1|yes$/i.test(raw);
          }
        });
        if (obj.id) out.push(obj as CsvRow);
      }
      setRows(out);
    } catch (e: any) {
      setParsingError(e?.message || 'Failed to parse CSV');
      setRows([]);
    }
  };

  const onFile = async (f: File) => {
    const txt = await f.text();
    setText(txt);
    parseCsv(txt);
  };

  const templateCsv = useMemo(() => {
    return [
      'id,msrp,current_value,purchase_price,asking_price,sale_price,is_for_sale',
      '00000000-0000-0000-0000-000000000000,45000,,38000,42000,,true'
    ].join('\n');
  }, []);

  const downloadTemplate = () => {
    const blob = new Blob([templateCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'price_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const process = async () => {
    if (rows.length === 0) return;
    if (dryRun) { alert(`Dry run: ${rows.length} rows parsed. Toggle off to import.`); return; }
    setSaving(true);
    setProgress({ done: 0, total: rows.length, errors: 0 });

    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        try {
          const payload: any = {};
          NUMERIC_KEYS.forEach(k => {
            const val = r[k];
            if (typeof val === 'number') payload[k] = val;
          });
          if (typeof r.is_for_sale === 'boolean') payload.is_for_sale = r.is_for_sale;
          if (Object.keys(payload).length > 0) {
            const { error } = await supabase.from('vehicles').update(payload).eq('id', r.id);
            if (error) throw error;
            // Insert history for provided numeric fields
            const entries: any[] = [];
            NUMERIC_KEYS.forEach(k => {
              const val = r[k];
              if (typeof val === 'number') {
                const type = k === 'msrp' ? 'msrp'
                  : k === 'purchase_price' ? 'purchase'
                  : k === 'current_value' ? 'current'
                  : k === 'asking_price' ? 'asking'
                  : 'sale';
                entries.push({ vehicle_id: r.id, price_type: type, value: val, source: 'admin_csv_import' });
              }
            });
            if (entries.length > 0) {
              const { error: histErr } = await supabase.from('vehicle_price_history').insert(entries);
              if (histErr) console.debug('history insert skipped:', histErr.message);
            }
          }
          setProgress(p => ({ ...p, done: p.done + 1 }));
        } catch (e) {
          console.error('Row failed:', r.id, e);
          setProgress(p => ({ ...p, done: p.done + 1, errors: p.errors + 1 }));
        }
      }
      alert(`Import completed. Success: ${progress.total - progress.errors}, Errors: ${progress.errors}`);
    } finally {
      setSaving(false);
    }
  };

  if (isAdmin === false) return null;

  return (
    <div className="container compact">
      <div className="card" style={{ border: '1px solid #c0c0c0' }}>
        <div className="card-header" style={{ ...to8, padding: 6, borderBottom: '1px solid #c0c0c0', background: 'var(--bg)' }}>
          <div className="text text-bold" style={to8}>CSV Price Import</div>
        </div>
        <div className="card-body" style={{ padding: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button className="button button-small" onClick={downloadTemplate}>Download Template</button>
            <label className="button button-small" style={{ cursor: 'pointer' }}>
              Upload CSV
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => e.target.files && onFile(e.target.files[0])} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
              <span style={to8}>Dry Run</span>
            </label>
            <button className="button button-small button-primary" onClick={process} disabled={saving || rows.length === 0}>
              {saving ? `Importing (${progress.done}/${progress.total})` : 'Start Import'}
            </button>
          </div>

          <div style={{ marginBottom: 6 }}>
            <div className="text text-muted" style={to8}>Paste CSV:</div>
            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); parseCsv(e.target.value); }}
              placeholder="id,msrp,current_value,purchase_price,asking_price,sale_price,is_for_sale\n..."
              style={{ width: '100%', height: 140, ...inputStyle }}
            />
            {parsingError && <div className="text" style={{ ...to8, color: '#800000' }}>{parsingError}</div>}
          </div>

          <div style={{ marginTop: 8 }}>
            <div className="text text-bold" style={to8}>Preview ({rows.length} rows)</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['id','msrp','purchase_price','current_value','asking_price','sale_price','is_for_sale'].map(h => (
                      <th key={h} style={{ borderBottom: '1px solid #c0c0c0', textAlign: 'left', padding: '2px 4px', ...to8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map(r => (
                    <tr key={r.id}>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.id}</td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.msrp ?? ''}</td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.purchase_price ?? ''}</td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.current_value ?? ''}</td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.asking_price ?? ''}</td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.sale_price ?? ''}</td>
                      <td style={{ borderBottom: '1px solid #e5e7eb', padding: '2px 4px', ...to8 }}>{r.is_for_sale === null || r.is_for_sale === undefined ? '' : (r.is_for_sale ? 'true' : 'false')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <span style={chip}>Parsed: {rows.length}</span>
            <span style={chip}>Progress: {progress.done}/{progress.total}</span>
            <span style={chip}>Errors: {progress.errors}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Split a CSV line by commas not inside quotes
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { // escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result.map(s => s.replace(/^\"|\"$/g, ''));
}

export default PriceCsvImport;
