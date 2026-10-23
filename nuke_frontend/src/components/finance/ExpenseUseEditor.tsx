import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { expenseUseCorrection, readExpenseSnapshot, type ExpenseSnapshot, type ExpenseUse } from '../../services/financialExpenseUse';
import { useAccountingBook } from './AccountingBookContext';
import type { SavedRecord } from './FinancialWorkpapers';

type Vehicle = { id: string; year: number | null; make: string | null; model: string | null; vin: string | null };
const vehicleLabel = (v: Vehicle) => [v.year, v.make, v.model, v.vin ? `VIN …${v.vin.slice(-6)}` : 'VIN not recorded'].filter(Boolean).join(' ');
export default function ExpenseUseEditor({ documentId, record, onSaved, onCurrentRecord }: { documentId: string; record: SavedRecord['record']; onSaved: () => void; onCurrentRecord?: (record: SavedRecord['record']) => void }) {
  const { ownerId, canCorrect, liveRevision } = useAccountingBook();
  const [snapshot, setSnapshot] = useState<ExpenseSnapshot | null>(null);
  const [type, setType] = useState<ExpenseUse['use_type']>('unassigned');
  const [vehicleId, setVehicleId] = useState(''), [amount, setAmount] = useState(''), [basis, setBasis] = useState('');
  const [dirty, setDirty] = useState(false), [conflict, setConflict] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Loading current use…'), [vehicles, setVehicles] = useState<Vehicle[]>([]), [search, setSearch] = useState('');
  const [vehicleMessage, setVehicleMessage] = useState('');
  const current = useRef({ snapshot, dirty }); current.current = { snapshot, dirty };
  const latest = useRef<ExpenseSnapshot | null>(null), epoch = useRef(0);
  const pending = useRef<ReturnType<typeof expenseUseCorrection> | null>(null);
  const apply = (value: ExpenseSnapshot) => {
    current.current = { snapshot: value, dirty: false };
    onCurrentRecord?.(value.record as SavedRecord['record']);
    setSnapshot(value); setType(value.use?.use_type || 'unassigned'); setVehicleId(value.use?.vehicle_id || '');
    setAmount(value.use?.allocated_amount ?? ''); setBasis(value.use?.basis || ''); setDirty(false); setConflict(false); pending.current = null;
    setMessage(value.use ? `Current use: ${value.use.destination_label}` : 'This expense has no assigned vehicle or shop use yet.');
  };
  useEffect(() => {
    epoch.current++; current.current = { snapshot: null, dirty: false }; latest.current = null; pending.current = null;
    setSnapshot(null); setDirty(false); setConflict(false); setBusy(false); setVehicles([]); setSearch('');
    return () => { epoch.current++; };
  }, [ownerId, documentId, record.source_key]);
  useEffect(() => {
    const generation = epoch.current; let cancelled = false;
    if (!ownerId || !record.source_key) return;
    void readExpenseSnapshot(ownerId, documentId, record.source_key).then(value => {
      if (cancelled || epoch.current !== generation) return;
      latest.current = value;
      if (current.current.dirty) {
        if (current.current.snapshot?.runId !== value.runId) { setConflict(true); setMessage('Another reviewer changed this source. Your unsaved draft is preserved. Reload the current values before saving.'); }
      } else apply(value);
    }).catch(error => { if (!cancelled && epoch.current === generation) { setConflict(true); setMessage(error instanceof Error ? error.message : 'Current use unavailable.'); } });
    return () => { cancelled = true; };
  }, [ownerId, documentId, record.source_key, liveRevision]);
  useEffect(() => {
    if (type !== 'vehicle' || !ownerId) return;
    let cancelled = false;
    setVehicleMessage('Loading accessible book-owner vehicles…');
    void Promise.resolve(supabase.from('vehicles').select('id, year, make, model, vin').or(`owner_id.eq.${ownerId},user_id.eq.${ownerId}`).is('deleted_at', null).is('merged_into_vehicle_id', null).order('year').order('id').limit(200))
      .then(({ data, error }) => { if (cancelled) return; setVehicles(error ? [] : data || []); setVehicleMessage(error ? 'Vehicles could not load. Your assignment has not changed.' : data?.length === 200 ? 'Showing the first 200 accessible vehicles. Use a specific profile if its name is missing.' : 'Choose the actual recipient; matching part fitment alone is insufficient.'); })
      .catch(() => { if (!cancelled) { setVehicles([]); setVehicleMessage('Vehicles could not load. Your assignment has not changed.'); } });
    return () => { cancelled = true; };
  }, [type, ownerId]);
  const edit = () => { current.current.dirty = true; setDirty(true); pending.current = null; };
  const reload = async () => {
    if (!ownerId || !record.source_key) return;
    const generation = epoch.current; setBusy(true);
    try { const value = await readExpenseSnapshot(ownerId, documentId, record.source_key); if (epoch.current === generation) { latest.current = value; apply(value); } }
    catch { if (epoch.current === generation) setMessage('Current expense could not reload. Your draft is preserved.'); }
    finally { if (epoch.current === generation) setBusy(false); }
  };
  const save = async () => {
    if (!snapshot || !canCorrect || !ownerId || !record.source_key || busy || conflict) return;
    const generation = epoch.current; setBusy(true);
    try {
      const chosen = vehicles.find(v => v.id === vehicleId);
      if (type === 'vehicle' && !chosen && snapshot.use?.vehicle_id !== vehicleId) throw new Error('Choose an accessible recipient vehicle.');
      const use: ExpenseUse = { source_key: record.source_key, use_type: type, vehicle_id: type === 'vehicle' ? vehicleId : null,
        destination_label: type === 'shop' ? 'Shop' : type === 'vehicle' ? chosen ? vehicleLabel(chosen) : snapshot.use!.destination_label : 'Unassigned',
        allocated_amount: type === 'unassigned' ? '0' : amount, unallocated_amount: '', basis: basis.trim() };
      pending.current ||= expenseUseCorrection(snapshot, use, crypto.randomUUID());
      const result = await supabase.functions.invoke('ingest-observation', { body: pending.current });
      if (epoch.current !== generation) return;
      if (result.error || result.data?.error) { setConflict(true); throw new Error('Save was not confirmed. Another reviewer may have changed this source or access may have changed. Reload current values; your draft is preserved.'); }
      const saved = await readExpenseSnapshot(ownerId, documentId, record.source_key);
      if (epoch.current !== generation) return;
      apply(saved); setMessage('Saved to the shared ledger. Other reviewers will receive the update.'); onSaved();
    } catch (error) { if (epoch.current === generation) setMessage(error instanceof Error ? error.message : 'Save could not be confirmed. Your draft is preserved.'); }
    finally { if (epoch.current === generation) setBusy(false); }
  };
  const choices = vehicles.filter(v => search.toLowerCase().split(/\s+/).every(token => vehicleLabel(v).toLowerCase().includes(token)));
  return <section className="accounting-use-editor" aria-label="Expense vehicle or shop use">
    <h3>Vehicle or shop use</h3><p role="status">{message}</p>
    {snapshot && <p>Recorded expense: {snapshot.record.amount} {snapshot.record.currency}. {snapshot.use?.unallocated_amount && `Unassigned: ${snapshot.use.unallocated_amount} ${snapshot.record.currency}.`}</p>}
    {canCorrect && snapshot ? <>
      <fieldset disabled={busy}><legend>Assign this expense</legend>
        <label>Use <select value={type} onChange={e => { setType(e.target.value as ExpenseUse['use_type']); edit(); }}><option value="unassigned">Unassigned</option><option value="shop">Shop</option><option value="vehicle">Vehicle</option></select></label>
        {type === 'vehicle' && <><label>Find vehicle <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Year, model or VIN" /></label><p>{vehicleMessage}</p><label>Recipient vehicle <select value={vehicleId} onChange={e => { setVehicleId(e.target.value); edit(); }}><option value="">Choose a vehicle</option>{snapshot.use?.vehicle_id && !choices.some(v => v.id === snapshot.use!.vehicle_id) && <option value={snapshot.use.vehicle_id}>{snapshot.use.destination_label}</option>}{choices.map(v => <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>)}</select></label></>}
        {type !== 'unassigned' && <label>Amount assigned <input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); edit(); }} placeholder={snapshot.record.amount || ''} /></label>}
        <label>Reason / source <textarea value={basis} maxLength={500} onChange={e => { setBasis(e.target.value); edit(); }} /></label>
      </fieldset>
      <button type="button" disabled={!dirty || busy || conflict} onClick={() => { void save(); }}>{busy ? 'Saving…' : 'Save use assignment'}</button>{' '}
      {conflict && <button type="button" disabled={busy} onClick={() => { void reload(); }}>Reload current values</button>}
      <p className="accounting-muted">Partial assignments leave the remainder unassigned. Earlier decisions remain in history.</p>
    </> : !canCorrect && <p>Review access. A reviewer with correction access can edit this assignment.</p>}
  </section>;
}
