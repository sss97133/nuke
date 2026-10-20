/**
 * Messages — /messages, contact requests brokered by Nuke (my_contact_requests): incoming and outgoing, with the
 * replies the server offers on each (accept or decline, withdraw), and /messages/:requestId, one conversation
 * (contact_thread_read, post_contact_message). People appear by handle; no contact field is ever read or shown.
 * Both refetch through their reader when a live contact signal arrives (lib/contactLive) and say what changed in a
 * polite live region.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Masthead, Row, Rows, Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuth } from '../../hooks/useAuth';
import { useContactLive } from '../../hooks/useContactLive';
import { supabase } from '../../lib/supabase';
import { arr, day, num, obj, personLabel, str, type JsonObject } from '../jobs/jobRead';
import { readJob, type Load } from '../jobs/readJob';
import { contactContext, contactMessage, contactStatus, itemActions, leftTodayText, refusal, requestsLeft } from '../jobs/signDrafts';
import { SignSheet } from '../jobs/SignSheet';
import { useWriter } from '../jobs/useWriter';
import { inboxNews, threadNews } from './contactNews';
import '../jobs/job-page.css';
import '../jobs/jobs.css';

type Reply = 'accept' | 'decline' | 'withdraw';

const REPLY: Record<Reply, { title: string; rpc: string; says: (who: string) => string[]; not: string[]; done: string }> = {
  accept: { title: 'Accept request', rpc: 'respond_contact_request', says: who => [`You open a conversation with ${who} inside Nuke.`],
    not: ['Your email, phone or address: Nuke never shares them', 'Any agreement, booking or payment'], done: 'Accepted. You can write to each other here.' },
  decline: { title: 'Decline request', rpc: 'respond_contact_request', says: who => [`You decline ${who}'s request.`],
    not: ['Anything about them or their work'], done: 'Declined.' },
  withdraw: { title: 'Withdraw request', rpc: 'withdraw_contact_request', says: () => ['Your request is withdrawn. The record that you asked stays.'],
    not: ['Anything about them'], done: 'Withdrawn.' },
};

type News = { text: string; n: number } | null;

/** A reader kept current by live contact signals: a failed refresh keeps the last good read on screen. */
function useLiveRead(rpc: string, args: Record<string, unknown>, news: (prev: JsonObject | null, next: JsonObject) => string | null) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [said, setSaid] = useState<News>(null);
  const current = useRef<JsonObject | null>(null);
  const say = useRef(news);
  say.current = news;
  const key = JSON.stringify(args);
  const read = useCallback((live = false) => {
    readJob(rpc, JSON.parse(key)).then(r => {
      if (r.status === 'loaded') {
        const text = live ? say.current(current.current, r.data) : null;
        current.current = r.data;
        setLoad(r);
        if (text) setSaid(p => ({ text, n: (p?.n ?? 0) + 1 }));
      } else if (!live || !current.current) setLoad(r);
    });
  }, [rpc, key]);
  useEffect(() => { current.current = null; read(); }, [read]);
  return { load, said, read };
}

function Announce({ said }: { said: News }) {
  return <div role="status" className="jb-sr">{said && <span key={said.n}>{said.text}</span>}</div>;
}

function ReplySheet({ reply, item, onClose, onDone }: { reply: Reply; item: JsonObject; onClose: () => void; onDone: () => void }) {
  const r = REPLY[reply];
  const who = personLabel(item.counterpart);
  const w = useWriter();
  const id = str(item.request_id);
  const send = async () => {
    if (!id) { w.setFailure('This request changed. Reload and try again.'); return; }
    await w.run(r.rpc, reply === 'withdraw' ? { p_id: id } : { p_id: id, p_accept: reply === 'accept' });
  };
  return <SignSheet title={r.title} says={r.says(who)} doesNotSay={r.not} confirmLabel={r.title} onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">{r.done}</Text>}>
    {str(item.message) && <blockquote className="jb-quote"><Text role="body">{str(item.message)}</Text></blockquote>}
  </SignSheet>;
}

function RequestRow({ item, incoming, onChanged }: { item: JsonObject; incoming: boolean; onChanged: () => void }) {
  const [reply, setReply] = useState<Reply | null>(null);
  const actions = itemActions(item);
  const id = str(item.request_id);
  const ctx = obj(item.context);
  const thread = obj(item.thread);
  const count = num(thread?.messages) ?? 0;
  return <li className="jb-row" aria-label={`${incoming ? 'From' : 'To'} ${personLabel(item.counterpart)}`}>
    <div className="jb-row__head">
      <Text role="entity" dense>{`${incoming ? 'From' : 'To'} ${personLabel(item.counterpart)}`}</Text>
      <Text role="caption">{[contactStatus(str(item.status)), day(str(item.created_at))].filter(Boolean).join(' · ')}</Text>
    </div>
    <Text role="caption">{`About: ${contactContext(str(ctx?.kind), str(ctx?.label), incoming)}`}</Text>
    {str(item.message) && <Text role="body">{str(item.message)}</Text>}
    <div className="jb-actions">
      {actions.includes('respond_contact_request') && <>
        <button type="button" className="btn-base btn-sm btn-primary" onClick={() => setReply('accept')}><Text role="label">Accept</Text></button>
        <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setReply('decline')}><Text role="label">Decline</Text></button>
      </>}
      {actions.includes('withdraw_contact_request') && <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setReply('withdraw')}><Text role="label">Withdraw</Text></button>}
      {id && (actions.includes('post_contact_message') || count > 0) && <PrefetchLink to={`/messages/${encodeURIComponent(id)}`}>
        <Text role="label">{count > 0 ? `Open conversation (${count})` : 'Open conversation'}</Text></PrefetchLink>}
    </div>
    {reply && <ReplySheet reply={reply} item={item} onClose={() => setReply(null)} onDone={onChanged} />}
  </li>;
}

