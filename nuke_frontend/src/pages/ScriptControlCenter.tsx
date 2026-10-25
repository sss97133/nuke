import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import PrefetchLink from '../components/PrefetchLink';
import './ScriptControlCenter.css';
import '../styles/unified-design-system.css';

interface ScriptStatus {
  name: string;
  description: string;
  purpose: string;
  recorded: number | null;
  note: string;
}

// One row per script from admin_script_center_progress() (migration 20260927170400).
interface ScriptProgressRow {
  script_id: string;
  source_table: string;
  processed: number | string | null;
  computed: boolean;
  note: string | null;
}

const SCRIPTS = [
  {
    id: 'angle-setter',
    name: 'Angle Detection',
    description: 'Recorded image angles',
    table: 'vehicle_images'
  },
  {
    id: 'tier1-processor',
    name: 'Tier 1 Organization',
    description: 'Basic categorization (angle, category, components)',
    table: 'vehicle_images'
  },
  {
    id: 'tier2-processor',
    name: 'Tier 2 Parts',
    description: 'Specific part identification',
    table: 'vehicle_images'
  },
  {
    id: 'tier3-processor',
    name: 'Tier 3 Expert',
    description: 'Stage 3 image analysis',
    table: 'vehicle_images'
  },
  {
    id: 'gap-finder',
    name: 'Gap Identification',
    description: 'Find missing documentation',
    table: 'missing_context_reports'
  },
  {
    id: 'completeness-calculator',
    name: 'Profile Completeness',
    description: 'Calculate vehicle profile scores',
    table: 'vehicle_processing_summary'
  }
];

export default function ScriptControlCenter() {
  const [scripts, setScripts] = useState<ScriptStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const request = useRef(0);

  const loadScriptStatus = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const { data, error: readError } = await supabase.rpc('admin_script_center_progress');
      if (readError) throw readError;
      if (!Array.isArray(data)) throw new Error('Coverage reader returned no result.');
      const progressById = new Map<string, ScriptProgressRow>();
      for (const row of data as ScriptProgressRow[]) progressById.set(row.script_id, row);
      const next = SCRIPTS.map(script => {
        const row = progressById.get(script.id);
        const raw = row?.processed;
        const value = row?.computed === true && (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) ? Number(raw) : null;
        const recorded = value != null && Number.isSafeInteger(value) && value >= 0 ? value : null;
        return {
          name: script.name, description: script.description,
          purpose: row?.source_table || script.table,
          recorded,
          note: row?.note || (recorded == null ? 'No recorded count is available from this reader.' : 'Retained rows in this source; no eligible population or completion percentage is supplied.'),
        };
      });
      if (current !== request.current) return;
      setScripts(next);
      setLoadedAt(new Date());
    } catch (cause) {
      if (current !== request.current) return;
      setError(cause instanceof Error ? cause.message : 'Coverage could not be loaded. Try again.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScriptStatus();
    return () => { request.current++; };
  }, [loadScriptStatus]);

  useEffect(() => {
    if (!autoRefresh || loading) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void loadScriptStatus();
    }, 60_000);
    return () => clearInterval(interval);
  }, [autoRefresh, loading, loadScriptStatus]);

  if (loading && !loadedAt) {
    return (
      <div className="script-coverage" role="status">
        Loading recorded coverage…
      </div>
    );
  }

  return (
    <div className="script-coverage" aria-busy={loading}>
      <header className="script-coverage__header">
        <div>
          <PrefetchLink to="/admin">‹ Administration</PrefetchLink>
          <h1>Processing coverage</h1>
          <p>Recorded coverage for the legacy image-processing stages.</p>
        </div>
        <div className="script-coverage__actions">
          <button type="button" className="button button-secondary" aria-pressed={autoRefresh} onClick={() => setAutoRefresh(value => !value)}>
            {autoRefresh ? 'Auto-refresh on · 1 min' : 'Auto-refresh off'}
          </button>
          <button type="button" className="button button-primary" disabled={loading} onClick={() => void loadScriptStatus()}>{loading ? 'Refreshing…' : 'Refresh coverage'}</button>
        </div>
      </header>
      <p>These counts do not establish whether a worker is running, successful, or complete. Cost and finish time are not measured here.</p>
      <nav className="script-coverage__actions" aria-label="Processing monitors">
        <PrefetchLink to="/admin/data-pulse">Data activity</PrefetchLink>
        <PrefetchLink to="/admin/sources">Source intake</PrefetchLink>
        <PrefetchLink to="/admin/image-processing">Image processing</PrefetchLink>
      </nav>
      {error && <div role="alert" className="script-coverage__error">{loadedAt ? 'Refresh failed; showing the last loaded coverage. ' : 'Coverage unavailable. '}{error}</div>}
      {loadedAt && <p className="script-coverage__clock">Loaded {loadedAt.toLocaleString()}. Each source may have its own recording date.</p>}
      <div className="script-coverage__grid">
        {scripts.map(script => (
          <section key={script.name} className="card" aria-label={script.name}>
            <div className="card-body">
              <h2>{script.name}</h2>
              <p>{script.description}</p>
              <dl>
                <div><dt>Recorded rows</dt><dd>{script.recorded == null ? 'Not computed' : script.recorded.toLocaleString()}</dd></div>
                <div><dt>Source</dt><dd><code>{script.purpose}</code></dd></div>
              </dl>
              <p>{script.note}</p>
            </div>
          </section>
        ))}
      </div>

    </div>
  );
}
