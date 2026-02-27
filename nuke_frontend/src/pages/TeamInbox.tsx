import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

// ─── Types ────────────────────────────────────────────────────────────────────

type InboxEmail = {
  id: string;
  email_id: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  attachments: any[];
  status: 'unread' | 'read' | 'replied' | 'archived' | 'spam';
  received_at: string;
  replied_at: string | null;
  replied_by: string | null;
};

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

type Tab = 'emails' | 'messages' | 'alerts';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAILBOXES = [
  'support@nuke.ag',
  'info@nuke.ag',
  'privacy@nuke.ag',
  'legal@nuke.ag',
  'investors@nuke.ag',
  'hello@nuke.ag',
];

const MAILBOX_COLORS: Record<string, string> = {
  'privacy@nuke.ag':   'var(--error)',
  'legal@nuke.ag':     '#9b59b6',
  'info@nuke.ag':      'var(--primary)',
  'investors@nuke.ag': 'var(--success)',
  'support@nuke.ag':   '#f39c12',
  'hello@nuke.ag':     '#1abc9c',
  'alerts@nuke.ag':    '#f97316',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function isAlertEmail(email: InboxEmail) {
  return (
    email.to_address === 'alerts@nuke.ag' ||
    (email.subject || '').toLowerCase().includes('vehicle alert') ||
    (email.subject || '').toLowerCase().includes('listing alert')
  );
}

function extractVehicleUrls(text: string | null): string[] {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  const matches = text.match(urlRegex) || [];
  return matches.filter(url =>
    url.includes('bringatrailer') ||
    url.includes('carsandbids') ||
    url.includes('pcarmarket') ||
    url.includes('mecum') ||
    url.includes('rmsothebys') ||
    url.includes('bonhams') ||
    url.includes('facebook.com/marketplace') ||
    url.includes('craigslist')
  );
}

function roleColor(role: string) {
  return ROLE_COLORS[role] || '#6b7280';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function StatusBadge({ status }: { status: InboxEmail['status'] }) {
  const styles: Record<string, React.CSSProperties> = {
    unread:   { background: 'var(--primary)', color: '#fff' },
    read:     { background: 'var(--surface-hover)', color: 'var(--text-muted)' },
    replied:  { background: 'var(--success)', color: '#fff' },
    archived: { background: 'var(--border)', color: 'var(--text-muted)' },
    spam:     { background: 'var(--error)', color: '#fff' },
  };
  return (
    <span style={{
      padding: '1px 5px',
      fontSize: '7pt',
      borderRadius: 2,
      fontFamily: 'monospace',
      ...styles[status],
    }}>
      {status}
    </span>
  );
}

function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 18,
      height: 18,
      padding: '0 4px',
      borderRadius: 999,
      background: 'var(--error)',
      color: '#fff',
      fontSize: '8pt',
      fontWeight: 700,
      fontFamily: 'monospace',
      lineHeight: 1,
    }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ─── Emails Tab ───────────────────────────────────────────────────────────────

function EmailsTab({ alertsOnly = false }: { alertsOnly?: boolean }) {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [selected, setSelected] = useState<InboxEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read' | 'replied' | 'archived'>('all');
  const [mailboxFilter, setMailboxFilter] = useState<string>('all');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [counts, setCounts] = useState<Record<string, { total: number; unread: number }>>({});

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('contact_inbox')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(100);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (mailboxFilter !== 'all') query = query.eq('to_address', mailboxFilter);

    const { data, error } = await query;
    if (!error && data) {
      const filtered = alertsOnly
        ? (data as InboxEmail[]).filter(isAlertEmail)
        : (data as InboxEmail[]).filter(e => !isAlertEmail(e));
      setEmails(filtered);
    }
    setLoading(false);
  }, [statusFilter, mailboxFilter, alertsOnly]);

  const fetchCounts = useCallback(async () => {
    const { data } = await supabase
      .from('v_inbox_summary')
      .select('*')
      .catch(() => ({ data: null }));
    if (data) {
      const c: Record<string, { total: number; unread: number }> = {};
      for (const row of (data as any[])) {
        c[row.to_address] = { total: row.total, unread: row.unread };
      }
      setCounts(c);
    }
  }, []);

  useEffect(() => {
    fetchEmails();
    fetchCounts();
  }, [fetchEmails, fetchCounts]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('team-inbox-emails')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'contact_inbox',
      }, () => {
        fetchEmails();
        fetchCounts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchEmails, fetchCounts]);

  const openEmail = async (email: InboxEmail) => {
    setSelected(email);
    setReplyText('');
    if (email.status === 'unread') {
      await supabase
        .from('contact_inbox')
        .update({ status: 'read', read_at: new Date().toISOString() })
        .eq('id', email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'read' } : e));
      fetchCounts();
    }
  };

  const archiveEmail = async (id: string) => {
    await supabase.from('contact_inbox').update({ status: 'archived' }).eq('id', id);
    setEmails(prev => prev.map(e => e.id === id ? { ...e, status: 'archived' as const } : e));
    if (selected?.id === id) setSelected(null);
    fetchCounts();
  };

  const markSpam = async (id: string) => {
    await supabase.from('contact_inbox').update({ status: 'spam' }).eq('id', id);
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selected?.id === id) setSelected(null);
    fetchCounts();
  };

  const sendReply = async () => {
    if (!selected || !replyText.trim()) return;
    setSending(true);
    try {
      const res = await supabase.functions.invoke('reply-email', {
        body: { inbox_id: selected.id, reply_text: replyText },
      });
      if (res.error) throw res.error;
      setSelected(prev => prev ? { ...prev, status: 'replied' } : null);
      setEmails(prev => prev.map(e => e.id === selected.id ? { ...e, status: 'replied' as const } : e));
      setReplyText('');
      fetchCounts();
    } catch (err) {
      console.error('Reply failed:', err);
      alert('Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const mailboxesWithEmails = Object.keys(counts).filter(addr =>
    alertsOnly ? addr.includes('alerts') : !addr.includes('alerts')
  );

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
      {/* Toolbar */}
      {!alertsOnly && (
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          background: 'var(--surface)',
        }}>
          {/* Status filters */}
          <div style={{ display: 'flex', gap: 3 }}>
            {(['all', 'unread', 'read', 'replied', 'archived'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                style={{
                  padding: '2px 7px',
                  fontSize: '8pt',
                  background: statusFilter === f ? 'var(--primary)' : 'transparent',
                  color: statusFilter === f ? '#fff' : 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  textTransform: 'uppercase',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Mailbox filter */}
          <div style={{ display: 'flex', gap: 3, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button
              onClick={() => setMailboxFilter('all')}
              style={{
                padding: '2px 7px',
                fontSize: '8pt',
                background: mailboxFilter === 'all' ? 'var(--grey-800)' : 'transparent',
                color: mailboxFilter === 'all' ? '#fff' : 'var(--text-muted)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              all
            </button>
            {mailboxesWithEmails.map(addr => {
              const c = counts[addr];
              return (
                <button
                  key={addr}
                  onClick={() => setMailboxFilter(addr)}
                  style={{
                    padding: '2px 7px',
                    fontSize: '8pt',
                    background: mailboxFilter === addr ? (MAILBOX_COLORS[addr] || 'var(--grey-800)') : 'transparent',
                    color: mailboxFilter === addr ? '#fff' : (MAILBOX_COLORS[addr] || 'var(--text-muted)'),
                    border: `1px solid ${MAILBOX_COLORS[addr] || 'var(--border)'}`,
                    borderRadius: 2,
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {addr.split('@')[0]}{c?.unread > 0 ? ` (${c.unread})` : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Split pane */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Email list */}
        <div style={{
          width: selected ? '40%' : '100%',
          borderRight: selected ? '1px solid var(--border)' : 'none',
          overflowY: 'auto',
          transition: 'width 0.15s ease',
          background: 'var(--bg)',
        }}>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '9pt' }}>loading...</div>
          ) : emails.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '9pt' }}>
              {alertsOnly ? 'No alert emails received' : 'No emails in this view'}
            </div>
          ) : (
            emails.map(email => (
              <div
                key={email.id}
                onClick={() => void openEmail(email)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected?.id === email.id
                    ? 'var(--surface-hover)'
                    : email.status === 'unread' ? 'var(--surface)' : 'var(--bg)',
                  opacity: email.status === 'archived' ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    {email.status === 'unread' && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
                    )}
                    <span style={{
                      fontSize: '9pt',
                      color: email.status === 'unread' ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: email.status === 'unread' ? 600 : 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {email.from_name || email.from_address}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{
                      fontSize: '7pt',
                      padding: '1px 5px',
                      borderRadius: 2,
                      background: MAILBOX_COLORS[email.to_address] || 'var(--grey-800)',
                      color: '#fff',
                      fontFamily: 'monospace',
                    }}>
                      {email.to_address.split('@')[0]}
                    </span>
                    <span style={{ fontSize: '8pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {timeAgo(email.received_at)}
                    </span>
                  </div>
                </div>

                <div style={{
                  fontSize: '9pt',
                  color: email.status === 'unread' ? 'var(--text)' : 'var(--text-muted)',
                  marginTop: 3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: email.status === 'unread' ? 500 : 400,
                }}>
                  {email.subject}
                </div>

                {!selected && (
                  <div style={{
                    fontSize: '8pt',
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {(email.body_text || '').slice(0, 100)}
                  </div>
                )}

                {alertsOnly && (() => {
                  const urls = extractVehicleUrls(email.body_text);
                  return urls.length > 0 ? (
                    <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {urls.length} vehicle URL{urls.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ) : null;
                })()}
              </div>
            ))
          )}
        </div>

        {/* Email detail */}
        {selected && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--bg)',
          }}>
            {/* Detail header */}
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '10pt', color: 'var(--text)', fontWeight: 600, wordBreak: 'break-word' }}>
                    {selected.subject}
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 4 }}>
                    From: <span style={{ color: 'var(--text)' }}>
                      {selected.from_name ? `${selected.from_name} <${selected.from_address}>` : selected.from_address}
                    </span>
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                    To: <span style={{ color: MAILBOX_COLORS[selected.to_address] || 'var(--text)' }}>
                      {selected.to_address}
                    </span>
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                    {new Date(selected.received_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <StatusBadge status={selected.status} />
                  {!alertsOnly && (
                    <>
                      <button
                        onClick={() => archiveEmail(selected.id)}
                        style={{
                          fontSize: '8pt', padding: '2px 7px',
                          background: 'var(--surface-hover)', color: 'var(--text-muted)',
                          border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
                        }}
                      >
                        archive
                      </button>
                      <button
                        onClick={() => markSpam(selected.id)}
                        style={{
                          fontSize: '8pt', padding: '2px 7px',
                          background: 'var(--surface-hover)', color: 'var(--error)',
                          border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
                        }}
                      >
                        spam
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSelected(null)}
                    style={{
                      fontSize: '8pt', padding: '2px 7px',
                      background: 'var(--surface-hover)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
                    }}
                  >
                    close
                  </button>
                </div>
              </div>
            </div>

            {/* Vehicle URLs for alerts */}
            {alertsOnly && (() => {
              const urls = extractVehicleUrls(selected.body_text);
              return urls.length > 0 ? (
                <div style={{
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'monospace', textTransform: 'uppercase' }}>
                    Vehicle URLs ({urls.length})
                  </div>
                  {urls.map((url, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '8pt',
                          color: 'var(--primary)',
                          wordBreak: 'break-all',
                          textDecoration: 'none',
                          fontFamily: 'monospace',
                        }}
                      >
                        {url}
                      </a>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            {/* Email body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '14px' }}>
              {selected.body_html ? (
                <div
                  dangerouslySetInnerHTML={{ __html: selected.body_html }}
                  style={{ fontSize: '10pt', color: 'var(--text)', lineHeight: 1.6, maxWidth: 700 }}
                />
              ) : selected.body_text ? (
                <pre style={{
                  fontSize: '9pt',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                  maxWidth: 700,
                  fontFamily: 'monospace',
                  margin: 0,
                }}>
                  {selected.body_text}
                </pre>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '9pt' }}>(no body content)</div>
              )}

              {selected.attachments && selected.attachments.length > 0 && (
                <div style={{ marginTop: 16, padding: '8px 12px', background: 'var(--surface)', borderRadius: 4, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>
                    Attachments ({selected.attachments.length})
                  </div>
                  {selected.attachments.map((att: any, i: number) => (
                    <div key={i} style={{ fontSize: '9pt', color: 'var(--text)' }}>
                      {att.filename} ({att.content_type})
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reply box (not for alerts) */}
            {!alertsOnly && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px', background: 'var(--surface)' }}>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder={`Reply as ${selected.to_address}...`}
                  style={{
                    width: '100%',
                    minHeight: 72,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    padding: 8,
                    fontSize: '9pt',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <span style={{ fontSize: '8pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    Sending from {selected.to_address}
                  </span>
                  <button
                    onClick={sendReply}
                    disabled={sending || !replyText.trim()}
                    style={{
                      padding: '4px 14px',
                      fontSize: '9pt',
                      background: replyText.trim() && !sending ? 'var(--primary)' : 'var(--surface-hover)',
                      color: replyText.trim() && !sending ? '#fff' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: 3,
                      cursor: replyText.trim() && !sending ? 'pointer' : 'default',
                      fontFamily: 'monospace',
                    }}
                  >
                    {sending ? 'sending...' : 'Send Reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Messages Tab ─────────────────────────────────────────────────────────────

function ComposeMessageModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [toRole, setToRole] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!toRole || !subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      const res = await supabase.functions.invoke('agent-email', {
        body: {
          action: 'send',
          to_role: toRole,
          subject: subject.trim(),
          body: body.trim(),
          from_role: 'founder',
        },
      });
      if (res.error) throw res.error;
      onSent();
      onClose();
    } catch (err) {
      console.error('Compose failed:', err);
      // Fallback: insert directly
      await supabase.from('agent_messages').insert({
        from_role: 'founder',
        to_role: toRole,
        subject: subject.trim(),
        body: body.trim(),
        created_at: new Date().toISOString(),
      });
      onSent();
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '2px solid var(--border)',
        padding: 20,
        width: '100%',
        maxWidth: 480,
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: '10pt', fontWeight: 600, color: 'var(--text)' }}>New Message to Agent</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}>×</button>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>To Role</label>
          <select
            value={toRole}
            onChange={e => setToRole(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '9pt',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              fontFamily: 'monospace',
            }}
          >
            <option value="">Select agent role...</option>
            {ALL_ROLES.filter(r => r !== 'founder').map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Message subject..."
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '9pt',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              fontFamily: 'monospace',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: '8pt', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontFamily: 'monospace', textTransform: 'uppercase' }}>Message</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={5}
            style={{
              width: '100%',
              padding: '6px 8px',
              fontSize: '9pt',
              background: 'var(--bg)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              fontFamily: 'monospace',
              resize: 'vertical',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '5px 14px', fontSize: '9pt',
            background: 'var(--surface-hover)', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer',
          }}>
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || !toRole || !subject.trim() || !body.trim()}
            style={{
              padding: '5px 14px', fontSize: '9pt',
              background: toRole && subject.trim() && body.trim() && !sending ? 'var(--primary)' : 'var(--surface-hover)',
              color: toRole && subject.trim() && body.trim() && !sending ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 2, cursor: 'pointer',
              fontFamily: 'monospace',
            }}
          >
            {sending ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessagesTab() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [selected, setSelected] = useState<AgentMessage | null>(null);
  const [thread, setThread] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [toFilter, setToFilter] = useState<string>('all');
  const [fromFilter, setFromFilter] = useState<string>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
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
    if (!error && data) setMessages(data as AgentMessage[]);
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
    if (msg.thread_id) {
      const { data } = await supabase
        .from('agent_messages')
        .select('*')
        .eq('thread_id', msg.thread_id)
        .order('created_at', { ascending: true });
      setThread((data as AgentMessage[]) || [msg]);
    } else {
      setThread([msg]);
    }

    if (msg.to_role === 'founder' && !msg.read_at) {
      await supabase.functions.invoke('agent-email', {
        body: { action: 'inbox', role: 'founder', mark_read: true, limit: 1 },
      }).catch(() => {
        supabase.from('agent_messages').update({ read_at: new Date().toISOString() }).eq('id', msg.id);
      });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read_at: new Date().toISOString() } : m));
      fetchUnreadCount();
    }
  };

  const uniqueFromRoles = Array.from(new Set(messages.map(m => m.from_role))).sort();
  const uniqueToRoles = Array.from(new Set(messages.map(m => m.to_role))).sort();

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        background: 'var(--surface)',
      }}>
        <button
          onClick={() => setShowCompose(true)}
          style={{
            padding: '4px 12px',
            fontSize: '8pt',
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 2,
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontWeight: 600,
          }}
        >
          + New Message
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '8pt' }}>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>to:</span>
          <select
            value={toFilter}
            onChange={e => setToFilter(e.target.value)}
            style={{
              fontSize: '8pt', padding: '2px 6px',
              border: '1px solid var(--border)', borderRadius: 2,
              background: 'var(--bg)', color: 'var(--text)',
              fontFamily: 'monospace',
            }}
          >
            <option value="all">all</option>
            {uniqueToRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '8pt' }}>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>from:</span>
          <select
            value={fromFilter}
            onChange={e => setFromFilter(e.target.value)}
            style={{
              fontSize: '8pt', padding: '2px 6px',
              border: '1px solid var(--border)', borderRadius: 2,
              background: 'var(--bg)', color: 'var(--text)',
              fontFamily: 'monospace',
            }}
          >
            <option value="all">all</option>
            {uniqueFromRoles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '8pt', cursor: 'pointer', fontFamily: 'monospace' }}>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={e => setUnreadOnly(e.target.checked)}
          />
          <span style={{ color: 'var(--text-muted)' }}>unread only</span>
        </label>

        {unreadCount > 0 && (
          <span style={{ fontSize: '8pt', color: 'var(--error)', fontFamily: 'monospace', marginLeft: 4 }}>
            {unreadCount} unread (founder)
          </span>
        )}

        <span style={{ fontSize: '8pt', color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'monospace' }}>
          {loading ? '...' : `${messages.length} messages`}
        </span>
      </div>

      {/* Split pane */}
      <div style={{ display: 'flex', flex: 1, gap: 0, overflow: 'hidden' }}>
        {/* Message list */}
        <div style={{
          width: selected ? '40%' : '100%',
          overflowY: 'auto',
          borderRight: selected ? '1px solid var(--border)' : 'none',
          background: 'var(--bg)',
          transition: 'width 0.15s ease',
        }}>
          {loading ? (
            <div style={{ padding: 20, fontSize: '9pt', color: 'var(--text-muted)' }}>Loading...</div>
          ) : messages.length === 0 ? (
            <div style={{ padding: 20, fontSize: '9pt', color: 'var(--text-muted)' }}>No messages.</div>
          ) : (
            messages.map(msg => (
              <div
                key={msg.id}
                onClick={() => void openMessage(msg)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected?.id === msg.id
                    ? 'var(--surface-hover)'
                    : msg.read_at == null ? 'var(--surface)' : 'var(--bg)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {msg.read_at == null && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
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
            overflow: 'hidden',
            background: 'var(--bg)',
          }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: '9pt', fontWeight: 600, color: 'var(--text)' }}>{selected.subject}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <RolePill role={selected.from_role} />
                    <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>→</span>
                    <RolePill role={selected.to_role} />
                    {selected.sent_via === 'resend' && (
                      <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>(real email)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                    {new Date(selected.created_at).toLocaleString()}
                    {selected.thread_id && <span> · thread: {selected.thread_id.slice(0, 8)}</span>}
                  </div>
                </div>
                <button
                  onClick={() => { setSelected(null); setThread([]); }}
                  style={{
                    all: 'unset', cursor: 'pointer', fontSize: '8pt',
                    color: 'var(--text-muted)', padding: '3px 8px',
                    border: '1px solid var(--border)', borderRadius: 2,
                  }}
                >
                  close
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
              {thread.length > 1 ? (
                <div>
                  <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginBottom: 12, fontFamily: 'monospace' }}>
                    {thread.length} messages in thread
                  </div>
                  {thread.map((m, idx) => (
                    <div key={m.id} style={{
                      marginBottom: 16, paddingBottom: 16,
                      borderBottom: idx < thread.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <RolePill role={m.from_role} />
                        <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>→</span>
                        <RolePill role={m.to_role} />
                        <span style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>
                          {timeAgo(m.created_at)}
                        </span>
                      </div>
                      <pre style={{
                        fontSize: '8pt', color: 'var(--text)',
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        lineHeight: 1.5, margin: 0, fontFamily: 'monospace',
                      }}>
                        {m.body}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <pre style={{
                  fontSize: '8pt', color: 'var(--text)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  lineHeight: 1.6, margin: 0, fontFamily: 'monospace',
                }}>
                  {selected.body}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {showCompose && (
        <ComposeMessageModal
          onClose={() => setShowCompose(false)}
          onSent={fetchMessages}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TeamInbox() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('emails');
  const [emailUnread, setEmailUnread] = useState(0);
  const [messageUnread, setMessageUnread] = useState(0);
  const [alertUnread, setAlertUnread] = useState(0);

  // Redirect to login if unauthenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/login?returnUrl=%2Finbox', { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Fetch unread counts for sidebar badges
  const fetchUnreadCounts = useCallback(async () => {
    const [emailsRes, messagesRes, alertsRes] = await Promise.all([
      supabase
        .from('contact_inbox')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'unread')
        .not('to_address', 'eq', 'alerts@nuke.ag')
        .not('subject', 'ilike', '%vehicle alert%'),
      supabase
        .from('agent_messages')
        .select('*', { count: 'exact', head: true })
        .eq('to_role', 'founder')
        .is('read_at', null),
      supabase
        .from('contact_inbox')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'unread')
        .or('to_address.eq.alerts@nuke.ag,subject.ilike.%vehicle alert%'),
    ]);
    setEmailUnread(emailsRes.count ?? 0);
    setMessageUnread(messagesRes.count ?? 0);
    setAlertUnread(alertsRes.count ?? 0);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30000);
    return () => clearInterval(interval);
  }, [user, fetchUnreadCounts]);

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading...
      </div>
    );
  }

  if (!user) return null;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'emails',   label: 'Emails',   count: emailUnread },
    { key: 'messages', label: 'Messages', count: messageUnread },
    { key: 'alerts',   label: 'Alerts',   count: alertUnread },
  ];

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - var(--header-height, 44px) - var(--vehicle-tabbar-height, 0px))',
      fontFamily: 'monospace',
      overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      {/* Left sidebar — tab navigation */}
      <div style={{
        width: 160,
        minWidth: 160,
        borderRight: '2px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        flexShrink: 0,
      }}>
        <div style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--border)',
          fontSize: '9pt',
          fontWeight: 700,
          color: 'var(--text)',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
          Team Inbox
        </div>

        <nav style={{ flex: 1, padding: '6px 0' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
                color: activeTab === tab.key ? '#fff' : 'var(--text)',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '9pt',
                fontFamily: 'monospace',
                fontWeight: activeTab === tab.key ? 600 : 400,
                borderLeft: activeTab === tab.key ? '3px solid var(--primary)' : '3px solid transparent',
              }}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && <UnreadBadge count={tab.count} />}
            </button>
          ))}
        </nav>

        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: '7pt', color: 'var(--text-muted)' }}>
          nuke.ag mailboxes
        </div>
      </div>

      {/* Right pane — content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {activeTab === 'emails' && <EmailsTab alertsOnly={false} />}
        {activeTab === 'messages' && <MessagesTab />}
        {activeTab === 'alerts' && <EmailsTab alertsOnly={true} />}
      </div>
    </div>
  );
}
