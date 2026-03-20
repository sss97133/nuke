import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

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

type Filter = 'all' | 'unread' | 'read' | 'replied' | 'archived';

const MAILBOX_COLORS: Record<string, string> = {
  'privacy@nuke.ag': '#e74c3c',
  'legal@nuke.ag': '#9b59b6',
  'info@nuke.ag': '#3498db',
  'investors@nuke.ag': '#2ecc71',
  'support@nuke.ag': '#f39c12',
  'hello@nuke.ag': '#1abc9c',
};

export default function AdminInbox() {
  const [emails, setEmails] = useState<InboxEmail[]>([]);
  const [selected, setSelected] = useState<InboxEmail | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
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

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }
    if (mailboxFilter !== 'all') {
      query = query.eq('to_address', mailboxFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to fetch inbox:', error);
    } else {
      setEmails(data || []);
    }
    setLoading(false);
  }, [filter, mailboxFilter]);

  const fetchCounts = useCallback(async () => {
    const { data } = await supabase
      .from('v_inbox_summary')
      .select('*');
    if (data) {
      const c: Record<string, { total: number; unread: number }> = {};
      for (const row of data) {
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
      .channel('inbox-changes')
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
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('reply-email', {
        body: {
          inbox_id: selected.id,
          reply_text: replyText,
        },
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

  const totalUnread = Object.values(counts).reduce((sum, c) => sum + c.unread, 0);

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', fontFamily: "'Courier New', monospace" }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'var(--bg)',
      }}>
        <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text)' }}>
          Inbox {totalUnread > 0 && <span style={{ color: 'var(--error)', fontSize: '12px' }}>({totalUnread})</span>}
        </span>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {(['all', 'unread', 'read', 'replied', 'archived'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                background: filter === f ? 'var(--surface)' : 'transparent',
                color: filter === f ? 'var(--text)' : 'var(--text-secondary)',
                border: '1px solid var(--surface)', cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Mailbox filter */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button
            onClick={() => setMailboxFilter('all')}
            style={{
              padding: '3px 8px',
              fontSize: '11px',
              background: mailboxFilter === 'all' ? 'var(--surface)' : 'transparent',
              color: mailboxFilter === 'all' ? 'var(--text)' : 'var(--text-secondary)',
              border: '1px solid var(--surface)', cursor: 'pointer',
            }}
          >
            ALL
          </button>
          {Object.entries(counts).map(([addr, c]) => (
            <button
              key={addr}
              onClick={() => setMailboxFilter(addr)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                background: mailboxFilter === addr ? (MAILBOX_COLORS[addr] || 'var(--surface)') : 'transparent',
                color: mailboxFilter === addr ? 'var(--text)' : (MAILBOX_COLORS[addr] || 'var(--text-secondary)'),
                border: `1px solid ${MAILBOX_COLORS[addr] || 'var(--surface)'}`, cursor: 'pointer',
              }}
            >
              {addr.split('@')[0]} {c.unread > 0 && `(${c.unread})`}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Email list */}
        <div style={{
          width: selected ? '35%' : '100%',
          borderRight: selected ? '1px solid var(--border)' : 'none',
          overflowY: 'auto',
          transition: 'width 0.15s ease',
        }}>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: '12px' }}>loading...</div>
          ) : emails.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: '12px' }}>
              {filter === 'all' ? 'No emails yet' : `No ${filter} emails`}
            </div>
          ) : (
            emails.map(email => (
              <div
                key={email.id}
                onClick={() => openEmail(email)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected?.id === email.id ? 'var(--surface)' : 'transparent',
                  opacity: email.status === 'archived' ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {email.status === 'unread' && (
                      <div style={{ width: 6, height: 6, background: 'var(--accent)', flexShrink: 0 }} />
                    )}
                    <span style={{
                      fontSize: '12px',
                      color: email.status === 'unread' ? 'var(--text)' : 'var(--text-disabled)',
                      fontWeight: email.status === 'unread' ? 600 : 400,
                    }}>
                      {email.from_name || email.from_address}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: '9px',
                      padding: '1px 5px', background: MAILBOX_COLORS[email.to_address] || 'var(--surface)',
                      color: 'var(--text)',
                    }}>
                      {email.to_address.split('@')[0]}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{timeAgo(email.received_at)}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: '12px',
                  color: email.status === 'unread' ? 'var(--text)' : 'var(--text-disabled)',
                  marginTop: 3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {email.subject}
                </div>
                {!selected && email.body_text && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '80%',
                  }}>
                    {email.body_text.slice(0, 120)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Email detail */}
        {selected && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Detail header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '15px', color: 'var(--text)', fontWeight: 600 }}>{selected.subject}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-disabled)', marginTop: 4 }}>
                    From: <span style={{ color: 'var(--text)' }}>{selected.from_name ? `${selected.from_name} <${selected.from_address}>` : selected.from_address}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-disabled)' }}>
                    To: <span style={{ color: MAILBOX_COLORS[selected.to_address] || 'var(--text)' }}>{selected.to_address}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {new Date(selected.received_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {selected.status === 'replied' && (
                    <span style={{ fontSize: '11px', padding: '2px 6px', background: 'var(--success)', color: 'var(--bg)'}}>replied</span>
                  )}
                  <button
                    onClick={() => archiveEmail(selected.id)}
                    style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--surface)', color: 'var(--text-disabled)', border: 'none', cursor: 'pointer' }}
                  >
                    archive
                  </button>
                  <button
                    onClick={() => markSpam(selected.id)}
                    style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--surface)', color: 'var(--error)', border: 'none', cursor: 'pointer' }}
                  >
                    spam
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--surface)', color: 'var(--text-disabled)', border: 'none', cursor: 'pointer' }}
                  >
                    close
                  </button>
                </div>
              </div>
            </div>

            {/* Email body */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              {selected.body_html ? (
                <div
                  dangerouslySetInnerHTML={{ __html: selected.body_html }}
                  style={{
                    fontSize: '13px',
                    color: 'var(--text)',
                    lineHeight: 1.6,
                    maxWidth: 700,
                  }}
                />
              ) : selected.body_text ? (
                <pre style={{
                  fontSize: '12px',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                  maxWidth: 700,
                  fontFamily: "'Courier New', monospace",
                }}>
                  {selected.body_text}
                </pre>
              ) : (
                <div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>(no body content)</div>
              )}

              {selected.attachments && selected.attachments.length > 0 && (
                <div style={{ marginTop: 16, padding: '8px 12px', background: 'var(--surface)'}}>
                  <div style={{ fontSize: '11px', color: 'var(--text-disabled)', marginBottom: 4 }}>ATTACHMENTS ({selected.attachments.length})</div>
                  {selected.attachments.map((att: any, i: number) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--text)' }}>
                      {att.filename} ({att.content_type})
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reply box */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder={`Reply as ${selected.to_address}...`}
                style={{
                  width: '100%',
                  minHeight: 80,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)', padding: 10,
                  fontSize: '12px',
                  fontFamily: "'Courier New', monospace",
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                  Replying from {selected.to_address}
                </span>
                <button
                  onClick={sendReply}
                  disabled={sending || !replyText.trim()}
                  style={{
                    padding: '5px 16px',
                    fontSize: '12px',
                    background: replyText.trim() ? 'var(--accent)' : 'var(--surface)',
                    color: replyText.trim() ? 'var(--bg)' : 'var(--text-secondary)',
                    border: 'none', cursor: replyText.trim() ? 'pointer' : 'default',
                  }}
                >
                  {sending ? 'sending...' : 'send reply'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
