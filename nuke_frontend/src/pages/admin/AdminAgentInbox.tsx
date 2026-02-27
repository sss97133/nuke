import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

type AgentMessage = {
  id: string;
  thread_id: string | null;
  reply_to_id: string | null;
  from_role: string;
  to_role: string;
  from_email: string | null;
  to_email: string | null;
  subject: string;
  body: string;
  read_at: string | null;
  created_at: string;
  sent_via: string | null;
};

const ROLE_COLORS: Record<string, string> = {
  coo: '#3b82f6',
  cto: '#8b5cf6',
  cfo: '#10b981',
  cpo: '#f59e0b',
  cdo: '#ec4899',
  cwfto: '#6366f1',
  'vp-ai': '#14b8a6',
  'vp-extraction': '#f97316',
  'vp-platform': '#64748b',
  'vp-vehicle-intel': '#a16207',
  'vp-deal-flow': '#0ea5e9',
  'vp-orgs': '#84cc16',
  'vp-photos': '#d946ef',
  'vp-docs': '#fb7185',
  worker: '#94a3b8',
  founder: '#f59e0b',
  system: '#6b7280',
};

const ALL_ROLES = [
  'founder', 'coo', 'cto', 'cfo', 'cpo', 'cdo', 'cwfto',
  'vp-ai', 'vp-extraction', 'vp-platform', 'vp-vehicle-intel',
  'vp-deal-flow', 'vp-orgs', 'vp-photos', 'vp-docs', 'worker',
];

function roleColor(role: string) {
  return ROLE_COLORS[role] || '#6b7280';
}

