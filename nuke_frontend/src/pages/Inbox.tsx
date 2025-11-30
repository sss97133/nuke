import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface ThreadRow { id: string; subject?: string | null; created_at: string }
interface Participant { id: string; user_id: string }
interface MessageRow { id: string; sender_id: string; body: string; created_at: string }

const Inbox: React.FC = () => {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [body, setBody] = useState('');
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const loadThreads = async () => {
    try {
      setLoadingThreads(true);
      const { data, error } = await supabase
        .from('message_threads')
        .select('id, subject, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setThreads((data as any[]) || []);
    } catch {
      setThreads([]);
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadMessages = async (threadId: string) => {
    try {
      setLoadingMsgs(true);
      const { data, error } = await supabase
        .from('messages')
        .select('id, sender_id, body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      setMessages((data as any[]) || []);
      // Load participants for context
      const { data: parts } = await supabase
        .from('thread_participants')
        .select('id, user_id')
        .eq('thread_id', threadId)
        .limit(50);
      setParticipants((parts as any[]) || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => { loadThreads(); }, []);
  useEffect(() => { if (activeId) loadMessages(activeId); }, [activeId]);

  const send = async () => {
    if (!activeId || !body.trim()) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('messages').insert({ thread_id: activeId, sender_id: user.id, body } as any);
      if (error) throw error;
      setBody('');
      await loadMessages(activeId);
    } catch (e: any) {
      alert(`Send failed: ${e?.message || e}`);
    }
  };

  return (
    <div className="container compact">
        <div className="main" style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap:12 }}>
          <div className="card" style={{ maxHeight:'70vh', overflowY:'auto' }}>
            <div className="card-header">Threads</div>
            <div className="card-body">
              {loadingThreads ? <div className="text text-small text-muted">Loading…</div> : (
                <div className="space-y-1">
                  {threads.length === 0 ? (
                    <div className="text text-small text-muted">No threads</div>
                  ) : threads.map(t => (
                    <button key={t.id} className="button button-small" style={{ width:'100%', justifyContent:'space-between' }} onClick={()=>setActiveId(t.id)}>
                      <span>{t.subject || 'Conversation'}</span>
                      <span className="text text-small text-muted">{new Date(t.created_at).toLocaleDateString()}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ display:'flex', flexDirection:'column', maxHeight:'70vh' }}>
            <div className="card-header">Messages</div>
            <div className="card-body" style={{ flex:1, overflowY:'auto' }}>
              {activeId ? (
                loadingMsgs ? <div className="text text-small text-muted">Loading…</div> : (
                  messages.length === 0 ? <div className="text text-small text-muted">No messages</div> : (
                    <div className="space-y-1">
                      {participants.length > 0 && (
                        <div className="text text-small text-muted">Participants: {participants.map(p => p.user_id).join(', ')}</div>
                      )}
                      {messages.map(m => (
                        <div key={m.id} className="text text-small"><span className="text-muted">{new Date(m.created_at).toLocaleTimeString()}:</span> {m.body}</div>
                      ))}
                    </div>
                  )
                )
              ) : (
                <div className="text text-small text-muted">Select a thread</div>
              )}
            </div>
            <div className="card-body" style={{ borderTop:'1px solid #e5e7eb' }}>
              <div style={{ display:'flex', gap:6 }}>
                <input className="form-input" placeholder="Type a message" value={body} onChange={e=>setBody(e.target.value)} />
                <button className="button button-small" onClick={send} disabled={!activeId || !body.trim()}>Send</button>
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};

export default Inbox;


