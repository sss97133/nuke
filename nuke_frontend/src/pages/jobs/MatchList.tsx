// The per-input match a reader returns (open_requirements_read for the viewer, work_order_provider_matches_read for a
// job owner looking at providers), and the backup suppliers on a request. Plain words; no score.
import React from 'react';
import { Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { day, matchInputLabel, matchMark, matchNext, matchReason, matchResultWord, planBLine, theirWords, type MatchInput, type PlanBSupplier } from './jobsReaders';

export function MatchList({ inputs, perspective = 'self', title }: { inputs: MatchInput[]; perspective?: 'self' | 'them'; title?: string }) {
  const heading = title ?? (perspective === 'self' ? 'How you match' : 'How they match');
  return <div>
    <Text role="label">{heading}</Text>
    <ul className="jb-match" aria-label={heading}>
      {inputs.map(m => {
        const said = matchNext(m.next);
        const next = said && perspective === 'them' ? theirWords(said) : said;
        return <li key={m.input} aria-label={`${matchInputLabel(m.input)}: ${matchResultWord(m.result)}`}>
          <Text role="measure" dense className={`jb-mark${m.result === 'pass' ? ' jb-mark--pass' : ''}`} aria-hidden>{matchMark(m.result)}</Text>
          <Text role="body">{matchInputLabel(m.input)} — {perspective === 'self' ? matchReason(m) : theirWords(matchReason(m))}{next && <> · <span className="jb-next">{next}</span></>}</Text>
        </li>;
      })}
    </ul>
  </div>;
}

/** Organizations paid for this kind of supply before, from retained purchase records. Open data: no amounts, no payers. */
export function PlanBList({ suppliers }: { suppliers: PlanBSupplier[] }) {
  return <div>
    <Text role="label">Backup suppliers</Text>
    <ul className="jb-match" aria-label="Backup suppliers">
      {suppliers.map((s, i) => {
        const id = s.organization?.organization_id;
        const name = s.organization?.name || 'Unnamed supplier';
        return <li key={id ?? i}>
          <Text role="body">{s.profile_public && id ? <PrefetchLink to={`/org/${encodeURIComponent(id)}`}>{name}</PrefetchLink> : name}
            {' — '}{planBLine(s)}{day(s.last_on) ? `, last ${day(s.last_on)}` : ''}</Text>
        </li>;
      })}
    </ul>
  </div>;
}