function RolePill({ role }: { role: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      fontSize: '7pt',
      fontFamily: 'monospace',
      fontWeight: 600,
      color: '#fff',
      backgroundColor: roleColor(role),
      borderRadius: '3px',
    }}>
      {role}
    </span>
  );
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function AdminAgentInbox() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [selected, setSelected] = useState<AgentMessage | null>(null);
  const [thread, setThread] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [toFilter, setToFilter] = useState<string>('all');
  const [fromFilter, setFromFilter] = useState<string>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('agent_messages')
      .select('id, thread_id, reply_to_id, from_role, to_role, from_email, to_email, subject, body, read_at, created_at, sent_via')
      .order('created_at', { ascending: false })
      .limit(200);

    if (toFilter !== 'all') query = query.eq('to_role', toFilter);
    if (fromFilter !== 'all') query = query.eq('from_role', fromFilter);
    if (unreadOnly) query = query.is('read_at', null);

    const { data, error } = await query;
    if (!error && data) {
      setMessages(data);
    }
    setLoading(false);
  }, [toFilter, fromFilter, unreadOnly]);

  const fetchUnreadCount = useCallback(async () => {
    const { count } = await supabase
      .from('agent_messages')
      .select('*', { count: 'exact', head: true })
      .eq('to_role', 'founder')
      .is('read_at', null);
    setUnreadCount(count ?? 0);
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchUnreadCount();
  }, [fetchMessages, fetchUnreadCount]);

  const openMessage = async (msg: AgentMessage) => {
    setSelected(msg);
    // Load thread
    if (msg.thread_id) {
      const { data } = await supabase
        .from('agent_messages')
        .select('*')
        .eq('thread_id', msg.thread_id)
        .order('created_at', { ascending: true });
      setThread(data || [msg]);
    } else {
      setThread([msg]);
    }

    // Mark as read via edge function (for founder messages)
    if (msg.to_role === 'founder' && !msg.read_at) {
      await supabase.functions.invoke('agent-email', {
        body: { action: 'inbox', role: 'founder', mark_read: true, limit: 1 },
      }).catch(() => {
        // fallback: update directly
        supabase.from('agent_messages').update({ read_at: new Date().toISOString() }).eq('id', msg.id);
      });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read_at: new Date().toISOString() } : m));
      fetchUnreadCount();
    }
  };

  const uniqueFromRoles = Array.from(new Set(messages.map(m => m.from_role))).sort();
  const uniqueToRoles = Array.from(new Set(messages.map(m => m.to_role))).sort();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Header */}
      <div style={{
        padding: '10px 0',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>
          Agent Inbox
          {unreadCount > 0 && (
            <span style={{ marginLeft: 8, color: '#b91c1c', fontFamily: 'monospace' }}>
              {unreadCount} unread (founder)
            </span>
          )}
        </div>

        {/* To filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '8pt' }}>
          <span style={{ color: 'var(--text-muted)' }}>to:</span>
          <select
            value={toFilter}
            onChange={e => setToFilter(e.target.value)}
            style={{
              fontSize: '8pt',
              padding: '2px 6px',
              border: '1px solid var(--border-light)',
              borderRadius: '0px',
              backgroundColor: 'var(--white)',
            }}
          >
            <option value="all">all</option>
            {uniqueToRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* From filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '8pt' }}>
          <span style={{ color: 'var(--text-muted)' }}>from:</span>
          <select
            value={fromFilter}
            onChange={e => setFromFilter(e.target.value)}
            style={{
              fontSize: '8pt',
              padding: '2px 6px',
              border: '1px solid var(--border-light)',
              borderRadius: '0px',
              backgroundColor: 'var(--white)',
            }}
          >
            <option value="all">all</option>
            {uniqueFromRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '8pt', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={e => setUnreadOnly(e.target.checked)}
          />
          <span style={{ color: 'var(--text-muted)' }}>unread only</span>
        </label>

        <span style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {loading ? '…' : `${messages.length} messages`}
        </span>
      </div>

      {/* Split pane */}
      <div style={{ display: 'flex', flex: 1, gap: '12px', overflow: 'hidden', minHeight: 0 }}>
        {/* Message list */}
        <div style={{
          width: selected ? '40%' : '100%',
          overflowY: 'auto',
          border: '2px solid var(--border-light)',
          backgroundColor: 'var(--white)',
          transition: 'width 0.15s ease',
        }}>
          {loading ? (
            <div style={{ padding: '16px', fontSize: '8pt', color: 'var(--text-muted)' }}>Loading…</div>
          ) : messages.length === 0 ? (
            <div style={{ padding: '16px', fontSize: '8pt', color: 'var(--text-muted)' }}>No messages.</div>
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                onClick={() => void openMessage(msg)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer',
                  backgroundColor: selected?.id === msg.id
                    ? 'var(--grey-100)'
                    : msg.read_at == null ? 'var(--grey-50)' : 'var(--white)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {msg.read_at == null && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3b82f6', flexShrink: 0 }} />
                    )}
                    <RolePill role={msg.from_role} />
                    <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>→</span>
                    <RolePill role={msg.to_role} />
                  </div>
                  <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
                    {timeAgo(msg.created_at)}
                  </span>
                </div>
                <div style={{
                  marginTop: 4,
                  fontSize: '8pt',
                  fontWeight: msg.read_at == null ? 600 : 400,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {msg.subject}
                </div>
                {!selected && (
                  <div style={{
                    marginTop: 2,
                    fontSize: '8pt',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {msg.body.slice(0, 120)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Detail pane */}
        {selected && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            border: '2px solid var(--border-light)',
            backgroundColor: 'var(--white)',
            overflow: 'hidden',
          }}>
            {/* Detail header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>{selected.subject}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <RolePill role={selected.from_role} />
                    <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>→</span>
                    <RolePill role={selected.to_role} />
                    {selected.sent_via === 'resend' && (
                      <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        (real email)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                    {new Date(selected.created_at).toLocaleString()}
                    {selected.thread_id && (
                      <span> · thread: {selected.thread_id.slice(0, 8)}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setSelected(null); setThread([]); }}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    fontSize: '8pt',
                    color: 'var(--text-muted)',
                    padding: '4px 8px',
                    border: '1px solid var(--border-light)',
                  }}
                >
                  close
                </button>
              </div>
            </div>

            {/* Thread or body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {thread.length > 1 ? (
                <div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'monospace' }}>
                    {thread.length} messages in thread
                  </div>
                  {thread.map((m, idx) => (
                    <div
                      key={m.id}
                      style={{
                        marginBottom: 16,
                        paddingBottom: 16,
                        borderBottom: idx < thread.length - 1 ? '1px solid var(--border-light)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <RolePill role={m.from_role} />
                        <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>→</span>
                        <RolePill role={m.to_role} />
                        <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>
                          {timeAgo(m.created_at)}
                        </span>
                      </div>
                      <pre style={{
                        fontSize: '8pt',
                        color: 'var(--text)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                        margin: 0,
                        fontFamily: 'monospace',
                      }}>
                        {m.body}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <pre style={{
                  fontSize: '8pt',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                  margin: 0,
                  fontFamily: 'monospace',
                }}>
                  {selected.body}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
