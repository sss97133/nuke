import React, { useEffect, useMemo, useState } from 'react';
import { StreamActionsService, type ContentActionEvent } from '../../services/streamActionsService';

function formatTarget(targetKey: string): string {
  const s = String(targetKey || '');
  if (s.startsWith('vehicle:')) return `Vehicle ${s.slice('vehicle:'.length).slice(-6)}`;
  return s;
}

export const MemelordPanel: React.FC<{ userId: string }> = ({ userId }) => {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<ContentActionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = events.length;
    const spentCents = events.reduce((sum, e) => sum + (e.cost_cents || 0), 0);
    const byTarget = new Map<string, number>();
    for (const e of events) byTarget.set(e.target_key, (byTarget.get(e.target_key) || 0) + 1);
    const topTargets = Array.from(byTarget.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return { total, spentCents, topTargets };
  }, [events]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await StreamActionsService.listMyContentActions(userId, 200);
        if (!mounted) return;
        setEvents(data);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load meme drops');
        setEvents([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>Meme Library Activity</div>
        <div style={{ fontSize: '8pt', color: '#6b7280' }}>
          Total: {stats.total} · Spent: ${((stats.spentCents || 0) / 100).toFixed(2)}
        </div>
      </div>
      <div className="card-body" style={{ fontSize: '9pt' }}>
        {loading && <div className="text text-muted">Loading…</div>}
        {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div className="text text-muted">No activity yet.</div>
        )}

        {!loading && !error && events.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div className="text text-bold" style={{ marginBottom: 8 }}>Top targets</div>
              {stats.topTargets.map(([key, count]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div className="text text-small">{formatTarget(key)}</div>
                  <div className="text text-small text-muted">{count}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="text text-bold" style={{ marginBottom: 8 }}>Recent drops</div>
              {events.slice(0, 8).map((e) => (
                <div key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <div className="text text-small text-bold">{e.title}</div>
                  <div className="text text-small text-muted" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{formatTarget(e.target_key)}</span>
                    <span>{new Date(e.created_at).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemelordPanel;


