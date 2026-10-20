// The per-input match a reader returns (open_requirements_read for the viewer, work_order_provider_matches_read for a
// job owner looking at providers), and the backup suppliers on a request. Plain words; no score.
import React from 'react';
import { Text } from '../../kit';
import { matchInputLabel, matchMark, matchNext, matchReason, matchResultWord, theirWords, type MatchInput, type PlanBSupplier } from './jobsReaders';
import { SupplierRow } from './SupplierRow';

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
export function PlanBList({ suppliers, requirementId, inviter }: { suppliers: PlanBSupplier[]; requirementId?: string; inviter?: boolean }) {
  return <div>
    <Text role="label">Backup suppliers</Text>
    <ul className="jb-match" aria-label="Backup suppliers">
      {suppliers.map((s, i) => <SupplierRow key={s.organization?.organization_id ?? i} s={s} requirementId={requirementId} inviter={inviter} />)}
    </ul>
  </div>;
}
