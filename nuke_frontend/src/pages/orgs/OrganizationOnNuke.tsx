/**
 * The organization as Nuke's record shows it (facility_read, anon-readable): what people bought there on Nuke (kinds,
 * times, first and last dates — never amounts or who paid), the spaces its team declared, licences (type, authority,
 * expiry only), and who runs it on Nuke (public handles; private members only counted). Renders nothing when the
 * organization is not public or the record is empty.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Row, Rows, Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { readJob } from '../jobs/readJob';
import { arr, day, num, obj, sentence, str, type JsonObject } from '../jobs/jobRead';
import { ownerState } from './ownerState';
import { onNukeClaim } from './claimDrafts';
import { ClaimBusinessSheet, InviteSupplierSheet } from './BusinessClaim';
import '../jobs/job-page.css';

export default function OrganizationOnNuke({ organizationId }: { organizationId: string }) {
  const [read, setRead] = useState<JsonObject | null>(null);
  const [sheet, setSheet] = useState<'claim' | 'invite' | null>(null);
  const { user } = useAuth();
  const [params] = useSearchParams();
  const location = useLocation();
  const requirementId = params.get('requirement');
  const load = useCallback(() => {
    readJob('facility_read', { p_organization_id: organizationId }).then(l => setRead(l.status === 'loaded' ? l.data : null));
  }, [organizationId]);
  useEffect(() => { load(); }, [load]);
  if (!read) return null;
  const claim = onNukeClaim(read);
  const name = str(obj(read.organization)?.name) ?? 'This business';
  const back = encodeURIComponent(location.pathname + location.search);

  const supply = obj(read.work_recorded_on_nuke);
  const kinds = arr(supply?.kinds).map(obj).filter((k): k is JsonObject => !!k && !!str(k.supply_kind));
  const bySource = obj(supply?.by_source) ?? {};
  const assets = arr(read.assets_by_kind).map(obj).filter((g): g is JsonObject => !!g);
  const licenses = arr(read.licenses).map(obj).filter((l): l is JsonObject => !!l);
  const owner = ownerState(read);
  const records = num(supply?.records) ?? 0;
  const declared = num(obj(read.coverage)?.declared_assets) ?? assets.reduce((n, g) => n + arr(g.assets).length, 0);
  const asOf = read.as_of;

  return <div className="jb-scope">
    <Section title="On Nuke" coverage={{ n: kinds.length, of: kinds.length, grain: 'supply kinds on record', as_of: str(asOf) }} ariaLabel="This business on Nuke">
      <Rows title="Who runs it">
        {str(obj(read.on_nuke)?.label) && <Row label="On Nuke">{str(obj(read.on_nuke)?.label)}</Row>}
        <Row label="Owner">{owner.text}</Row>
        {owner.members.length > 0 && <Row label="Members">{owner.members.map((h, i) => <React.Fragment key={h}>{i > 0 && ', '}
          <PrefetchLink className="job-link" to={`/providers/${encodeURIComponent(h)}`}>@{h}</PrefetchLink></React.Fragment>)}</Row>}
      </Rows>
      {claim.claimable && <div className="job-block" role="group" aria-label="Claim this business">
        <Text role="body">Is this your business? Claim it to receive requests from people who need parts and work.</Text>
        {user ? <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={() => setSheet('claim')}><Text role="label">Claim this business</Text></button></div>
          : <Text role="caption"><a className="job-link" href={`/login?returnUrl=${back}`}>Sign in</a> to claim it.</Text>}
      </div>}
      {claim.claimable && requirementId && <div className="job-block" role="group" aria-label="Invite this business">
        <Text role="body">Not on Nuke yet — invite them to your job's need with a link you share.</Text>
        {user ? <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setSheet('invite')}><Text role="label">Invite them</Text></button></div>
          : <Text role="caption"><a className="job-link" href={`/login?returnUrl=${back}`}>Sign in</a> to invite them.</Text>}
      </div>}
      {records > 0 && <Rows title="Paid for here on Nuke" count={records}>
        <Row label="Records" role="measure">{`${records.toLocaleString('en-US')} · ${[day(str(supply?.first_on)), day(str(supply?.last_on))].filter(Boolean).join(' – ')}`}</Row>
        {kinds.map(k => <Row key={str(k.supply_kind)!} label={sentence(str(k.supply_kind)!)} role="measure">
          {`${(num(k.times) ?? 0).toLocaleString('en-US')} time${num(k.times) === 1 ? '' : 's'} · ${[day(str(k.first_on)), day(str(k.last_on))].filter(Boolean).join(' – ')}`}
        </Row>)}
        {Object.keys(bySource).length > 0 && <Row label="From">{Object.keys(bySource).sort().map(s => `${sentence(s).toLowerCase()} ${num(bySource[s]) ?? 0}`).join(' · ')}</Row>}
      </Rows>}
      {records > 0 && <Text role="caption" as="p">Purchase records kept on Nuke; times are records, not quantities. Amounts and who paid are not shown.</Text>}
      <Rows title="Declared spaces" count={declared}>
        {assets.flatMap(g => arr(g.assets).map(obj).filter((a): a is JsonObject => !!a).map(a => <Row key={str(a.asset_id) ?? str(a.label)} label={str(a.label) ?? 'Space'}>
          {`${sentence(str(g.kind) ?? 'space').toLowerCase()} · holds ${num(a.capacity) ?? 1}${arr(a.busy).length ? ` · ${arr(a.busy).length} booked window${arr(a.busy).length === 1 ? '' : 's'}` : ''}`}
        </Row>))}
      </Rows>
      {declared === 0 && <Text role="caption" as="p">No spaces declared by its team yet.</Text>}
      <Rows title="Licences" count={licenses.length}>
        {licenses.map((l, i) => <Row key={i} label={sentence(str(l.license_type) ?? 'licence')}>
          {[str(l.issuing_authority), sentence(str(l.state) ?? 'unknown').toLowerCase(), day(str(l.expiration_date)) ? `until ${day(str(l.expiration_date))}` : null, l.verified === true ? 'verified' : 'not verified'].filter(Boolean).join(' · ')}
        </Row>)}
      </Rows>
    </Section>
    {sheet === 'claim' && <ClaimBusinessSheet organizationId={organizationId} name={name} claim={claim.claim} onClose={() => setSheet(null)} onDone={load} />}
    {sheet === 'invite' && requirementId && <InviteSupplierSheet organizationId={organizationId} name={name} requirementId={requirementId} onClose={() => setSheet(null)} />}
  </div>;
}
