import React from 'react';
import type { BuildLine, BuildReconstruction, BuildSystem } from './hooks/useBuildReconstruction';
import { receiptSupplierLabel } from './receiptSupplierLabel';
import './build-record.css';

const SYSTEM: Record<string, string> = { body: 'Body & metalwork', paint: 'Paint', glass: 'Glass', trim: 'Exterior trim', interior: 'Interior',
  engine: 'Engine', machining: 'Engine machine work', transmission: 'Transmission & clutch', suspension: 'Suspension', steering: 'Steering',
  brakes: 'Brakes', axle: 'Rear axle', electrical: 'Electrical', cooling: 'Cooling', fuel: 'Fuel system', exhaust: 'Exhaust',
  tires: 'Wheels & tires', hardware: 'Hardware', supplies: 'Shop supplies', unplaced: 'Not placed yet' };
const MINOR = new Set(['hardware', 'supplies', 'unplaced']);
const name = (key: string) => SYSTEM[key] ?? key.replaceAll('_', ' ');
const utc = (value: string, options: Intl.DateTimeFormatOptions) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
const month = (value: string) => utc(value, { month: 'short', year: 'numeric' });
const dayOf = (value: string | null) => value ? utc(value, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Undated';
const span = (first: string | null, last: string | null) => !first ? 'Undated' : !last || month(first) === month(last) ? month(first) : `${month(first)} – ${month(last)}`;
const hours = (value: number | null | undefined) => value == null ? null : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const isWork = (line: BuildLine) => line.kind === 'labor' || line.kind === 'service' || line.kind === 'note';

function Lines({ lines, amounts }: { lines: BuildLine[]; amounts: boolean }) {
  return <ul className="vp-build-lines">{lines.map(line => <li key={line.item_id}>
    <span className="vp-build-lines__day">{dayOf(line.day)}</span>
    <span className="vp-build-lines__what">{line.description ?? line.part_number ?? 'Unreadable line'}
      <small>{[receiptSupplierLabel(line.source), line.part_number && line.kind !== 'labor' ? `No. ${line.part_number}` : null,
        line.kind === 'backordered' ? 'backordered, not shipped' : null].filter(Boolean).join(' · ')}</small></span>
    <span className="vp-build-lines__n">{line.paper_hours != null ? hours(line.paper_hours) : ''}{amounts && line.amount != null ? <small>{money(line.amount)}</small> : null}</span>
  </li>)}</ul>;
}

function SystemRow({ system, amounts }: { system: BuildSystem; amounts: boolean }) {
  const lines = system.lines ?? [];
  const work = lines.filter(isWork); const parts = lines.filter(line => !isWork(line));
  const shops = system.paper.shops.map(receiptSupplierLabel).filter(Boolean).join(', ');
  const facts = [
    system.paper.lines > 0 ? `${shops || 'Shop'}: ${count(system.paper.lines, 'work line')}${system.paper.hours != null ? `, ${hours(system.paper.hours)} on paper` : ', hours not printed'}` : null,
    system.part_lines > 0 ? count(system.part_lines, 'part') : null,
    system.reference.hours != null ? `${hours(system.reference.hours)} reference fitting time` : null,
  ].filter(Boolean);
  return <details className="vp-build-system" data-system={system.system_key}>
    <summary>
      <span className="vp-build-system__name"><strong>{name(system.system_key)}</strong><small>{span(system.first_day, system.last_day)}</small></span>
      <span className="vp-build-system__facts">{facts.join(' · ') || 'No dated work or parts'}</span>
      {amounts && system.recorded_amount != null && <span className="vp-build-system__paid">{money(system.recorded_amount)}<small>on receipts</small></span>}
    </summary>
    {work.length > 0 && <><h5>Shop work on paper{system.paper.hours != null ? ` · ${hours(system.paper.hours)}` : ''}</h5>
      {system.paper.lines_without_hours > 0 && <p className="vp-build-note">{count(system.paper.lines_without_hours, 'line')} printed without hours.</p>}
      <Lines lines={work} amounts={amounts} /></>}
    {system.reference.operations.length > 0 && <><h5>Reference fitting time · {hours(system.reference.hours)}</h5>
      <ul className="vp-build-ops">{system.reference.operations.map(op => <li key={op.code}><span>{op.name}
        <small>{op.basis === 'implied_by_machine_shop_work' ? 'implied by the machine-shop work' : `from ${count(op.part_lines, 'part')} on the receipts`} · {op.code}</small></span>
        <span>{hours(op.hours)}</span></li>)}</ul></>}
    {system.reference.parts_without_reference > 0 && <p className="vp-build-note">{count(system.reference.parts_without_reference, 'part')} here {system.reference.parts_without_reference === 1 ? 'has' : 'have'} no fitting time on file yet, so {system.reference.parts_without_reference === 1 ? 'its' : 'their'} labor is not counted.</p>}
    {parts.length > 0 && <><h5>Parts · {parts.length}</h5><Lines lines={parts} amounts={amounts} /></>}
  </details>;
}

/** Renders the database's own fold of the receipt lines. Paper hours and reference hours are shown side by side, never summed. */
export function BuildRecord({ record }: { record: BuildReconstruction }) {
  const { totals } = record;
  if (!totals.lines) return null;
  const main = record.systems.filter(system => !MINOR.has(system.system_key));
  const minor = record.systems.filter(system => MINOR.has(system.system_key));
  return <section id="build-record" className="vp-build" aria-label="Build record">
    <header><h4>Build record</h4>
      <p>Computed from {count(totals.lines, 'line')} on {count(totals.receipts, 'receipt and work order', 'receipts and work orders')}, {span(totals.first_day, totals.last_day)}.</p></header>
    <dl className="vp-build-totals">
      <div><dt>Shop hours on paper</dt><dd>{hours(totals.paper_hours) ?? 'None printed'}</dd><small>printed on {count(totals.paper_work_lines, 'shop work line')}</small></div>
      <div><dt>Reference fitting time</dt><dd>{hours(totals.reference_hours) ?? 'None'}</dd><small>{count(totals.reference_operations, 'job')} with a book time on file</small></div>
      <div><dt>Parts with no labor counted</dt><dd>{totals.parts_without_reference.toLocaleString('en-US')} of {totals.part_lines.toLocaleString('en-US')}</dd><small>no fitting time on file for them yet</small></div>
      {record.amounts_visible && totals.recorded_amount != null && <div><dt>On the receipts</dt><dd>{money(totals.recorded_amount)}</dd><small>visible to you only</small></div>}
    </dl>
    <p className="vp-build-note">Paper hours and reference time are different measures and are not added together. Neither is the full labor in this build.
      {record.systems_without_paper.length > 0 && <> No receipt or work order on file for: {record.systems_without_paper.map(name).join(', ')}.</>}</p>
    <div className="vp-build-systems">{main.map(system => <SystemRow key={system.system_key} system={system} amounts={record.amounts_visible} />)}</div>
    {minor.length > 0 && <div className="vp-build-systems vp-build-systems--minor">{minor.map(system => <SystemRow key={system.system_key} system={system} amounts={record.amounts_visible} />)}</div>}
  </section>;
}
