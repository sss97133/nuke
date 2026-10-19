/**
 * One backup supplier on a request (requirement_plan_b_suppliers via open_requirements_read): who was paid for this kind of
 * supply before on Nuke, and, for the job's customer or vehicle owner, the next step the server allows. A business not on
 * Nuke yet links to its page's invite flow (/org/:id?requirement=…; the customer shares the link, Nuke sends nothing). A
 * claimed business that can receive requests gets "Invite to offer" through Contact via Nuke.
 */
import React, { useState } from 'react';
import { Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { SignSheet } from './SignSheet';
import { day, planBLine, type PlanBSupplier } from './jobsReaders';
import { useWriter } from './useWriter';
import { obj, str } from './jobRead';

function InviteToOfferSheet({ organizationId, name, requirementId, onClose }: { organizationId: string; name: string; requirementId: string; onClose: () => void }) {
  const [message, setMessage] = useState('Would you make an offer on this need? The details are on the job page.');
  const w = useWriter();
  const send = async () => {
    const m = message.trim();
    if (m.length < 1 || m.length > 500) { w.setFailure('Write a message of 1 to 500 characters.'); return; }
    await w.run('request_contact', { p_context_kind: 'requirement', p_context_id: requirementId, p_message: m,
      p_recipient_user_id: null, p_recipient_actor_id: null, p_recipient_organization_id: organizationId });
  };
  const notSent = w.done && w.done.available === false;
  return <SignSheet title={`Invite ${name} to offer`} confirmLabel="Send invitation" onConfirm={send} onClose={onClose} busy={w.busy} failure={w.failure}
    says={[`Your message reaches ${name} inside Nuke, about this need.`, 'They choose whether to reply and whether to make an offer.']}
    doesNotSay={['That they are assigned or booked', 'Your contact details, or theirs', 'Any order or payment']}
    done={w.done && (notSent
      ? <Text role="body">{str(w.done.reason) === 'not_on_nuke_yet' ? `${name} isn't on Nuke anymore. Invite them from their page instead.` : 'Not sent.'}</Text>
      : <Text role="body" className="jb-done">Invitation sent in the app. An offer, if they make one, shows on the job.</Text>)}>
    {!w.done && <label className="jb-field"><Text role="label">Message</Text>
      <textarea className="jb-input k-body" aria-label="Message" value={message} maxLength={500} onChange={e => setMessage(e.target.value)} /></label>}
    {!w.done && <Text role="caption">Up to 10 requests a day.</Text>}
  </SignSheet>;
}

export function SupplierRow({ s, requirementId, inviter }: { s: PlanBSupplier; requirementId?: string | null; inviter?: boolean }) {
  const [inviting, setInviting] = useState(false);
  const id = s.organization?.organization_id ?? null;
  const name = s.organization?.name || 'Unnamed supplier';
  const onNuke = obj(s.on_nuke);
  const claimed = onNuke?.state === 'claimed';
  const linked = !!(s.profile_public && id);
  return <li>
    <Text role="body">{linked ? <PrefetchLink to={`/org/${encodeURIComponent(id!)}`}>{name}</PrefetchLink> : name}
      {' — '}{planBLine(s)}{day(s.last_on) ? `, last ${day(s.last_on)}` : ''}</Text>
    {claimed && <Text role="caption">{' · Claimed on Nuke'}</Text>}
    {!claimed && onNuke && !(inviter && requirementId && linked) && <Text role="caption">{' · Not on Nuke yet'}</Text>}
    {!claimed && onNuke && inviter && requirementId && linked && <>
      {' · '}<PrefetchLink className="job-link" to={`/org/${encodeURIComponent(id!)}?requirement=${encodeURIComponent(requirementId)}`}>
        <Text role="caption">Not on Nuke yet — invite them</Text></PrefetchLink>
    </>}
    {claimed && inviter && requirementId && id && s.can_receive_requests === true && <>
      {' · '}<button type="button" className="btn-base btn-xs btn-secondary" onClick={() => setInviting(true)}><Text role="label">Invite to offer</Text></button>
    </>}
    {inviting && id && requirementId && <InviteToOfferSheet organizationId={id} name={name} requirementId={requirementId} onClose={() => setInviting(false)} />}
  </li>;
}
