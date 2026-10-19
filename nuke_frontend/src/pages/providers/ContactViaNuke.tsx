import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import { obj, str, type JsonObject } from '../jobs/jobRead';
import { leftTodayText, refusal, requestsLeft } from '../jobs/signDrafts';
import { readJob } from '../jobs/readJob';

type Phase = 'idle' | 'writing' | 'confirming' | 'sending' | 'sent';

/**
 * A contact request brokered by Nuke. No contact field is ever shown or sent; the request carries only the context and
 * recipient the reader named. Signed out, it asks for sign-in; when the server says requests are closed, it says why.
 */
export function ContactViaNuke({ contact, signedIn, recipient }: { contact: JsonObject | null; signedIn: boolean; recipient: string }) {
  const location = useLocation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const open = signedIn && contact?.available === true;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readJob('my_contact_requests', {}).then(l => { if (!cancelled && l.status === 'loaded') setLeft(requestsLeft(l.data)); });
    return () => { cancelled = true; };
  }, [open]);
  if (!contact) return null;
  const request = obj(contact.request);

  if (!signedIn) {
    const back = encodeURIComponent(location.pathname + location.search);
    return <div className="job-block">
      <Text role="body" as="p"><a className="job-link" href={`/login?returnUrl=${back}`}>Sign in</a> to contact {recipient} through Nuke.</Text>
      <Text role="caption" as="p">Nuke never shows email, phone or address. Requests go through the platform.</Text>
    </div>;
  }
  if (contact.available !== true || !request) {
    return <Text role="caption" as="p">Contact requests aren't open here: this profile can't receive them yet, or it's yours.</Text>;
  }

  const send = async () => {
    setPhase('sending');
    setFailure(null);
    const recipientUser = str(request.recipient_user_id);
    const { error } = await supabase.rpc('request_contact', {
      p_context_kind: str(request.context_kind),
      p_context_id: str(request.context_id),
      p_message: message.trim(),
      p_recipient_user_id: recipientUser,
      p_recipient_actor_id: recipientUser ? null : str(request.recipient_actor_id),
      p_recipient_organization_id: null,
    });
    if (error) { setFailure(refusal(error)); setPhase('confirming'); return; }
    setPhase('sent');
  };

  if (phase === 'sent') return <Text role="body" as="p">Request sent in Nuke. Their answer shows in <a className="job-link" href="/messages">Messages</a>. Your email and phone are never shared.</Text>;
  if (phase === 'idle') {
    return <div className="job-block">
      <button type="button" className="job-button" disabled={left === 0} onClick={() => setPhase('writing')}><Text role="label">Contact via Nuke</Text></button>
      {leftTodayText(left) && <Text role="caption" as="p">{leftTodayText(left)}</Text>}
    </div>;
  }
  return <div className="job-sign" role="group" aria-label="Contact via Nuke">
    <label className="job-block">
      <Text role="label">Your message to {recipient}</Text>
      <textarea className="job-textarea" maxLength={500} value={message} disabled={phase === 'sending'}
        onChange={e => { setMessage(e.target.value); if (phase === 'confirming') setPhase('writing'); }} />
    </label>
    {phase === 'writing' && <div className="job-sign__buttons">
      <button type="button" className="job-button" disabled={message.trim().length === 0} onClick={() => setPhase('confirming')}><Text role="label">Review</Text></button>
      <button type="button" className="job-button" onClick={() => setPhase('idle')}><Text role="label">Cancel</Text></button>
    </div>}
    {(phase === 'confirming' || phase === 'sending') && <div className="job-sign__terms">
      <Text role="label" as="h3">Sending says</Text>
      <ul className="job-list"><li><Text role="body">You'd like to talk with {recipient}, with this message, as a request through Nuke they can accept or decline.</Text></li></ul>
      <Text role="label" as="h3">It does not say</Text>
      <ul className="job-list">
        <li><Text role="body">Your email, phone or address: Nuke never shares contact fields</Text></li>
        <li><Text role="body">Any agreement, booking or payment</Text></li>
      </ul>
      {failure && <Text role="body" as="p" className="job-sign__failure">{failure}</Text>}
      <div className="job-sign__buttons">
        <button type="button" className="job-button job-button--primary" disabled={phase === 'sending'} onClick={send}>
          <Text role="label">{phase === 'sending' ? 'Sending…' : 'Send request'}</Text>
        </button>
        <button type="button" className="job-button" disabled={phase === 'sending'} onClick={() => setPhase('writing')}><Text role="label">Edit</Text></button>
      </div>
    </div>}
  </div>;
}
