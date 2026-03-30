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
  'alerts@nuke.ag':    'var(--orange)',
};

const ROLE_COLORS: Record<string, string> = {
  coo: 'var(--accent)',
  cto: '#8b5cf6',
  cfo: 'var(--success)',
  cpo: 'var(--warning)',
  cdo: '#ec4899',
  cwtfo: '#6366f1',
  'vp-ai': '#14b8a6',
  'vp-extraction': 'var(--orange)',
  'vp-platform': '#64748b',
  'vp-vehicle-intel': '#a16207',
  'vp-deal-flow': 'var(--info)',
  'vp-orgs': '#84cc16',
  'vp-photos': '#d946ef',
  'vp-docs': '#fb7185',
  worker: 'var(--text-disabled)',
  founder: 'var(--warning)',
  system: 'var(--text-secondary)',
};

const ALL_ROLES = [
  'founder', 'coo', 'cto', 'cfo', 'cpo', 'cdo', 'cwtfo',
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

function formatTimestamp(date: string) {
  const d = new Date(date);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
  return ROLE_COLORS[role] || 'var(--text-secondary)';
}

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

function getInitials(name: string | null, email: string): string {
  if (name) return name.charAt(0).toUpperCase();
  return email.split('@')[0].charAt(0).toUpperCase();
}

const CarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4, opacity: 0.6 }}>
    <path d="M5 17H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-4h12l2 4h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/>
    <circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>
  </svg>
);

// ─── Sub-components ───────────────────────────────────────────────────────────

function RolePill({ role }: { role: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      fontSize: '9px',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
      color: 'var(--bg)',
      backgroundColor: roleColor(role), letterSpacing: '0.02em',
    }}>
      {role}
    </span>
  );
}

