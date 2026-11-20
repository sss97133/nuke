import React from 'react';
import type { PartEvidence, PartEvidenceLine, BuildLine, BuildReconstruction, BuildSystem } from './hooks/useBuildReconstruction';
import { receiptSupplierLabel } from './receiptSupplierLabel';
import { openVehiclePhoto } from './VehiclePhotoLightbox';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import './build-record.css';

const PHASE: Record<string, string> = { teardown: 'Teardown', metalwork: 'Metalwork', paint_prep: 'Paint preparation', paint_application: 'Paint application' };
const SYSTEM: Record<string, string> = { teardown: 'Teardown', body: 'Body & metalwork', paint: 'Paint', glass: 'Glass', trim: 'Exterior trim', interior: 'Interior',
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

/** item id → the photographs that show that part, when the evidence read has arrived. */
export const SeenContext = React.createContext<Map<string, PartEvidenceLine> | null>(null);

export function Seen({ itemId }: { itemId: string }) {
  const seen = React.useContext(SeenContext)?.get(itemId);
  if (!seen || seen.status === 'not_photographed' || !seen.seen?.length) return null;
  return <button type="button" className="vp-build-seen" onClick={() => openVehiclePhoto(seen.seen![0].image_id)}>
    Seen on the car in {count(seen.seen_images, 'photo')}{seen.status === 'seen_in_prints_only' ? ' (prints of older photographs)' : seen.last_day ? `, ${span(seen.first_day, seen.last_day)}` : ''}
  </button>;
}

function Lines({ lines, amounts }: { lines: BuildLine[]; amounts: boolean }) {
  return <ul className="vp-build-lines">{lines.map(line => <li key={line.item_id}>
    <span className="vp-build-lines__day">{dayOf(line.day)}</span>
    <span className="vp-build-lines__what">{line.name ?? line.description ?? line.part_number ?? 'Unreadable line'}
      <small>{[line.name && line.description ? `Printed as “${line.description}”` : null, receiptSupplierLabel(line.source), line.part_number && line.kind !== 'labor' ? `No. ${line.part_number}` : null,
        line.kind === 'backordered' ? 'backordered, not shipped' : null].filter(Boolean).join(' · ')}</small><Seen itemId={line.item_id} /></span>
    <span className="vp-build-lines__n">{line.paper_hours != null ? hours(line.paper_hours) : ''}{amounts && line.amount != null ? <small>{money(line.amount)}</small> : null}</span>
  </li>)}</ul>;
}

export function SystemRow({ system, amounts, open = false, anchor = false }: { system: BuildSystem; amounts: boolean; open?: boolean; anchor?: boolean }) {
  const lines = system.lines ?? [];
  const work = lines.filter(isWork); const parts = lines.filter(line => !isWork(line));
  const shops = system.paper.shops.map(receiptSupplierLabel).filter(Boolean).join(', ');
  const facts = [
    system.paper.lines > 0 ? `${shops || 'Shop'}: ${count(system.paper.lines, 'work line')}${system.paper.hours != null ? `, ${hours(system.paper.hours)} on paper` : ', hours not printed'}` : null,
    system.part_lines > 0 ? count(system.part_lines, 'part') : null,
    system.reference.hours != null ? `${hours(system.reference.hours)} reference fitting time` : null,
    system.photos?.images ? count(system.photos.images, 'photo') : null,
    system.stages?.length ? `${system.stages.map(stage => (PHASE[stage.phase] ?? stage.phase).toLowerCase()).join(', ')} photographed` : null,
  ].filter(Boolean);
  return <details className="vp-build-system" id={anchor ? `build-${system.system_key}` : undefined} data-system={system.system_key} open={open || undefined}>
    <summary>
      <span className="vp-build-system__name"><strong>{name(system.system_key)}</strong><small>{system.first_day ? span(system.first_day, system.last_day) : 'No paper on file'}</small></span>
      <span className="vp-build-system__facts">{facts.join(' · ') || 'No dated work or parts'}</span>
      {amounts && system.recorded_amount != null && <span className="vp-build-system__paid">{money(system.recorded_amount)}<small>on receipts</small></span>}
    </summary>
    {!!system.photos?.sample?.length && <><h5>As photographed · {count(system.photos.images, 'photo')}{system.photos.last_day ? `, ${span(system.photos.first_day, system.photos.last_day)}` : ''}</h5>
      <div className="vp-build-photos">{system.photos.sample.map(photo => <button type="button" key={photo.image_id} onClick={() => openVehiclePhoto(photo.image_id)}
        aria-label={`Open ${name(system.system_key)} photo`}><img src={optimizeImageUrl(photo.image_url, 'thumbnail') || photo.image_url} alt="" loading="lazy" /></button>)}</div></>}
    {system.stages?.map(stage => <React.Fragment key={stage.phase}>
      <h5>{PHASE[stage.phase] ?? stage.phase} · seen in {count(stage.images, 'photo')}</h5>
      <p className="vp-build-note">{stage.prints === stage.images ? 'Prints of older photographs: the day of the work is not on them.' : span(stage.first_day, stage.last_day)}
        {stage.reference && stage.reference.hours_min != null && stage.reference.hours_max != null
          ? ` Stored range for this stage on a whole car (${stage.reference.description}): ${hours(stage.reference.hours_min)} to ${hours(stage.reference.hours_max)}. A range for the stage, not a measure of this car's hours.`
          : ' No stored hour range for this stage.'}</p>
      {!!stage.sample?.length && <div className="vp-build-photos">{stage.sample.map(photo => <button type="button" key={photo.image_id} onClick={() => openVehiclePhoto(photo.image_id)}
        aria-label={`Open ${PHASE[stage.phase] ?? stage.phase} photo`}><img src={optimizeImageUrl(photo.image_url, 'thumbnail') || photo.image_url} alt="" loading="lazy" /></button>)}</div>}
    </React.Fragment>)}
    {work.length > 0 && <><h5>Shop work on paper{system.paper.hours != null ? ` · ${hours(system.paper.hours)}` : ''}</h5>
      {!!system.paper.subjects?.length && <p className="vp-build-note">Written up by the shop as: {system.paper.subjects.map(subject => `“${subject}”`).join('; ')}</p>}
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
export function BuildRecord({ record, evidence }: { record: BuildReconstruction; evidence?: PartEvidence | null }) {
  const seen = React.useMemo(() => evidence ? new Map(evidence.lines.map(line => [line.item_id, line])) : null, [evidence]);
  // A link to #build-<system> opens that system's row and brings it into view, so a letter or comment can cite one system.
  React.useEffect(() => {
    const show = () => {
      const match = /^#build-([a-z_]+)$/.exec(window.location.hash);
      const row = match && document.getElementById(`build-${match[1]}`);
      if (row instanceof HTMLDetailsElement) { row.open = true; row.scrollIntoView({ block: 'start' }); }
    };
    show(); window.addEventListener('hashchange', show);
    return () => window.removeEventListener('hashchange', show);
  }, [record]);
  const { totals } = record;
  if (!totals.lines) return null;
  const main = record.systems.filter(system => !MINOR.has(system.system_key));
  const minor = record.systems.filter(system => MINOR.has(system.system_key));
  return <SeenContext.Provider value={seen}><section id="build-record" className="vp-build" aria-label="Build record">
    <header><h4>Build record</h4>
      <p>Computed from {count(totals.lines, 'line')} on {count(totals.receipts, 'receipt and work order', 'receipts and work orders')}, {span(totals.first_day, totals.last_day)}.</p></header>
    <dl className="vp-build-totals">
      <div><dt>Shop hours on paper</dt><dd>{hours(totals.paper_hours) ?? 'None printed'}</dd><small>printed on {count(totals.paper_work_lines, 'shop work line')}</small></div>
      <div><dt>Reference fitting time</dt><dd>{hours(totals.reference_hours) ?? 'None'}</dd><small>{count(totals.reference_operations, 'job')} with a book time on file</small></div>
      <div><dt>Parts with no labor counted</dt><dd>{totals.parts_without_reference.toLocaleString('en-US')} of {totals.part_lines.toLocaleString('en-US')}</dd><small>no fitting time on file for them yet</small></div>
      {!!totals.photo_images && <div><dt>Photos tied to a system</dt><dd>{totals.photo_images.toLocaleString('en-US')}</dd><small>analysed photos that name a part</small></div>}
      {!!totals.stage_hours?.stages && totals.stage_hours.min != null && totals.stage_hours.max != null && <div><dt>Stages seen in photos</dt><dd>{hours(totals.stage_hours.min)} to {hours(totals.stage_hours.max)}</dd><small>stored range for {count(totals.stage_hours.stages, 'photographed stage')}</small></div>}
      {record.amounts_visible && totals.recorded_amount != null && <div><dt>On the receipts</dt><dd>{money(totals.recorded_amount)}</dd><small>visible to you only</small></div>}
    </dl>
    <p className="vp-build-note">Paper hours, reference time and stage ranges are different measures and are not added together. Neither is the full labor in this build.
      {evidence && <> {evidence.totals.lines_seen.toLocaleString('en-US')} of {evidence.totals.part_lines.toLocaleString('en-US')} bought parts are named in a photograph of the finished car; a photograph shows that kind of part is on the car, not that the receipt's unit is the one fitted.</>}
      {record.systems_without_paper.length > 0 && <> No receipt or work order on file for: {record.systems_without_paper.map(name).join(', ')}.</>}</p>
    <div className="vp-build-systems">{main.map(system => <SystemRow key={system.system_key} system={system} amounts={record.amounts_visible} anchor />)}</div>
    {minor.length > 0 && <div className="vp-build-systems vp-build-systems--minor">{minor.map(system => <SystemRow key={system.system_key} system={system} amounts={record.amounts_visible} anchor />)}</div>}
  </section></SeenContext.Provider>;
}

/** The header tokens name a component; these are the build systems whose paper and photos are that component's work. */
const TOKEN_SYSTEMS: Record<string, string[]> = { engine: ['machining', 'engine', 'fuel', 'cooling', 'exhaust'], transmission: ['transmission'], drivetrain: ['axle'] };

/** In a header token's popup: the same per-system rows as the build record, for the systems that token names. */
export function TokenBuildRecord({ record, dimension }: { record: BuildReconstruction | null | undefined; dimension: string }) {
  const wanted = TOKEN_SYSTEMS[dimension];
  if (!record || !wanted) return null;
  const systems = wanted.map(key => record.systems.find(system => system.system_key === key)).filter((system): system is BuildSystem => !!system);
  if (!systems.length) return null;
  return <section className="vp-build vp-build--token" aria-label="Work on record">
    <header><h4>Work on record</h4><p>From the receipts, work orders and analysed photos. Paper hours and reference time are different measures and are not added.</p></header>
    <div className="vp-build-systems">{systems.map((system, index) => <SystemRow key={system.system_key} system={system} amounts={record.amounts_visible} open={index === 0} />)}</div>
  </section>;
}