export default function MessagesPage() {
  usePageTitle('Messages');
  const { user } = useAuth();
  const { load: inbox, said, read } = useLiveRead('my_contact_requests', {}, inboxNews);
  const load = useCallback(() => read(), [read]);
  useContactLive(user?.id, () => read(true));
  const d = inbox.status === 'loaded' ? inbox.data : null;
  const incoming = arr(d?.incoming).map(obj).filter((o): o is JsonObject => !!o);
  const outgoing = arr(d?.outgoing).map(obj).filter((o): o is JsonObject => !!o);
  return <article className="jb-page jb-scope" aria-label="Messages">
    <Announce said={said} />
    <div className="jb-intro">
      <Text role="entity" as="h1">Messages</Text>
      <Text role="body">Contact requests through Nuke. Your email and phone are never shared. <PrefetchLink to="/work">Work</PrefetchLink></Text>
      {d && leftTodayText(requestsLeft(d)) && <Text role="caption">{leftTodayText(requestsLeft(d))}</Text>}
    </div>
    {inbox.status === 'loading' && <Text role="caption">Loading…</Text>}
    <div role="alert" className="jb-live">{inbox.status === 'failed' && <Text role="body" className="jb-warn">{inbox.reason}</Text>}</div>
    {d && <Section title="Incoming" coverage={{ n: incoming.length, of: incoming.length, grain: 'requests to you', as_of: str(d.as_of) }}>
      {incoming.length === 0 ? <Text role="body">No one has asked to contact you yet.</Text>
        : <ul className="jb-list">{incoming.map((i, k) => <RequestRow key={str(i.request_id) ?? k} item={i} incoming onChanged={load} />)}</ul>}
    </Section>}
    {d && <Section title="Sent" coverage={{ n: outgoing.length, of: outgoing.length, grain: 'requests you sent', as_of: str(d.as_of) }}>
      {outgoing.length === 0 ? <Text role="body">You haven't contacted anyone yet.</Text>
        : <ul className="jb-list">{outgoing.map((i, k) => <RequestRow key={str(i.request_id) ?? k} item={i} incoming={false} onChanged={load} />)}</ul>}
    </Section>}
  </article>;
}

export function ContactThreadPage() {
  const { requestId = '' } = useParams<{ requestId: string }>();
  usePageTitle('Conversation');
  const { user } = useAuth();
  const { load: thread, said, read } = useLiveRead('contact_thread_read', { p_request_id: requestId }, threadNews);
  const load = useCallback(() => read(), [read]);
  useContactLive(user?.id, signals => { if (signals.some(s => s.kind === 'resync' || s.requestId === requestId)) read(true); });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const send = async () => {
    const m = contactMessage(body, 2000);
    if (!m.ok) { setFailure(m.error); return; }
    setBusy(true); setFailure(null);
    const { error } = await supabase.rpc('post_contact_message', { p_request_id: requestId, p_body: m.args });
    setBusy(false);
    if (error) { setFailure(refusal(error)); return; }
    setBody('');
    load();
  };

  const d = thread.status === 'loaded' ? thread.data : null;
  const request = obj(d?.request);
  const messages = arr(d?.messages).map(obj).filter((o): o is JsonObject => !!o);
  const who = personLabel(request?.counterpart);
  return <article className="jb-page jb-scope" aria-label="Conversation">
    <Announce said={said} />
    <Masthead result={<Text role="caption">{request ? contactStatus(str(request.status)) : ''}</Text>}>
      <Text role="entity" as="h1">{d ? `Conversation with ${who}` : 'Conversation'}</Text>
    </Masthead>
    <Text role="body"><PrefetchLink to="/messages">All messages</PrefetchLink></Text>
    {thread.status === 'loading' && <Text role="caption">Loading…</Text>}
    <div role="alert" className="jb-live">{thread.status === 'failed' && <Text role="body" className="jb-warn">{thread.reason}</Text>}</div>
    {d && <Section title="Messages" coverage={{ n: messages.length, of: messages.length, grain: 'messages', as_of: str(d.as_of) }}>
      <Text role="caption">{request?.recipient_kind === 'organization' ? "Only you and the shop's team can read this." : 'Only the two of you can read this.'}</Text>
      <Rows title="Conversation">
        {str(request?.message) && <Row label={`${request?.direction === 'outgoing' ? 'You' : who} · request`}>{str(request?.message)}</Row>}
        {messages.map((m, i) => <Row key={str(m.message_id) ?? i} label={`${obj(m.author)?.kind === 'you' ? 'You' : personLabel(m.author)} · ${day(str(m.created_at)) ?? ''}`}>{str(m.body) ?? ''}</Row>)}
      </Rows>
      {d.can_post === true ? <div className="jb-field">
        <label className="jb-field"><Text role="label">Write a message</Text>
          <textarea className="jb-input k-body" aria-label="Message" maxLength={2000} value={body} onChange={e => setBody(e.target.value)} /></label>
        <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" disabled={busy || !body.trim()} onClick={send}>
          <Text role="label">{busy ? 'Sending…' : 'Send'}</Text></button></div>
        <div role="alert" className="jb-live">{failure && <Text role="body" className="jb-warn">{failure}</Text>}</div>
      </div> : <Text role="caption">Messages open once the request is accepted.</Text>}
    </Section>}
  </article>;
}