function StatusBadge({ status }: { status: InboxEmail['status'] }) {
  const styles: Record<string, React.CSSProperties> = {
    unread:   { background: 'var(--accent)', color: 'var(--bg)' },
    read:     { background: 'var(--surface-hover)', color: 'var(--text-muted)' },
    replied:  { background: 'var(--success)', color: 'var(--bg)' },
    archived: { background: 'var(--border)', color: 'var(--text-muted)' },
    spam:     { background: 'var(--error)', color: 'var(--bg)' },
  };
  return (
    <span style={{
      padding: '1px 6px',
      fontSize: '9px', fontFamily: 'var(--font-mono)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
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
      padding: '0 5px', background: 'var(--error)',
      color: 'var(--bg)',
      fontSize: '10px',
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      lineHeight: 1,
      letterSpacing: 0,
    }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SenderAvatar({ name, email, size = 36 }: { name: string | null; email: string; size?: number }) {
  const initials = getInitials(name, email);
  return (
    <div style={{
      width: size,
      height: size, background: getAvatarColor(email),
      color: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size <= 36 ? '14px' : '16px',
      fontWeight: 600,
      fontFamily: 'var(--font-family)',
      flexShrink: 0,
      letterSpacing: '0.02em',
      userSelect: 'none',
    }}>
      {initials}
    </div>
  );
}

function MailboxDot({ address }: { address: string }) {
  const color = MAILBOX_COLORS[address] || 'var(--text-muted)';
  return (
    <span style={{
      display: 'inline-block',
      width: 7,
      height: 7, background: color,
      flexShrink: 0,
    }} />
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
  const [showMobileDetail, setShowMobileDetail] = useState(false);

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
    setShowMobileDetail(true);
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
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* ── Middle pane: email list (360px) ── */}
      <div
        className="inbox-middle-pane"
        style={{
          width: 360,
          minWidth: 360,
          maxWidth: 360,
          borderRight: '2px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--bg)',
        }}
      >
        {/* Filter bar */}
        {!alertsOnly && (
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap',
          }}>
            {(['all', 'unread', 'read', 'replied', 'archived'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                style={{
                  padding: '3px 8px',
                  fontSize: '11px',
                  background: statusFilter === f ? 'var(--accent)' : 'transparent',
                  color: statusFilter === f ? 'var(--bg)' : 'var(--text-muted)',
                  border: '1px solid var(--border)', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  transition: 'background 0.1s',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {/* Email list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              Loading...
            </div>
          ) : emails.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: '12px' }}>
              {alertsOnly ? 'No alert emails received' : 'No emails in this view'}
            </div>
          ) : (
            emails.map(email => {
              const isUnread = email.status === 'unread';
              const isSelected = selected?.id === email.id;
              const accentColor = MAILBOX_COLORS[email.to_address] || 'var(--border)';
              return (
                <div
                  key={email.id}
                  onClick={() => void openEmail(email)}
                  style={{
                    height: 64,
                    padding: '0 14px 0 0',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: isSelected
                      ? 'var(--surface-hover)'
                      : isUnread ? 'var(--surface)' : 'var(--bg)',
                    opacity: email.status === 'archived' ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'stretch',
                    borderLeft: isSelected
                      ? '3px solid var(--accent)'
                      : isUnread
                        ? `3px solid ${accentColor}`
                        : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Sender avatar */}
                  <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 12, flexShrink: 0 }}>
                    <SenderAvatar name={email.from_name} email={email.from_address} size={36} />
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 10 }}>
                    {/* Row 1: sender + time */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: '14px',
                        fontWeight: isUnread ? 700 : 400,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: '65%',
                      }}>
                        {email.from_name || email.from_address}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        flexShrink: 0,
                      }}>
                        {timeAgo(email.received_at)}
                      </span>
                    </div>

                    {/* Row 2: subject */}
                    <div style={{
                      fontSize: '13px',
                      color: isUnread ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: isUnread ? 600 : 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: 2,
                    }}>
                      {email.subject}
                    </div>

                    {/* Row 3: snippet */}
                    <div style={{
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: 1,
                    }}>
                      {(email.body_text || '').slice(0, 80)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right pane: email detail (flex-1) ── */}
      <div
        className="inbox-detail-pane"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg)',
          minWidth: 0,
        }}
      >
        {!selected ? (
          /* Empty state */
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: '32px', opacity: 0.3 }}>✉</div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Select a message</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>
              {emails.length > 0 ? `${emails.length} email${emails.length !== 1 ? 's' : ''} in this view` : 'No emails'}
            </div>
          </div>
        ) : (
          <>
            {/* Detail header */}
            <div style={{
              padding: '16px 20px 12px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
            }}>
              {/* Sender row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <SenderAvatar name={selected.from_name} email={selected.from_address} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                    {selected.from_name || selected.from_address}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: 2 }}>
                    {selected.from_name ? selected.from_address : ''}
                  </div>
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <StatusBadge status={selected.status} />
                  {!alertsOnly && (
                    <>
                      <button
                        onClick={() => archiveEmail(selected.id)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          background: 'transparent',
                          color: 'var(--text-muted)',
                          border: '1px solid var(--border)', cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        Archive
                      </button>
                      <button
                        onClick={() => markSpam(selected.id)}
                        style={{
                          padding: '4px 10px',
                          fontSize: '12px',
                          background: 'transparent',
                          color: 'var(--error)',
                          border: '1px solid var(--border)', cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        Spam
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setSelected(null)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '12px',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)', cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Meta strip */}
              <div style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                paddingLeft: 52,
              }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>To:</span>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 8px',
                  background: 'var(--surface-hover)', fontSize: '12px',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  <MailboxDot address={selected.to_address} />
                  {selected.to_address}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  {formatTimestamp(selected.received_at)}
                </span>
              </div>

              {/* Subject */}
              <div style={{
                marginTop: 8,
                paddingLeft: 52,
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text)',
                wordBreak: 'break-word',
              }}>
                {selected.subject}
              </div>
            </div>

            {/* Vehicle URLs for alerts */}
            {alertsOnly && (() => {
              const urls = extractVehicleUrls(selected.body_text);
              return urls.length > 0 ? (
                <div style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Vehicle URLs ({urls.length})
                  </div>
                  {urls.map((url, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: '11px',
                          color: 'var(--accent)',
                          wordBreak: 'break-all',
                          textDecoration: 'none',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <CarIcon />
                        {url}
                      </a>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            {/* Email body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
              {selected.body_html ? (
                <div
                  className="email-body"
                  dangerouslySetInnerHTML={{ __html: selected.body_html }}
                  style={{
                    fontSize: '15px',
                    color: 'var(--text)',
                    lineHeight: 1.6,
                    maxWidth: 700,
                  }}
                />
              ) : selected.body_text ? (
                <pre style={{
                  fontSize: '14px',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                  maxWidth: 700,
                  fontFamily: 'var(--font-family)',
                  margin: 0,
                }}>
                  {selected.body_text}
                </pre>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>(no body content)</div>
              )}

              {selected.attachments && selected.attachments.length > 0 && (
                <div style={{ marginTop: 20, padding: '10px 14px', background: 'var(--surface)', border: '2px solid var(--border)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 6, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Attachments ({selected.attachments.length})
                  </div>
                  {selected.attachments.map((att: any, i: number) => (
                    <div key={i} style={{ fontSize: '13px', color: 'var(--text)', padding: '2px 0' }}>
                      {att.filename} <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({att.content_type})</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Image attachment thumbnails */}
              {selected.attachments?.filter((a: any) => a.content_type?.startsWith('image/') && a.url).length > 0 && (
                <div style={{ padding: '12px 0', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 12 }}>
                  {selected.attachments.filter((a: any) => a.content_type?.startsWith('image/') && a.url).map((att: any, i: number) => (
                    <a key={i} href={att.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={att.url}
                        alt={att.filename || 'attachment'}
                        style={{ width: 80, height: 80, objectFit: 'cover', border: '1px solid var(--border)' }}
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Reply box (not for alerts) */}
            {!alertsOnly && (
              <div style={{
                borderTop: '1px solid var(--border)',
                padding: '14px 20px',
                background: 'var(--surface)',
              }}>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder={`Reply as ${selected.to_address}...`}
                  style={{
                    width: '100%',
                    minHeight: 80,
                    background: 'var(--bg)',
                    color: 'var(--text)',
                    border: '1px solid var(--border)', padding: '10px 12px',
                    fontSize: '14px',
                    fontFamily: 'var(--font-family)',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    outline: 'none',
                    lineHeight: 1.5,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Sending from {selected.to_address}
                  </span>
                  <button
                    onClick={sendReply}
                    disabled={sending || !replyText.trim()}
                    style={{
                      padding: '7px 20px',
                      fontSize: '13px',
                      fontWeight: 600,
                      background: replyText.trim() && !sending ? 'var(--accent)' : 'var(--surface-hover)',
                      color: replyText.trim() && !sending ? 'var(--bg)' : 'var(--text-muted)',
                      border: 'none', cursor: replyText.trim() && !sending ? 'pointer' : 'default',
                      transition: 'background 0.1s',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {sending ? 'Sending...' : 'Send Reply'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Compose Message Modal ─────────────────────────────────────────────────────

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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    background: 'var(--bg)',
    color: 'var(--text)',
    border: '1px solid var(--border)', fontFamily: 'var(--font-family)',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'block',
    marginBottom: 5,
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontWeight: 600,
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'var(--overlay)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--surface)',
        border: '2px solid var(--border)', padding: 24,
        width: '100%',
        maxWidth: 500, }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>New Message to Agent</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: '20px',
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>To Role</label>
          <select
            value={toRole}
            onChange={e => setToRole(e.target.value)}
            style={inputStyle}
          >
            <option value="">Select agent role...</option>
            {ALL_ROLES.filter(r => r !== 'founder').map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Message subject..."
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Message</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={5}
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '7px 16px',
              fontSize: '13px',
              background: 'var(--surface-hover)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending || !toRole || !subject.trim() || !body.trim()}
            style={{
              padding: '7px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: toRole && subject.trim() && body.trim() && !sending ? 'var(--accent)' : 'var(--surface-hover)',
              color: toRole && subject.trim() && body.trim() && !sending ? 'var(--bg)' : 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
              transition: 'background 0.1s',
            }}
          >
            {sending ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Messages Tab ─────────────────────────────────────────────────────────────

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

  const selectStyle: React.CSSProperties = {
    fontSize: '11px',
    padding: '3px 6px',
    border: '1px solid var(--border)', background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Middle pane */}
      <div style={{
        width: 360,
        minWidth: 360,
        maxWidth: 360,
        borderRight: '2px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'var(--bg)',
      }}>
        {/* Toolbar */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          background: 'var(--surface)',
        }}>
          <button
            onClick={() => setShowCompose(true)}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'var(--accent)',
              color: 'var(--bg)',
              border: 'none', cursor: 'pointer',
              letterSpacing: '0.01em',
            }}
          >
            + Compose
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>to:</span>
            <select value={toFilter} onChange={e => setToFilter(e.target.value)} style={selectStyle}>
              <option value="all">all</option>
              {uniqueToRoles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>from:</span>
            <select value={fromFilter} onChange={e => setFromFilter(e.target.value)} style={selectStyle}>
              <option value="all">all</option>
              {uniqueFromRoles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={e => setUnreadOnly(e.target.checked)}
            />
            <span style={{ color: 'var(--text-muted)' }}>unread</span>
          </label>

          {unreadCount > 0 && (
            <span style={{ fontSize: '11px', color: 'var(--error)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
              {unreadCount} new
            </span>
          )}
        </div>

        {/* Message list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Loading...</div>
          ) : messages.length === 0 ? (
            <div style={{ padding: 24, fontSize: '12px', color: 'var(--text-muted)' }}>No messages.</div>
          ) : (
            messages.map(msg => {
              const isUnread = msg.read_at == null;
              const isSelected = selected?.id === msg.id;
              return (
                <div
                  key={msg.id}
                  onClick={() => void openMessage(msg)}
                  style={{
                    height: 64,
                    padding: '0 14px 0 0',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: isSelected
                      ? 'var(--surface-hover)'
                      : isUnread ? 'var(--surface)' : 'var(--bg)',
                    display: 'flex',
                    alignItems: 'stretch',
                    borderLeft: isSelected
                      ? '3px solid var(--accent)'
                      : isUnread ? '3px solid var(--accent)' : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 12 }}>
                    {/* Row 1: roles + time */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                        {isUnread && (
                          <div style={{ width: 6, height: 6, background: 'var(--accent)', flexShrink: 0 }} />
                        )}
                        <RolePill role={msg.from_role} />
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>→</span>
                        <RolePill role={msg.to_role} />
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                        {timeAgo(msg.created_at)}
                      </span>
                    </div>
                    {/* Row 2: subject */}
                    <div style={{
                      marginTop: 3,
                      fontSize: '13px',
                      fontWeight: isUnread ? 600 : 400,
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {msg.subject}
                    </div>
                    {/* Row 3: snippet */}
                    <div style={{
                      marginTop: 1,
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {msg.body.slice(0, 80)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg)',
        minWidth: 0,
      }}>
        {!selected ? (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
            color: 'var(--text-muted)',
          }}>
            <div style={{ fontSize: '32px', opacity: 0.3 }}>💬</div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Select a message</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', wordBreak: 'break-word' }}>
                    {selected.subject}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <RolePill role={selected.from_role} />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>→</span>
                    <RolePill role={selected.to_role} />
                    {selected.sent_via === 'resend' && (
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>(real email)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    {formatTimestamp(selected.created_at)}
                    {selected.thread_id && (
                      <span style={{ marginLeft: 8, opacity: 0.6 }}>thread: {selected.thread_id.slice(0, 8)}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { setSelected(null); setThread([]); }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    border: '1px solid var(--border)', cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Thread body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {thread.length > 1 ? (
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: 14, fontFamily: 'var(--font-mono)' }}>
                    {thread.length} messages in thread
                  </div>
                  {thread.map((m, idx) => (
                    <div key={m.id} style={{
                      marginBottom: 18,
                      paddingBottom: 18,
                      borderBottom: idx < thread.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <RolePill role={m.from_role} />
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>→</span>
                        <RolePill role={m.to_role} />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                          {timeAgo(m.created_at)}
                        </span>
                      </div>
                      <pre style={{
                        fontSize: '13px',
                        color: 'var(--text)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.6,
                        margin: 0,
                        fontFamily: 'var(--font-family)',
                      }}>
                        {m.body}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : (
                <pre style={{
                  fontSize: '14px',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                  margin: 0,
                  fontFamily: 'var(--font-family)',
                }}>
                  {selected.body}
                </pre>
              )}
            </div>
          </>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)', fontSize: '13px' }}>
        Loading...
      </div>
    );
  }

  if (!user) return null;

  const tabs: { key: Tab; label: string; icon: string; count: number }[] = [
    { key: 'emails',   label: 'Emails',   icon: '✉',  count: emailUnread },
    { key: 'messages', label: 'Messages', icon: '💬', count: messageUnread },
    { key: 'alerts',   label: 'Alerts',   icon: '🔔', count: alertUnread },
  ];

  const totalUnread = emailUnread + messageUnread + alertUnread;

  return (
    <>
      {/* Scoped styles for responsive behavior + email body rendering */}
      <style>{`
        @media (max-width: 768px) {
          .inbox-middle-pane { width: 100% !important; max-width: 100% !important; min-width: 0 !important; border-right: none !important; }
          .inbox-detail-pane { display: none !important; }
          .inbox-left-sidebar { display: none !important; }
          .inbox-mobile-tabbar { display: flex !important; }
        }
        .inbox-mobile-tabbar { display: none; }
        .inbox-email-row:hover { background: var(--surface-hover) !important; }
        .email-body img { max-width: 100%; height: auto; border-radius: 0; margin: 8px 0; display: block; }
        .email-body a { color: var(--primary, var(--accent)); text-decoration: underline; }
        .email-body p { margin: 0 0 12px; }
        .email-body table { max-width: 100%; border-collapse: collapse; }
        .email-body td, .email-body th { padding: 6px 8px; border: 1px solid var(--border); }
        .email-body blockquote { border-left: 3px solid var(--border); margin: 0 0 12px 0; padding-left: 12px; color: var(--text-muted); }
      `}</style>

      <div style={{
        display: 'flex',
        height: 'calc(100vh - var(--header-height, 44px) - var(--vehicle-tabbar-height, 0px))',
        fontFamily: 'var(--font-family)',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}>
        {/* ── Left sidebar (220px) ── */}
        <div
          className="inbox-left-sidebar"
          style={{
            width: 220,
            minWidth: 220,
            maxWidth: 220,
            borderRight: '2px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          {/* Title row */}
          <div style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border)',
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              fontFamily: 'var(--font-mono)',
            }}>
              Inbox
            </div>
            {totalUnread > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 3 }}>
                {totalUnread} unread
              </div>
            )}
          </div>

          {/* Tab navigation */}
          <nav style={{ padding: '8px 0', flex: 1 }}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  height: 40,
                  padding: '0 16px',
                  background: activeTab === tab.key ? 'var(--surface-hover)' : 'transparent',
                  color: 'var(--text)',
                  border: 'none',
                  borderLeft: activeTab === tab.key ? '3px solid var(--accent)' : '3px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '13px',
                  fontFamily: 'var(--font-family)',
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontSize: '14px', lineHeight: 1 }}>{tab.icon}</span>
                <span style={{ flex: 1 }}>{tab.label}</span>
                {tab.count > 0 && <UnreadBadge count={tab.count} />}
              </button>
            ))}
          </nav>

          {/* Divider + mailbox filter pills */}
          {activeTab === 'emails' && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px 16px' }}>
              <div style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}>
                Mailboxes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {MAILBOXES.map(addr => (
                  <div
                    key={addr}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      fontSize: '12px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      padding: '2px 0',
                    }}
                  >
                    <MailboxDot address={addr} />
                    {addr.split('@')[0]}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Main content area ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
          {activeTab === 'emails'   && <EmailsTab alertsOnly={false} />}
          {activeTab === 'messages' && <MessagesTab />}
          {activeTab === 'alerts'   && <EmailsTab alertsOnly={true} />}
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <div
        className="inbox-mobile-tabbar"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 56,
          background: 'var(--surface)',
          borderTop: '2px solid var(--border)',
          zIndex: 100,
          alignItems: 'stretch',
          justifyContent: 'space-around',
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              background: 'none',
              border: 'none',
              borderTop: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: '10px',
              fontFamily: 'var(--font-family)',
              padding: '4px 0 8px',
              position: 'relative',
            }}
          >
            <span style={{ fontSize: '18px', lineHeight: 1 }}>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span style={{
                position: 'absolute',
                top: 6,
                right: '50%',
                transform: 'translateX(8px)',
                minWidth: 16,
                height: 16, background: 'var(--error)',
                color: 'var(--bg)',
                fontSize: '9px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
              }}>
                {tab.count > 9 ? '9+' : tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
