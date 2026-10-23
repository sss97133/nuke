import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { classificationLabel, classifyRecords, type ClassificationConflict } from '../../services/financialRecordClassification';
import { useAccountingBook } from './AccountingBookContext';
import type { SavedRecord } from './FinancialWorkpapers';

type BookRecord = SavedRecord['record'];
export type ClassifyTarget = { documentId: string; record: BookRecord };
type Category = { section: string; category: string; records: number };
type Conflict = ClassificationConflict & ClassifyTarget;

const loaded = new Map<string, Promise<Category[]>>();
/** The classifications this book already uses, most used first. Read once per book; refreshed after a save. */
export function accountingCategories(ownerId: string, refresh = false): Promise<Category[]> {
  if (refresh || !loaded.has(ownerId)) {
    const request = Promise.resolve(supabase.from('v_financial_accounting_categories').select('section, category, records').eq('owner_id', ownerId).order('records', { ascending: false }).limit(1000))
      .then(({ data, error }) => { if (error || !Array.isArray(data)) throw new Error('Categories unavailable'); return data as Category[]; });
    loaded.set(ownerId, request);
    request.catch(() => { if (loaded.get(ownerId) === request) loaded.delete(ownerId); });
  }
  return loaded.get(ownerId)!;
}
export const forgetAccountingCategories = () => loaded.clear();
const same = (a?: string | null, b?: string | null) => (a || '') === (b || '');

/** Classify one record (evidence view) or a selection (records list). Each source gets one attributed revision through
 *  the existing writer; a record another reviewer changed meanwhile is reported, never overwritten. */
