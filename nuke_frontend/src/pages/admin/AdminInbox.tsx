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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', fontFamily: 'monospace' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #222',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#0a0a0a',
      }}>
        <span style={{ fontSize: '11pt', fontWeight: 600, color: '#fff' }}>
          Inbox {totalUnread > 0 && <span style={{ color: '#e74c3c', fontSize: '9pt' }}>({totalUnread})</span>}
        </span>

        {/* Status filter */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 16 }}>
          {(['all', 'unread', 'read', 'replied', 'archived'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '3px 8px',
                fontSize: '8pt',
                background: filter === f ? '#333' : 'transparent',
                color: filter === f ? '#fff' : '#666',
                border: '1px solid #333',
                borderRadius: 3,
                cursor: 'pointer',
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
              fontSize: '8pt',
              background: mailboxFilter === 'all' ? '#333' : 'transparent',
              color: mailboxFilter === 'all' ? '#fff' : '#666',
              border: '1px solid #333',
              borderRadius: 3,
              cursor: 'pointer',
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
                fontSize: '8pt',
                background: mailboxFilter === addr ? (MAILBOX_COLORS[addr] || '#333') : 'transparent',
                color: mailboxFilter === addr ? '#fff' : (MAILBOX_COLORS[addr] || '#666'),
                border: `1px solid ${MAILBOX_COLORS[addr] || '#333'}`,
                borderRadius: 3,
                cursor: 'pointer',
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
          borderRight: selected ? '1px solid #222' : 'none',
          overflowY: 'auto',
          transition: 'width 0.15s ease',
        }}>
          {loading ? (
            <div style={{ padding: 20, color: '#666', fontSize: '9pt' }}>loading...</div>
          ) : emails.length === 0 ? (
            <div style={{ padding: 20, color: '#666', fontSize: '9pt' }}>
              {filter === 'all' ? 'No emails yet' : `No ${filter} emails`}
            </div>
          ) : (
            emails.map(email => (
              <div
                key={email.id}
                onClick={() => openEmail(email)}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #1a1a1a',
                  cursor: 'pointer',
                  background: selected?.id === email.id ? '#1a1a2a' : 'transparent',
                  opacity: email.status === 'archived' ? 0.5 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {email.status === 'unread' && (
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3498db', flexShrink: 0 }} />
                    )}
                    <span style={{
                      fontSize: '9pt',
                      color: email.status === 'unread' ? '#fff' : '#999',
                      fontWeight: email.status === 'unread' ? 600 : 400,
                    }}>
                      {email.from_name || email.from_address}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: '7pt',
                      padding: '1px 5px',
                      borderRadius: 2,
                      background: MAILBOX_COLORS[email.to_address] || '#333',
                      color: '#fff',
                    }}>
                      {email.to_address.split('@')[0]}
                    </span>
                    <span style={{ fontSize: '8pt', color: '#555' }}>{timeAgo(email.received_at)}</span>
                  </div>
                </div>
                <div style={{
                  fontSize: '9pt',
                  color: email.status === 'unread' ? '#ccc' : '#777',
                  marginTop: 3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {email.subject}
                </div>
                {!selected && email.body_text && (
                  <div style={{
                    fontSize: '8pt',
                    color: '#555',
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
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #222' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '11pt', color: '#fff', fontWeight: 600 }}>{selected.subject}</div>
                  <div style={{ fontSize: '9pt', color: '#888', marginTop: 4 }}>
                    From: <span style={{ color: '#ccc' }}>{selected.from_name ? `${selected.from_name} <${selected.from_address}>` : selected.from_address}</span>
                  </div>
                  <div style={{ fontSize: '9pt', color: '#888' }}>
                    To: <span style={{ color: MAILBOX_COLORS[selected.to_address] || '#ccc' }}>{selected.to_address}</span>
                  </div>
                  <div style={{ fontSize: '8pt', color: '#555', marginTop: 2 }}>
                    {new Date(selected.received_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {selected.status === 'replied' && (
                    <span style={{ fontSize: '8pt', padding: '2px 6px', background: '#2ecc71', color: '#000', borderRadius: 3 }}>replied</span>
                  )}
                  <button
                    onClick={() => archiveEmail(selected.id)}
                    style={{ fontSize: '8pt', padding: '3px 8px', background: '#333', color: '#999', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                  >
                    archive
                  </button>
                  <button
                    onClick={() => markSpam(selected.id)}
                    style={{ fontSize: '8pt', padding: '3px 8px', background: '#333', color: '#e74c3c', border: 'none', borderRadius: 3, cursor: 'pointer' }}
                  >
                    spam
                  </button>
                  <button
                    onClick={() => setSelected(null)}
                    style={{ fontSize: '8pt', padding: '3px 8px', background: '#333', color: '#999', border: 'none', borderRadius: 3, cursor: 'pointer' }}
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
                    fontSize: '10pt',
                    color: '#ddd',
                    lineHeight: 1.6,
                    maxWidth: 700,
                  }}
                />
              ) : selected.body_text ? (
                <pre style={{
                  fontSize: '9pt',
                  color: '#ddd',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.5,
                  maxWidth: 700,
                  fontFamily: 'monospace',
                }}>
                  {selected.body_text}
                </pre>
              ) : (
                <div style={{ color: '#555', fontSize: '9pt' }}>(no body content)</div>
              )}

              {selected.attachments && selected.attachments.length > 0 && (
                <div style={{ marginTop: 16, padding: '8px 12px', background: '#111', borderRadius: 4 }}>
                  <div style={{ fontSize: '8pt', color: '#888', marginBottom: 4 }}>ATTACHMENTS ({selected.attachments.length})</div>
                  {selected.attachments.map((att: any, i: number) => (
                    <div key={i} style={{ fontSize: '9pt', color: '#ccc' }}>
                      {att.filename} ({att.content_type})
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reply box */}
            <div style={{ borderTop: '1px solid #222', padding: '12px 16px' }}>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder={`Reply as ${selected.to_address}...`}
                style={{
                  width: '100%',
                  minHeight: 80,
                  background: '#111',
                  color: '#ddd',
                  border: '1px solid #333',
                  borderRadius: 4,
                  padding: 10,
                  fontSize: '9pt',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span style={{ fontSize: '8pt', color: '#555' }}>
                  Replying from {selected.to_address}
                </span>
                <button
                  onClick={sendReply}
                  disabled={sending || !replyText.trim()}
                  style={{
                    padding: '5px 16px',
                    fontSize: '9pt',
                    background: replyText.trim() ? '#3498db' : '#222',
                    color: replyText.trim() ? '#fff' : '#555',
                    border: 'none',
                    borderRadius: 3,
                    cursor: replyText.trim() ? 'pointer' : 'default',
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
