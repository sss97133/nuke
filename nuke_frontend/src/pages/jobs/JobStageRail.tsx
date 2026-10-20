import React from 'react';
import { Text } from '../../kit';
import { RUNG_WORD, STAGES, stageRung, stateLine, type StageKey } from './jobRead';

type Dot = { key: StageKey; state: string | null; conflicting: boolean };

const GLYPH: Record<string, string> = { attributed: '●', pending: '◐', recorded: '●', conflicting: '!', withheld: '▣', absent: '○', missing: '◌' };

function dotKind(d: Dot): string {
  if (d.state === null) return 'missing';
  if (d.state === 'withheld') return 'withheld';
  return stageRung(d.state, d.conflicting) ?? 'absent';
}

/** One cell per stage, request → payment, on the one trust ladder. A stage the reader did not send reads "Not reported". */
export function JobStageRail({ states, conflicts = {}, compact = false }: {
  states: Partial<Record<StageKey, string | null>>; conflicts?: Partial<Record<StageKey, boolean>>; compact?: boolean;
}) {
  const dots: Dot[] = STAGES.map(s => ({ key: s.key, state: states[s.key] ?? null, conflicting: conflicts[s.key] === true }));
  return <ol className={compact ? 'job-rail job-rail--compact' : 'job-rail'} aria-label="Job stages">
    {dots.map(d => {
      const kind = dotKind(d);
      const stage = STAGES.find(s => s.key === d.key)!;
      const spoken = `${stage.title}: ${stateLine(d.state)}${d.conflicting ? ', records disagree' : ''}`;
      return <li key={d.key} className={`job-rail__cell job-rail__cell--${kind}`} aria-label={spoken} title={spoken}>
        <Text role="measure" dense aria-hidden>{GLYPH[kind]}</Text>
        {!compact && <Text role="label">{stage.short}</Text>}
      </li>;
    })}
  </ol>;
}

/** The rail's legend, so a reader who learns one cell reads every cell. */
export function JobStageRailLegend() {
  const rows: Array<[string, string]> = [
    ['attributed', `${RUNG_WORD.attributed}: recorded, not yet verified`],
    ['pending', `${RUNG_WORD.pending}: in progress`],
    ['recorded', `${RUNG_WORD.recorded}: marked, but no record behind it`],
    ['absent', 'Not started'],
    ['conflicting', RUNG_WORD.conflicting],
    ['withheld', 'Shown to the people on this job'],
  ];
  return <ul className="job-legend" aria-label="Legend">
    {rows.map(([kind, words]) => <li key={kind} className={`job-rail__cell--${kind}`}>
      <Text role="measure" dense aria-hidden>{GLYPH[kind]}</Text> <Text role="caption">{words}</Text>
    </li>)}
  </ul>;
}
