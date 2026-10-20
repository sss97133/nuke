/**
 * BestMatches — on a job page, for the customer or shop owner only: providers on Nuke ranked by how many of
 * the job's inputs they pass (work_order_provider_matches_read). Every input is shown in plain words, with
 * backup-supplier notes; nothing is weighted or hidden, and nobody is assigned. "Invite to offer" sends a
 * Contact via Nuke request about one requirement (request_contact, context requirement).
 */
import React, { useEffect, useState } from 'react';
import { Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { SignSheet } from './SignSheet';
import { MatchList } from './MatchList';
import { JobReaders, JobSigns, providerName, requirementKind, tallyWords, type MatchProvider, type MatchesRead } from './jobsReaders';
import './jobs.css';

const LISTED_BECAUSE: Record<string, string> = {
  evidenced_link: 'technician link backed by work',
  organization_member: 'shop member',
  organization_owner: 'shop owner',
};

function InviteSheet({ provider, onClose }: { provider: MatchProvider; onClose: () => void }) {
  const reqs = provider.requirements;
  const [requirementId, setRequirementId] = useState(reqs[0]?.requirement_id ?? '');
  const chosen = reqs.find(r => r.requirement_id === requirementId);
  const [message, setMessage] = useState(`Would you make an offer on this job? It needs: ${chosen?.description ?? 'see the job page'}`);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const name = providerName(provider.provider);
  const recipient = provider.provider?.profile_id;

  const send = async () => {
    setFailure(null);
    const m = message.trim();
    if (!recipient || !requirementId) { setFailure('This provider cannot be contacted through Nuke.'); return; }
    if (m.length < 1 || m.length > 500) { setFailure('Write a message of 1 to 500 characters.'); return; }
    setBusy(true);
    const r = await JobSigns.invite(requirementId, recipient, m);
    setBusy(false);
    if (r.refusal) setFailure(`Not sent. ${r.refusal.message}`); else setSent(true);
  };

  return <SignSheet title="Invite to offer" confirmLabel="Send invitation" onConfirm={send} onClose={onClose} busy={busy} failure={failure}
    says={[`Your message reaches ${name} inside Nuke, about this request.`, 'They choose whether to reply and whether to make an offer.']}
    doesNotSay={['That they are assigned or booked', 'Your contact details, or theirs', 'Any payment']}
    done={sent && <Text role="body" className="jb-done">Invitation sent in the app. Nobody was assigned; an offer, if they make one, shows on this job.</Text>}>
    <div className="jb-field"><Text role="label">To</Text><Text role="body">{name}</Text></div>
    {!sent && <>
      {reqs.length > 1 && <label className="jb-field"><Text role="label">About</Text>
        <select className="jb-input k-body" value={requirementId} onChange={e => setRequirementId(e.target.value)}>
          {reqs.map(r => <option key={r.requirement_id} value={r.requirement_id}>{`${requirementKind(r.requirement_kind)}: ${r.description ?? ''}`.slice(0, 120)}</option>)}
        </select></label>}
      <label className="jb-field"><Text role="label">Message</Text>
        <textarea className="jb-input k-body" value={message} maxLength={500} onChange={e => setMessage(e.target.value)} /></label>
      <Text role="caption">Up to 10 requests a day.</Text>
    </>}
  </SignSheet>;
}

function ProviderRow({ p, onInvite }: { p: MatchProvider; onInvite: () => void }) {
  const name = providerName(p.provider);
  const because = (p.listed_because ?? []).map(b => LISTED_BECAUSE[b] ?? b.replace(/_/g, ' ')).join(', ');
  return <li className="jb-row" aria-label={name}>
    <div className="jb-row__head">
      <Text role="entity" dense>{p.provider?.handle ? <PrefetchLink to={`/providers/${encodeURIComponent(p.provider.handle)}`}>{name}</PrefetchLink> : name}</Text>
      <Text role="measure" dense>{`#${p.rank}`}</Text>
    </div>
    <Text role="caption">{tallyWords(p)}{because ? ` · listed as ${because}` : ''}</Text>
    {p.requirements.map(r => <MatchList key={r.requirement_id} inputs={r.inputs} perspective="them"
      title={`${requirementKind(r.requirement_kind)}${r.description ? `: ${r.description}` : ''} · ${r.passed} pass`} />)}
    {p.contact && p.provider?.profile_id && <div className="jb-actions">
      <button type="button" className="btn-base btn-sm btn-secondary" onClick={onInvite}><Text role="label">Invite to offer</Text></button>
    </div>}
  </li>;
}

export default function BestMatches({ workOrderId }: { workOrderId: string }) {
  const [read, setRead] = useState<MatchesRead | null>(null);
  const [inviting, setInviting] = useState<MatchProvider | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRead(null);
    void JobReaders.matches(workOrderId).then(r => { if (!cancelled && r.data) setRead(r.data); });
    return () => { cancelled = true; };
  }, [workOrderId]);
  if (!read || !Array.isArray(read.providers) || !read.coverage || read.coverage.requirements === 0) return null;
  return <div className="jb-scope">
    <Section title="Best matches" coverage={{ n: read.coverage.providers_returned, of: read.coverage.providers_considered, grain: 'providers considered', as_of: read.as_of }} ariaLabel="Best matches">
      <Text role="body">Ranked only by how many checks each provider passes; ties share a rank. Every check is shown, and nobody is assigned until you accept an offer.</Text>
      {read.providers.length === 0
        ? <Text role="body">No providers on Nuke are listed for this job yet.</Text>
        : <ul className="jb-list">{read.providers.map((p, i) => <ProviderRow key={p.provider?.profile_id ?? p.provider?.handle ?? i} p={p} onInvite={() => setInviting(p)} />)}</ul>}
      <Text role="caption">Considered: accounts with a technician link backed by work, or an active shop membership or ownership. Service area and availability are what providers say; tools are claimed ownership.</Text>
    </Section>
    {inviting && <InviteSheet provider={inviting} onClose={() => setInviting(null)} />}
  </div>;
}
