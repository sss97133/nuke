import React, { useMemo, useRef, useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useNavigate } from 'react-router-dom';

type NLQResponse = {
  query: string;
  sql: string;
  explanation?: string;
  confidence?: number;
  rows?: Array<Record<string, any>>;
  row_count?: number;
  provider?: string;
  model?: string;
  source?: string;
  error?: string;
};

type QueryTurn = {
  id: string;
  question: string;
  createdAt: string;
  status: 'running' | 'done' | 'error';
  response?: NLQResponse;
  error?: string;
};

const EXAMPLES = [
  'What car models do we have the most of?',
  'Top 20 makes by vehicle count',
  'How many vehicles were added in the last 30 days?',
  'Most common make/model pairs this year',
];

export default function NLQueryConsole() {
  const navigate = useNavigate();
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [limit, setLimit] = useState(20);
  const [includeMerged, setIncludeMerged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<QueryTurn[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeTurn = useMemo(() => {
    if (!turns.length) return null;
    if (activeId) {
      const found = turns.find((t) => t.id === activeId);
      if (found) return found;
    }
    return turns[turns.length - 1];
  }, [activeId, turns]);

  const rows = activeTurn?.response?.rows || [];
  const columns = useMemo(() => {
    if (!rows.length) return [];
    return Object.keys(rows[0]);
  }, [rows]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  useEffect(() => {
    setShowRaw(false);
  }, [activeId]);

  const summarizeTurn = (turn: QueryTurn) => {
    if (turn.status === 'running') return 'Running query...';
    if (turn.status === 'error') return turn.error || 'Query failed';
    const rowCount = turn.response?.row_count ?? turn.response?.rows?.length ?? 0;
    const explanation = turn.response?.explanation ? ` ${turn.response.explanation}` : '';
    return `Returned ${rowCount} rows.${explanation}`;
  };

  const runQuery = async (overrideQuery?: string) => {
    const question = (overrideQuery ?? query).trim();
    if (!question || loading) return;
    setLoading(true);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextTurn: QueryTurn = {
      id,
      question,
      createdAt: new Date().toISOString(),
      status: 'running',
    };
    setTurns((prev) => [...prev, nextTurn]);
    setActiveId(id);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('nlq-sql', {
        body: {
          query: question,
          limit,
          include_merged: includeMerged,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: 'done', response: data as NLQResponse }
            : t
        )
      );
      setQuery('');
    } catch (e: any) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: 'error', error: e?.message || 'Query failed' }
            : t
        )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCopySql = async () => {
    const sql = activeTurn?.response?.sql;
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedId(activeTurn?.id || null);
      setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // ignore copy errors
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runQuery();
    }
  };

  if (adminLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        Checking admin access...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        <div style={{ marginBottom: '16px', fontWeight: 700 }}>Access Denied</div>
        <div style={{ marginBottom: '16px' }}>Admin privileges are required to access this page.</div>
        <button
          className="button button-secondary"
          onClick={() => navigate('/org/dashboard')}
          style={{ fontSize: '8pt', padding: '8px 16px' }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Query Chat
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Chat to query <span style={{ fontFamily: 'monospace' }}>public.vehicles</span>. Results and SQL are shown on the right.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.1fr) minmax(380px, 1.9fr)', gap: '16px' }}>
        <div className="card" style={{ border: '2px solid var(--border-light)', display: 'flex', flexDirection: 'column', minHeight: '560px' }}>
          <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
            Chat
          </div>
          <div className="card-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {turns.length === 0 && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                Ask a question to start. You can keep multiple queries in this thread.
              </div>
            )}
            {turns.map((turn) => (
              <div key={turn.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
                  <div style={{
                    background: 'var(--accent)',
                    color: 'var(--white)',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    fontSize: '8pt',
                  }}>
                    {turn.question}
                  </div>
                </div>
                <div style={{ alignSelf: 'flex-start', maxWidth: '88%' }}>
                  <div style={{
                    background: 'var(--grey-50)',
                    color: 'var(--text)',
                    padding: '8px 10px',
                    borderRadius: '10px',
                    fontSize: '8pt',
                    border: turn.id === activeId ? '1px solid var(--accent)' : '1px solid var(--border-light)',
                  }}>
                    {summarizeTurn(turn)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveId(turn.id)}
                    style={{
                      marginTop: '6px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '8pt',
                    }}
                  >
                    View details →
                  </button>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px', display: 'grid', gap: '10px' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              Try: {EXAMPLES.map((ex, i) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuery(ex)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    padding: 0,
                    marginRight: i === EXAMPLES.length - 1 ? 0 : 10,
                    fontSize: '8pt',
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="Ask a question…"
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '9pt',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--surface)',
              }}
            />
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                Row limit
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value || 20))}
                  style={{
                    marginLeft: 8,
                    width: 90,
                    padding: '6px 8px',
                    border: '1px solid var(--border)',
                    fontSize: '9pt',
                  }}
                />
              </label>
              <label style={{ fontSize: '8pt', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={includeMerged}
                  onChange={(e) => setIncludeMerged(e.target.checked)}
                />
                Include merged vehicles
              </label>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button
                  className="button button-secondary"
                  onClick={() => setTurns([])}
                  disabled={loading}
                  style={{ fontSize: '8pt', padding: '8px 12px' }}
                >
                  Clear chat
                </button>
                <button
                  className="button button-primary"
                  onClick={() => runQuery()}
                  disabled={loading || !query.trim()}
                  style={{ fontSize: '8pt', padding: '8px 12px' }}
                >
                  {loading ? 'Running...' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ border: '2px solid var(--border-light)' }}>
          <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
            Research View
          </div>
          <div className="card-body" style={{ display: 'grid', gap: '12px' }}>
            {!activeTurn && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                Ask a question to see SQL and results here.
              </div>
            )}
            {activeTurn && (
              <>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  <div><b>Question</b>: {activeTurn.question}</div>
                  <div><b>Status</b>: {activeTurn.status}</div>
                  {activeTurn.response && (
                    <>
                      <div><b>Rows</b>: {activeTurn.response.row_count ?? rows.length}</div>
                      <div><b>Provider</b>: {activeTurn.response.provider || 'unknown'} {activeTurn.response.model ? `(${activeTurn.response.model})` : ''}</div>
                      {activeTurn.response.explanation && <div><b>Explanation</b>: {activeTurn.response.explanation}</div>}
                      {typeof activeTurn.response.confidence === 'number' && (
                        <div><b>Confidence</b>: {activeTurn.response.confidence.toFixed(2)}</div>
                      )}
                    </>
                  )}
                  {activeTurn.status === 'error' && activeTurn.error && (
                    <div style={{ color: '#b91c1c' }}>{activeTurn.error}</div>
                  )}
                </div>

                {activeTurn.response?.sql && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ fontSize: '8pt', fontWeight: 600 }}>SQL</div>
                      <button
                        className="button button-secondary"
                        onClick={handleCopySql}
                        style={{ fontSize: '8pt', padding: '6px 10px' }}
                      >
                        {copiedId === activeTurn.id ? 'Copied' : 'Copy SQL'}
                      </button>
                    </div>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--grey-50)',
                      padding: '10px',
                      borderRadius: '4px',
                      fontSize: '8pt',
                      border: '1px solid var(--border)',
                    }}>
                      {activeTurn.response.sql}
                    </pre>
                  </div>
                )}

                {rows.length > 0 ? (
                  <div>
                    <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '6px' }}>Results</div>
                    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: '4px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                        <thead>
                          <tr style={{ background: 'var(--grey-50)' }}>
                            {columns.map((col) => (
                              <th key={col} style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--border)' }}>
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-light)' }}>
                              {columns.map((col) => (
                                <td key={col} style={{ padding: '8px' }}>
                                  {row[col] === null || row[col] === undefined ? '' : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  activeTurn.response && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>No rows returned.</div>
                  )
                )}

                {activeTurn.response && (
                  <div>
                    <button
                      className="button button-secondary"
                      onClick={() => setShowRaw((v) => !v)}
                      style={{ fontSize: '8pt', padding: '6px 10px' }}
                    >
                      {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
                    </button>
                    {showRaw && (
                      <pre style={{
                        marginTop: '8px',
                        whiteSpace: 'pre-wrap',
                        background: 'var(--grey-50)',
                        padding: '10px',
                        borderRadius: '4px',
                        fontSize: '8pt',
                        border: '1px solid var(--border)',
                      }}>
                        {JSON.stringify(activeTurn.response, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
