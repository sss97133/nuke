/** Read model over existing testimony, not a second task ledger.
 * Design choices, purchases, physical appearance and completed work remain different assertions. */
export type WorkProof = {
  id: string; vehicle_id: string; kind: string; source_id: string | null;
  is_superseded: boolean; observed_at: string | null; ingested_at: string | null;
  component: string | null; component_name: string | null; description: string | null;
  level: string | null; photo_url: string | null; photo_at: string | null;
  event_date: string | null; replaces: string | null;
  method?: string | null; owner_words?: string | null;
};
export type WorkDecision = {
  id: string; subject: string; status: string | null; work_status: string | null;
  chosen: string | null; source: string | null; decided_on: string | null; trust: string | null;
};
export type WorkHandoff = {
  id: string; source_id: string; observed_at: string | null; ingested_at: string | null;
  gate: string; next_action: string | null; blocked_on: string[];
};
export type WorkContext = {
  vehicleId: string; proofs: WorkProof[]; decisions: WorkDecision[]; handoffs: WorkHandoff[];
  errors: string[]; partial: boolean;
  proofsComplete?: boolean;
};
export type WorkComponent = { code: string; name: string; reports: WorkProof[]; disagreement: boolean; wiringGap: boolean };

// Free-text sources remain in the ledger. The work overview omits embedded contact and money values.
// This is presentation minimization, not an access-control mechanism; reads still use the caller's RLS.
export function workExcerpt(value: string | null): string {
  return (value ?? '').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[contact omitted]')
    .replace(/(?:\+?\d{1,3}[ -]?)?\(\d{3}\)[ -]?\d{3}[ -]?\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/g, '[contact omitted]')
    .replace(/(?:[$€£]\s*[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s*(?:USD|EUR|GBP)\b)/g, '[amount omitted]');
}

export function retainedWorkPlan(context: WorkContext) {
  const sources = (context.proofsComplete === false ? [] : context.proofs).filter(p => p.vehicle_id === context.vehicleId && p.kind === 'specification'
    && p.is_superseded === false && p.component);
  // A correction retracts only its exact original, never every observation about that part.
  const replaced = new Set(sources.filter(p => p.replaces && sources.some(original =>
    original.id === p.replaces && original.component === p.component)).map(p => p.replaces));
  const groups = new Map<string, WorkComponent>();
  for (const report of sources) {
    if (replaced.has(report.id)) continue;
    const code = report.component!;
    const group = groups.get(code) ?? { code, name: report.component_name || code, reports: [], disagreement: false, wiringGap: false };
    if (report.component_name) group.name = report.component_name;
    if (!group.reports.some(r => r.id === report.id)) group.reports.push(report);
    groups.set(code, group);
  }
  const components = [...groups.values()].map(group => {
    group.reports.sort((a, b) => (b.observed_at ?? '').localeCompare(a.observed_at ?? '') || a.id.localeCompare(b.id));
    const levels = new Set(group.reports.map(p => p.level));
    group.disagreement = levels.has('installed') && (levels.has('not_installed') || levels.has('not_on_truck'));
    // A narrowly stated source gap, not a conclusion from a photo or the word "mounted" alone.
    group.wiringGap = group.reports.some(p => p.level === 'mounted' && /(?:^|[.!?]\s+)Not wired\.\s*$/i.test(p.description ?? ''));
    return group;
  }).sort((a, b) => a.name.localeCompare(b.name));
  const remaining = components.filter(g => g.reports.some(p => ['not_installed', 'not_on_truck'].includes(p.level ?? '')) || g.disagreement || g.wiringGap);
  const available = components.filter(g => !remaining.includes(g)
    && g.reports.some(p => ['bought', 'on_hand', 'in_hand', 'mounted', 'installed', 'on_truck'].includes(p.level ?? '')));
  const options = components.filter(g => !remaining.includes(g) && !available.includes(g)
    && g.reports.some(p => p.level === 'lined_up'));
  const corrections = components.filter(g => !remaining.includes(g) && !available.includes(g) && !options.includes(g));
  return {
    remaining, available, options, corrections,
    // Candidate add-ons are not accepted scope or delivery blockers. A locked choice is not physical completion.
    open: context.decisions.filter(d => d.status !== 'candidate' && d.status !== 'decided'
      && !['done', 'decided'].includes(d.work_status ?? '')),
    choices: context.decisions.filter(d => d.status === 'decided' || d.work_status === 'decided').map(d => ({ ...d,
      authority: d.trust === 'T1' ? 'owner_reported' as const : d.trust === 'T3' ? 'agent_working' as const : 'unqualified' as const })),
    candidates: context.decisions.filter(d => d.status === 'candidate'),
  };
}