export default function RecordClassifier({ targets, onChanged }: { targets: ClassifyTarget[]; onChanged: (records: ClassifyTarget[]) => void }) {
  const { ownerId, canCorrect } = useAccountingBook();
  const single = targets.length === 1 ? targets[0].record : null;
  const selection = targets.map(t => t.record.source_key).join(',');
  const [section, setSection] = useState(single?.section || '');
  const [category, setCategory] = useState(single?.category || '');
  const [note, setNote] = useState('');
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSection(single?.section || ''); setCategory(single?.category || ''); setNote(''); setMessage(''); setConflicts([]); }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    accountingCategories(ownerId).then(rows => { if (!cancelled) setCategories(rows); }).catch(() => { if (!cancelled) setCategories([]); });
    return () => { cancelled = true; };
  }, [ownerId]);

  const totals = new Map<string, number>();
  for (const row of categories || []) totals.set(row.section, (totals.get(row.section) || 0) + row.records);
  for (const { record } of targets) if (record.section && !totals.has(record.section)) totals.set(record.section, 0);
  const sections = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const suggestions = (categories || []).filter(row => row.section === section && row.category);
  const dirty = !!section.trim() && (!!note.trim() || targets.some(({ record }) => !same(record.section, section.trim()) || !same(record.category, category.trim())));
  const listId = `accounting-categories-${(single?.source_key || 'selection').slice(0, 16)}`;
  const movementsOnly = targets.every(({ record }) => record.record_kind === 'retained_bank_movement');

  const save = async (bases?: Map<string, { section: string | null; category: string | null }>) => {
    if (!ownerId || !canCorrect || busy || !section.trim()) return;
    setBusy(true); setConflicts([]); setMessage(targets.length > 1 ? `Saving 0 of ${targets.length}…` : 'Saving…');
    const next = { section, category, note };
    const groups = new Map<string, ClassifyTarget[]>();
    for (const target of targets) groups.set(target.documentId, [...(groups.get(target.documentId) || []), target]);
    const saved: ClassifyTarget[] = [], conflicted: Conflict[] = [], failures: string[] = [];
    let unchanged = 0, done = 0;
    for (const [documentId, group] of groups) {
      try {
        const outcome = await classifyRecords(ownerId, documentId, group.map(({ record }) => {
          const base = bases?.get(record.source_key!) ?? record;
          return { source_key: record.source_key!, section: base.section ?? null, category: base.category ?? null };
        }), next);
        for (const written of outcome.records) {
          const target = group.find(t => t.record.source_key === written.source_key);
          if (target) saved.push({ documentId, record: { ...target.record, section: written.section, category: written.category, status: written.status, decision: written.decision } });
        }
        unchanged += outcome.unchanged.length;
        for (const conflict of outcome.conflicts) {
          const target = group.find(t => t.record.source_key === conflict.source_key);
          if (target) conflicted.push({ ...target, ...conflict });
        }
      } catch (error) { failures.push(error instanceof Error ? error.message : 'Save could not be confirmed.'); }
      done += group.length;
      if (mounted.current && targets.length > 1) setMessage(`Saving ${done} of ${targets.length}…`);
    }
    if (saved.length) {
      accountingCategories(ownerId, true).then(rows => { if (mounted.current) setCategories(rows); }).catch(() => {});
      window.dispatchEvent(new Event('accounting-saved'));
      onChanged(saved);
    }
    if (!mounted.current) return;
    const chosen = classificationLabel(section.trim(), category.trim());
    const parts: string[] = [];
    if (saved.length) parts.push(targets.length === 1 ? `Saved as ${chosen}. Everyone on this book sees it now.` : `Saved ${saved.length} record${saved.length === 1 ? '' : 's'} as ${chosen}.`);
    if (unchanged) parts.push(targets.length === 1 ? `Already classified as ${chosen}.` : `${unchanged} already had this classification.`);
    if (conflicted.length) parts.push(targets.length === 1
      ? `Another reviewer changed this record to ${classificationLabel(conflicted[0].section, conflicted[0].category)} while you were choosing.`
      : `${conflicted.length} changed by another reviewer meanwhile and left as they are.`);
    if (failures.length) parts.push(groups.size === 1 ? failures[0] : `${failures.length} of ${groups.size} sources could not be saved: ${failures[0]}`);
    setConflicts(conflicted); setMessage(parts.join(' ')); setBusy(false);
  };

  if (!targets.length) return null;
  return <section className="accounting-classifier" aria-label="Classification">
    <h3>{targets.length === 1 ? 'Classification' : `Classify ${targets.length} records`}</h3>
    {single && <p>Now <strong>{classificationLabel(single.section, single.category)}</strong></p>}
    {canCorrect ? <fieldset disabled={busy}>
      <div className="accounting-chips" role="group" aria-label="Section">{sections.map(name => <button type="button" key={name} aria-pressed={name === section} onClick={() => { if (name !== section) { setSection(name); setCategory(''); } }}>{name}</button>)}</div>
      {categories && !sections.length && <label>Section <input value={section} maxLength={80} onChange={event => setSection(event.target.value)} /></label>}
      {suggestions.length > 0 && <div className="accounting-chips" role="group" aria-label="Most used categories">{suggestions.slice(0, 6).map(row => <button type="button" key={row.category} aria-pressed={row.category === category} onClick={() => setCategory(row.category)}>{row.category}</button>)}</div>}
      <label>Category <input list={listId} value={category} maxLength={200} placeholder={suggestions.length ? 'Choose or type a category' : 'Type a category'} onChange={event => setCategory(event.target.value)} /></label>
      <datalist id={listId}>{suggestions.map(row => <option key={row.category} value={row.category}>{`${row.records} records`}</option>)}</datalist>
      <label>Note <span className="accounting-muted">optional</span><textarea value={note} maxLength={500} placeholder="Why, or the source you checked" onChange={event => setNote(event.target.value)} /></label>
      <button type="button" className="accounting-primary" disabled={!dirty} onClick={() => { void save(); }}>{busy ? 'Saving…' : targets.length === 1 ? 'Save classification' : `Classify ${targets.length} records`}</button>
    </fieldset> : <p>Review access. A reviewer with correction access can classify records.</p>}
    {message && <p role="status">{message}</p>}
    {single && conflicts.length === 1 && <div className="accounting-chips" role="group" aria-label="Resolve the change">
      <button type="button" onClick={() => {
        const theirs = conflicts[0];
        setSection(theirs.section || ''); setCategory(theirs.category || ''); setConflicts([]); setMessage(`Kept ${classificationLabel(theirs.section, theirs.category)}.`);
        onChanged([{ documentId: theirs.documentId, record: { ...theirs.record, section: theirs.section, category: theirs.category } }]);
      }}>Keep theirs</button>
      <button type="button" onClick={() => { const theirs = conflicts[0]; void save(new Map([[theirs.source_key, { section: theirs.section, category: theirs.category }]])); }}>Use mine</button>
    </div>}
    <p className="accounting-muted">{movementsOnly
      ? 'A bank movement’s classification records what the money was. It posts no expense; the year’s totals come from bookkeeping decisions.'
      : 'Bookkeeping decisions feed the year’s income and expense totals.'} Changes are attributed to you; earlier classifications stay in history.</p>
  </section>;
}
