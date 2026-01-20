import React from 'react';
import { supabase } from '../../lib/supabase';

type Mode = 'snapshot' | 'explain';

function n(v: any): string {
  const num = Number(v);
  if (!Number.isFinite(num)) return String(v ?? '—');
  return num.toLocaleString();
}

export default function AdminRalphBrief() {
  const [mode, setMode] = React.useState<Mode>('snapshot');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<any | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<Date | null>(null);

  const load = React.useCallback(async (m: Mode) => {
    setMode(m);
    setLoading(true);
    setError(null);
    try {
      const action = m === 'snapshot' ? 'dry_run' : 'brief';
      const { data, error } = await supabase.functions.invoke('ralph-wiggum-rlm-extraction-coordinator', {
        body: { action, max_failed_samples: 250 }
      });
      if (error) throw error;
      setData(data || null);
      setUpdatedAt(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load Ralph brief');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load('snapshot');
  }, [load]);

  const snapshot = data?.snapshot;
  const output = data?.output;
  const pausedHint = Boolean(snapshot?.analysis?.paused_hint);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Ralph Brief</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            A single page to tell you what’s on fire and what to do next.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {updatedAt && (
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              updated {updatedAt.toLocaleTimeString()}
            </div>
          )}
          <button className="button button-secondary" disabled={loading} onClick={() => void load('snapshot')}>
            Snapshot
          </button>
          <button className="button" disabled={loading} onClick={() => void load('explain')}>
            {loading && mode === 'explain' ? 'Working…' : 'Explain'}
          </button>
        </div>
      </div>

      <div style={{
        marginTop: 'var(--space-4)',
        borderRadius: '0px',
        border: '2px solid var(--border-light)',
        backgroundColor: 'var(--white)',
        padding: 'var(--space-4)'
      }}>
        <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Kill switch</div>
        <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>
          If analysis is running amuck (cost/log spam), pause it first. Then triage calmly.
        </div>
        <div style={{ marginTop: 'var(--space-3)', fontSize: '8pt' }}>
          <b>Status</b>: {pausedHint ? 'PAUSED' : 'ACTIVE'}
        </div>
        {!pausedHint && (
          <div style={{ marginTop: '8px', fontSize: '8pt', color: 'var(--text-muted)', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            Set Supabase Edge Function secret:
            {'\n'}NUKE_ANALYSIS_PAUSED=1
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 'var(--space-4)', fontSize: '8pt', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {snapshot && (
        <div style={{
          marginTop: 'var(--space-4)',
          borderRadius: '0px',
          border: '2px solid var(--border-light)',
          backgroundColor: 'var(--white)',
          padding: 'var(--space-4)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>System snapshot</div>

          <div style={{
            marginTop: 'var(--space-3)',
            fontSize: '8pt',
            color: 'var(--text)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)'
          }}>
            <div><b>import_queue</b>: {n(snapshot.queue?.pending)} pending / {n(snapshot.queue?.failed)} failed / {n(snapshot.queue?.processing)} processing</div>
            <div><b>vehicles</b>: {n(snapshot.vehicles?.total)} total / {n(snapshot.vehicles?.created_last_24h)} last 24h</div>
            <div><b>sources</b>: {n(snapshot.sources?.active)} active</div>
            {snapshot.analysis?.vehicle_image_analysis && (
              <div><b>vehicle_images</b>: {n(snapshot.analysis.vehicle_image_analysis.pending)} pending / {n(snapshot.analysis.vehicle_image_analysis.analyzed)} analyzed</div>
            )}
            {snapshot.analysis?.analysis_queue && (
              <div><b>analysis_queue</b>: {n((snapshot.analysis.analysis_queue.pending ?? 0) + (snapshot.analysis.analysis_queue.retrying ?? 0))} pending/retrying</div>
            )}
          </div>

          <div style={{ marginTop: 'var(--space-4)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
            <div style={{ border: '1px solid var(--border-light)', background: 'var(--grey-50)', padding: 'var(--space-3)' }}>
              <div style={{ fontSize: '8pt', fontWeight: 600 }}>Top failing domains</div>
              <div style={{ marginTop: '8px', fontSize: '8pt', fontFamily: 'monospace', color: 'var(--text)' }}>
                {(snapshot.triage?.top_failed_domains || []).slice(0, 10).map((d: any, idx: number) => (
                  <div key={idx}>{String(d?.count ?? 0).padStart(4, ' ')}  {String(d?.key || '')}</div>
                ))}
                {(snapshot.triage?.top_failed_domains || []).length === 0 ? <div style={{ color: 'var(--text-muted)' }}>—</div> : null}
              </div>
            </div>

            <div style={{ border: '1px solid var(--border-light)', background: 'var(--grey-50)', padding: 'var(--space-3)' }}>
              <div style={{ fontSize: '8pt', fontWeight: 600 }}>Top error patterns</div>
              <div style={{ marginTop: '8px', fontSize: '8pt', fontFamily: 'monospace', color: 'var(--text)' }}>
                {(snapshot.triage?.top_error_patterns || []).slice(0, 10).map((e: any, idx: number) => (
                  <div key={idx}>{String(e?.count ?? 0).padStart(4, ' ')}  {String(e?.key || '')}</div>
                ))}
                {(snapshot.triage?.top_error_patterns || []).length === 0 ? <div style={{ color: 'var(--text-muted)' }}>—</div> : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {Array.isArray(output?.headlines) && output.headlines.length > 0 && (
        <div style={{
          marginTop: 'var(--space-4)',
          borderRadius: '0px',
          border: '2px solid var(--border-light)',
          backgroundColor: 'var(--white)',
          padding: 'var(--space-4)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Headlines</div>
          <ul style={{ marginTop: 'var(--space-2)', paddingLeft: '18px', fontSize: '8pt', color: 'var(--text)' }}>
            {output.headlines.slice(0, 10).map((h: string, idx: number) => (
              <li key={idx} style={{ marginBottom: '4px' }}>{h}</li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(output?.priorities_now) && output.priorities_now.length > 0 && (
        <div style={{
          marginTop: 'var(--space-4)',
          borderRadius: '0px',
          border: '2px solid var(--border-light)',
          backgroundColor: 'var(--white)',
          padding: 'var(--space-4)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Do now</div>
          <div style={{ marginTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
            {output.priorities_now.slice(0, 6).map((p: any, idx: number) => (
              <div key={idx} style={{ border: '1px solid var(--border-light)', background: 'var(--grey-50)', padding: 'var(--space-3)' }}>
                <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>{String(p?.title || 'Untitled')}</div>
                {p?.why ? (
                  <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>
                    {String(p.why)}
                  </div>
                ) : null}
                {Array.isArray(p?.steps) && p.steps.length > 0 ? (
                  <ul style={{ marginTop: '10px', paddingLeft: '18px', fontSize: '8pt', color: 'var(--text)' }}>
                    {p.steps.slice(0, 6).map((s: string, sidx: number) => (
                      <li key={sidx} style={{ marginBottom: '4px' }}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

