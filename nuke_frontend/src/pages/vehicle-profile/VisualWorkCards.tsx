import React, { useRef, useState } from 'react';
import { CatalogProductReference } from './CatalogProductReference';
import { openVehiclePhoto } from './VehiclePhotoLightbox';
import { optimizeImageUrl } from '../../lib/imageOptimizer';
import type { ComponentEvidence, ComponentReading, CostRange, CostTotals, MasterCostLedger, MasterCostLine, VisualWork } from './hooks/useVisualWork';
import { receiptSupplierLabel } from './receiptSupplierLabel';
import './visual-work.css';

const date = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function photoDate(image: { taken_at: string | null; capture_time_zone?: string | null }): string {
  if (!image.taken_at || !Number.isFinite(Date.parse(image.taken_at))) return 'Photo date unknown';
  const captured = new Date(image.taken_at);
  const format = (timeZone: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric',
    timeZone, timeZoneName: 'short' }).format(captured);
  try { return format(image.capture_time_zone || 'UTC'); } catch { return format('UTC'); }
}
const amount = (value: number, currency: string | null) => {
  if (currency) try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value); } catch { /* Preserve the amount without guessing currency. */ }
  return `${value.toLocaleString('en-US')} · currency ${currency ? 'unrecognized' : 'unrecorded'}`;
};

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
function range(value: CostRange | null, currency?: string | null): string {
  if (!value) return 'Unpriced';
  const fmt = (v: number) => currency ? amount(v, currency) : number(v);
  if (value.min != null && value.max != null && value.min !== value.max) return `${fmt(value.min)}–${fmt(value.max)}`;
  const v = value.typical ?? value.min ?? value.max;
  return v == null ? 'Unpriced' : fmt(v);
}
function CostValue({ value, currency }: { value: CostRange | null; currency?: string | null }) {
  if (!value) return <>Unpriced</>;
  const typical = value.typical == null ? null : currency ? amount(value.typical, currency) : number(value.typical);
  const band = value.min != null && value.max != null && value.min !== value.max;
  return <span className="vp-cost-value"><span>{typical ?? range(value, currency)}</span>{band && typical && <small>{range(value, currency)} range</small>}</span>;
}
const systemName = (key: string) => (({ body: 'Body & metalwork', paint: 'Paint', glass: 'Glass', trim: 'Exterior trim',
  interior: 'Interior', engine: 'Engine', machining: 'Machining', transmission: 'Transmission & clutch', suspension: 'Suspension',
  steering: 'Steering', brakes: 'Brakes', axle: 'Rear axle', electrical: 'Electrical', cooling: 'Cooling', fuel: 'Fuel system',
  exhaust: 'Exhaust', tires: 'Wheels & tires', assembly: 'Assembly & checks' } as Record<string, string>)[key] || key.replaceAll('_', ' '));
const reason = (value: string) => value.replaceAll('_', ' ');
function timeBasis(reference: NonNullable<MasterCostLine['reference']>): string {
  if (reference.type === 'analyst_range' || reference.label === 'attributed_scenario_uncalibrated') return 'Proposed labor range (not calibrated)';
  if (reference.label === 'seed_uncalibrated') return 'Reference allowance (not calibrated)';
  return reason(String(reference.label || reference.type || 'Unresolved reference'));
}

/** Link only URLs already present in the qualified reader text; do not fetch or infer citations. */
function sourceText(text: string): React.ReactNode {
  return text.split(/(https:\/\/[^\s<>"']+)/gi).map((part, index) => {
    if (!/^https:\/\//i.test(part)) return part;
    let href = part.replace(/[.,;:!?]+$/, '');
    // A prose closing delimiter is not part of the source URL; balanced URL parentheses remain intact.
    while (/[)\]}]$/.test(href)) {
      const close = href.at(-1)!;
      const open = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[close];
      if (href.split(close).length <= href.split(open).length) break;
      href = href.slice(0, -1);
    }
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || href.includes('\\')) return part;
    } catch { return part; }
    return <React.Fragment key={index}><a href={href} target="_blank" rel="noopener noreferrer">{href}</a>{part.slice(href.length)}</React.Fragment>;
  });
}
function moneyTotals(values: CostTotals['currencies'] | undefined) {
  return values?.length ? values.map(v => <CostValue key={v.currency} value={v.cost} currency={v.currency} />) : 'Unpriced';
}

/** All arithmetic, overlap selection and source qualification belong to the existing SQL work reader. */
function MasterLedger({ ledger, works, renderSource }: { ledger: MasterCostLedger; works: VisualWork[];
  renderSource: (line: VisualWork['receipts'][number]) => React.ReactNode }) {
  const [scenarioKey, setScenarioKey] = useState('reconstruct_observed');
  const [system, setSystem] = useState('');
  const [inspected, setInspected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const scenario = ledger.scenarios.find(s => s.scenario === scenarioKey) ?? ledger.scenarios[0];
  if (!scenario) return null;
  const selectedSystem = scenario.systems.find(s => s.system_key === system);
  const totals = selectedSystem?.totals ?? scenario.totals;
  const coverage = selectedSystem?.coverage ?? scenario.coverage;
  const lines = scenario.rows.filter(r => !selectedSystem || r.system_key === system);
  const key = (line: MasterCostLine) => `${scenario.scenario}:${line.kind}:${line.physical_key}`;
  const detail = lines.find(r => key(r) === inspected);
  const sourcesFor = (line: MasterCostLine) => works.filter(w => line.work_observation_ids.includes(w.observation_id));
  // Rows cite photographs by image_id through the ledger's image map; an object is a row-specific citation.
  const photoOf = (ref: MasterCostLine['source_images'][number] | undefined) => typeof ref === 'string' ? ledger.images?.[ref] : ref;
  const detailWorks = detail ? sourcesFor(detail) : [];
  const photos = (detail?.source_images ?? []).map(photoOf).filter((im): im is VisualWork['images'][number] => !!im);
  const receiptItem = detail?.pricing?.receipt_item_id;
  const receiptLines = detailWorks.flatMap(w => w.receipts).filter((r, index, all) =>
    (!receiptItem || r.item_id === receiptItem) && all.findIndex(x => x.item_id === r.item_id) === index);
  const reference = detail?.reference;
  const serviceFee = reference?.type === 'fixed_service_fee';
  const referenceName = reference?.description || reference?.name;
  const rateValue = detail?.rate_basis?.rate;
  const rateCurrency = detail?.rate_basis?.currency;
  const detailPanel = detail && <div id="vp-ledger-evidence" className="vp-ledger-evidence" role="region" aria-label={`Calculation for ${detail.label}`}>
      <div className="vp-ledger-detail-heading"><h5>{detail.label}</h5><button type="button" onClick={() => { setInspected(null); trigger.current?.focus(); }}>Close</button></div>
      <p><strong><CostValue value={detail.cost} currency={detail.currency} /></strong>{detail.hours && <> · <CostValue value={detail.hours} /> estimated person-hours</>}
        {serviceFee && <> · Person-hours unknown</>}</p>
      {typeof detail.formula === 'string' && <p className="vp-ledger-equation">{detail.formula}</p>}
      {typeof rateValue === 'number' && <p>Rate: {amount(rateValue, typeof rateCurrency === 'string' ? rateCurrency : detail.currency)} per person-hour
        {typeof detail.rate_basis?.source === 'string' ? ` · ${reason(detail.rate_basis.source)}` : ''}.</p>}
      {detail.quantity?.derivation && <p>Quantity: {sourceText(detail.quantity.derivation)}</p>}
      {serviceFee && <p>Price basis: {reference.price_basis === 'published_starting_price' ? 'Published starting-price comparison' : 'Published service-menu comparison'}.
        {' '}This is not a vehicle-specific quote.
        {typeof reference.derivation === 'string' && <> {sourceText(reference.derivation)}</>}
        {typeof reference.source_url === 'string' && <> Source: {sourceText(reference.source_url)}.</>}
        {typeof reference.source_retrieved_at === 'string' && <> Captured {date(reference.source_retrieved_at)}.</>}</p>}
      {reference && !serviceFee && <p>Time basis: {typeof referenceName === 'string' ? `${referenceName} · ` : ''}{timeBasis(reference)}
        {reference.code ? ` (${String(reference.code)})` : ''}.
        {typeof reference.derivation === 'string' && reference.derivation.trim() !== detail.quantity?.derivation?.trim()
          && <> {sourceText(reference.derivation)}</>}</p>}
      {typeof detail.rate_basis?.derivation === 'string' && <p>{sourceText(detail.rate_basis.derivation)}</p>}
      {typeof detail.pricing?.derivation === 'string' && <p>Price basis: {sourceText(detail.pricing.derivation)}</p>}
      {detail.evidence_role && <p>{detail.evidence_role === 'observed_transition' ? 'A before/after sequence supports the change; hours are estimated.'
        : detail.evidence_role === 'conditional_finish' ? 'Conditional finishing scope; this does not establish that the work is required.'
        : 'Calculated reconstruction scope; this does not establish the historical installation date or labor time.'}</p>}
      {detail.reasons.length > 0 && <ul>{detail.reasons.map(r => <li key={r}>{reason(r)}</li>)}</ul>}
      {photos.length > 0 && <div className="vp-work-photos">{photos.map(im => <button type="button" key={im.image_id} onClick={() => openVehiclePhoto(im.image_id)} aria-label={`Open source photo: ${im.caption}`}>
        <img src={optimizeImageUrl(im.image_url, 'medium') || im.image_url} alt={im.caption} loading="lazy" /><small>{im.caption}</small>
      </button>)}</div>}
      {receiptLines.length > 0 && <div className="vp-ledger-receipt-links">{receiptLines.map(line => <div key={line.item_id}>
        <strong>{line.description || line.part_number}</strong><small>{receiptSupplierLabel(line.vendor)}{line.amounts_visible && line.amount != null ? ` · ${amount(line.amount, line.currency)} recorded charge` : ''}</small>
        <small>{line.relation === 'documented_operation' ? `Recorded operation${line.hours != null ? ` · ${number(line.hours)} documented person-hours` : ''}` : 'Receipt candidate · exact installation not established'}</small>
        <CatalogProductReference product={line.product} />{renderSource(line)}
      </div>)}</div>}
    </div>;
  return <section className="vp-master-ledger" aria-label="Master cost ledger">
    <header><div><span>Itemized build costs</span><h4>Master ledger</h4></div>
      <time dateTime={ledger.as_of}>Calculated {date(ledger.as_of)}</time></header>
    <p className="vp-ledger-intro">{scenario.scenario === 'finish_scenario' ? 'Possible finishing work, with optional work excluded until selected.' : 'The work and materials in the reconstruction scenario for this build.'} Open an item for its calculation and source photos.</p>
    <div className="vp-ledger-controls">
      {ledger.scenarios.length > 1 && <label>Cost question<select aria-label="Cost question" value={scenario.scenario} onChange={e => { setScenarioKey(e.target.value); setSystem(''); setInspected(null); }}>
        {ledger.scenarios.map(s => <option key={s.scenario} value={s.scenario}>{s.scenario === 'finish_scenario' ? 'Possible finishing work' : 'Reproduce the observed build'}</option>)}
      </select></label>}
      <label>System<select aria-label="System" value={selectedSystem ? system : ''} onChange={e => { setSystem(e.target.value); setInspected(null); }}>
        <option value="">Whole car</option>{scenario.systems.map(s => <option key={s.system_key} value={s.system_key}>{systemName(s.system_key)}</option>)}
      </select></label>
      <span>{coverage.resolved_lines + coverage.partial_lines} of {coverage.lines} items have a calculation</span>
    </div>
    <dl className="vp-ledger-totals">
      <div><dt>Estimated person-hours{totals.hours_coverage?.status === 'partial' ? ' (partial)' : ''}</dt><dd>{totals.hours ? <CostValue value={totals.hours} /> : 'Unestimated'}</dd></div>
      <div><dt>Labor estimate</dt><dd>{moneyTotals(totals.labor_currencies)}</dd></div>
      <div><dt>Replacement materials</dt><dd>{moneyTotals(totals.material_currencies)}</dd></div>
      <div><dt>Priced subtotal</dt><dd>{moneyTotals(totals.currencies)}</dd></div>
    </dl>
    <p className="vp-ledger-qualification">{coverage.unresolved_lines > 0 ? `${coverage.unresolved_lines} items still need inputs. ` : ''}
      {!!totals.hours_coverage?.unknown_lines && `${totals.hours_coverage.unknown_lines} labor ${totals.hours_coverage.unknown_lines === 1 ? 'item has' : 'items have'} unknown person-hours; a service price does not measure time. `}
      {coverage.partial_lines > 0 ? `${coverage.partial_lines} calculations have incomplete ranges or inputs. ` : ''}
      {coverage.duplicate_claims_folded > 0 ? `${coverage.duplicate_claims_folded} repeated references counted once. ` : ''}
      Reference and analyst estimates remain separate from documented charges in the receipts below. Vehicle sale value and current component value are not calculated here.</p>
    <div className="vp-ledger-table-wrap"><table className="vp-ledger-table">
      <thead><tr><th>Work or material</th><th>Quantity</th><th>Hours</th><th>Calculated cost</th></tr></thead>
      <tbody>{lines.map(line => {
        const own = sourcesFor(line); const photo = photoOf(line.source_images?.[0]);
        const product = own.flatMap(w => w.receipts).find(r => r.item_id === line.pricing?.receipt_item_id)?.product;
        const thumbnail = product?.image_url || photo?.image_url;
        return <React.Fragment key={key(line)}><tr className={line.status === 'excluded' ? 'vp-ledger-excluded' : undefined}>
          <td><button type="button" onClick={e => { trigger.current = e.currentTarget; setInspected(inspected === key(line) ? null : key(line)); }}
            aria-expanded={inspected === key(line)} aria-controls="vp-ledger-evidence">
            {thumbnail && (product?.image_url
              ? <span className="vp-catalog-media"><img src={optimizeImageUrl(thumbnail, 'thumbnail') || thumbnail} alt="Supplier stock image" width={48} height={38} loading="lazy" /></span>
              : <img src={optimizeImageUrl(thumbnail, 'thumbnail') || thumbnail} alt="" width={48} height={38} loading="lazy" />)}
            <span><strong>{line.label}</strong><small>{systemName(line.system_key)} · {line.kind === 'labor' ? 'Labor' : 'Material'}
              {line.status === 'excluded' ? ' · Excluded from subtotal' : line.status === 'unresolved' ? ' · Needs inputs' : ''}
              {line.reference?.type === 'fixed_service_fee' && (line.reference.price_basis === 'published_starting_price' ? ' · Starting-price comparison' : ' · Service-menu comparison')}</small></span>
          </button></td>
          <td>{line.quantity?.value != null ? `${number(line.quantity.value)} ${line.quantity.unit || ''}` : '—'}</td>
          <td>{line.hours ? <CostValue value={line.hours} /> : line.kind === 'labor' && line.status !== 'excluded' ? 'Unknown' : '—'}</td>
          <td><button type="button" className="vp-ledger-value" onClick={e => { trigger.current = e.currentTarget; setInspected(inspected === key(line) ? null : key(line)); }}
            aria-label={`See calculation: ${line.label}`} aria-expanded={inspected === key(line)} aria-controls="vp-ledger-evidence">
            {line.status === 'excluded' ? 'Excluded' : <CostValue value={line.cost} currency={line.currency} />}</button></td>
        </tr>{inspected === key(line) && <tr><td colSpan={4}>{detailPanel}</td></tr>}</React.Fragment>;
      })}</tbody></table></div>

    {(ledger.coverage.source_read_limited || ledger.coverage.cards_without_estimates > 0) && <p className="vp-ledger-qualification">The work record still has sources without cost lines; the subtotal is incomplete.</p>}
  </section>;
}

function ComponentSources({ evidence, renderSource }: { evidence?: ComponentEvidence | null;
  renderSource: (line: VisualWork['receipts'][number]) => React.ReactNode }) {
  if (!evidence?.components.length) return null;
  const reading = (item: ComponentReading, label: string) => item.images.map(image => <button type="button"
    key={`${item.observation_id}:${image.image_id}`} className="vp-component-reading"
    onClick={() => openVehiclePhoto(image.image_id)} aria-label={`Open ${label.toLowerCase()}: ${item.quote}`}>
    <span className="vp-component-frame"><img src={optimizeImageUrl(image.image_url, 'medium') || image.image_url}
      alt={image.caption || item.quote} width={320} height={240} loading="lazy" />
      <span className="vp-component-region" aria-hidden="true" style={{ left: `${image.bbox[0] / 999 * 100}%`,
        top: `${image.bbox[1] / 999 * 100}%`, width: `${(image.bbox[2] - image.bbox[0]) / 999 * 100}%`,
        height: `${(image.bbox[3] - image.bbox[1]) / 999 * 100}%` }} /></span>
    <strong>{label}</strong><span>{item.quote}</span>
    <small title={image.capture_time_basis || 'Source photo clock'}>{photoDate(image) === 'Photo date unknown'
      ? 'Photo date unknown' : `Photo · ${photoDate(image)}`}</small>
    <small>Read {date(item.evidence_time)} · attributed image reading</small>
  </button>);
  return <section className="vp-component-evidence" aria-label="Component evidence">
    <header><h4>Parts on the car</h4><p>Open a photo to inspect the outlined part. Related purchases sit beside it.</p></header>
    {evidence.components.map(component => <article key={component.subject_id} aria-label={`${component.label} evidence`}>
      <h5>{component.label}</h5><div className="vp-component-columns">
        <div className="vp-component-readings">
          {component.presence.readings.map(item => reading(item, item.value === 'present' ? 'Read as visible' : 'Read as absent in this view'))}
          {component.condition.readings.map(item => reading(item, 'Condition reading'))}
        </div>
        {!!component.purchase_candidates.length && <div className="vp-component-purchases">{component.purchase_candidates.map(item => <div key={item.receipt_item_id}>
          <small>Related receipt · {item.association_basis === 'same_printed_part_number' ? 'matching part number' : 'possible component match'}</small>
          <strong>{item.description}</strong><span>{item.printed_part_number}{item.printed_quantity != null ? ` · Qty ${item.printed_quantity}` : ''}</span>
          {item.amounts_visible && item.documented_amount != null && <span>{amount(item.documented_amount, item.currency)} recorded charge</span>}
          <CatalogProductReference product={item.product} />
          {renderSource({ item_id: item.receipt_item_id, receipt_id: item.receipt_id, relation: 'candidate_material',
            source_table: item.source_table, source_id: item.source_id, source_url_sha256: item.source_url_sha256,
            vendor: null, page_date: item.page_date, description: item.description, part_number: item.printed_part_number,
            quantity: item.printed_quantity, hours: null, amount: item.documented_amount, currency: item.currency,
            amounts_visible: item.amounts_visible, product: item.product })}
        </div>)}</div>}
      </div>
      {!!component.unresolved.length && <p className="vp-component-next">Still to establish: {component.unresolved.map(key => ({
        physical_unit_identity_unestablished: 'exact unit identity', installation_time_unestablished: 'installation date',
        functional_inspection_unestablished: 'functional inspection',
      } as Record<string, string>)[key] || key.replaceAll('_', ' ')).join(' · ')}.</p>}
    </article>)}
    <p className="vp-component-coverage">Photo readings and related purchases are shown separately; a purchase does not yet identify the pictured unit. {evidence.expected_population.status === 'unknown'
      ? 'An applicable build reference is still needed to measure coverage of the whole car.' : ''}
      {evidence.coverage.truncated ? ' More component readings remain beyond this page.' : ''}</p>
  </section>;
}

export function VisualWorkCards({ rows, ledger, components, renderSource }: {
  rows: VisualWork[]; ledger?: MasterCostLedger | null; components?: ComponentEvidence | null;
  renderSource: (line: VisualWork['receipts'][number]) => React.ReactNode;
}) {
  if (ledger?.scenarios.length) {
    const cited = new Set(ledger.scenarios.flatMap(s => s.rows.flatMap(r => r.work_observation_ids)));
    const remaining = rows.filter(work => !cited.has(work.observation_id));
    return <><ComponentSources evidence={components} renderSource={renderSource} /><MasterLedger ledger={ledger} works={rows} renderSource={renderSource} />
      {remaining.length > 0 && <section aria-label="Other photographed work"><h4>Other photographed work</h4>
        <VisualWorkCards rows={remaining} renderSource={renderSource} /></section>}</>;
  }
  if (!rows.length) return <ComponentSources evidence={components} renderSource={renderSource} />;
  return <><ComponentSources evidence={components} renderSource={renderSource} /><div className="vp-visual-work">{rows.map(work => {
    const documentedHours = work.receipts.filter(line => line.relation === 'documented_operation' && line.hours != null);
    const hours = documentedHours.reduce((sum, line) => sum + line.hours!, 0);
    return <article key={work.observation_id} aria-label={work.title}>
      <header><span>Photographed work</span><h4>{work.title}</h4><p>{work.summary}</p></header>
      {work.images.length > 1 && <p className="vp-work-swipe">Swipe through the work photos →</p>}
      <div className="vp-work-photos">{work.images.map(image => <button type="button" key={image.image_id}
        onClick={() => openVehiclePhoto(image.image_id)} aria-label={`Open ${image.role} photo: ${image.caption}`}>
        <img src={optimizeImageUrl(image.image_url, 'medium') || image.image_url} alt={image.caption} loading="lazy" />
        <span><strong>{image.role}</strong><time dateTime={image.taken_at} title={image.capture_time_basis || 'Source time shown in UTC; local zone unrecorded'}>{photoDate(image)}</time></span>
        <small>{image.caption}</small>
      </button>)}</div>
      <dl className="vp-work-lenses">
        <div><dt>Recorded time</dt><dd>{documentedHours.length ? `${hours} documented person-hours` : 'No person-hours in the cited operation lines'}</dd><small>{documentedHours.length ? 'Concurrent technician hours add; they are not elapsed time.' : 'The photo interval does not measure working time.'}</small></div>
        <div><dt>Inferred effort</dt><dd>{work.effort_reference ? `${work.effort_reference.hours_min}–${work.effort_reference.hours_max} reference hours` : 'No matched effort reference'}</dd><small>{work.effort_reference ? `${work.effort_reference.description}. Uncalibrated reference; not measured time.` : 'An estimate needs a matching scope and source.'}</small></div>
        <div><dt>Market value</dt><dd>{work.market_value?.status === 'not_established_by_cited_sources' ? 'Not established by these sources' : 'Not reconciled'}</dd><small>Reference hours alone do not establish a market price.</small></div>
        <div><dt>Paid value</dt><dd>Paid labor {work.paid_labor?.status === 'unreconciled' ? 'not reconciled' : 'not established by these sources'}</dd><small>Receipt charges below remain document amounts.</small></div>
      </dl>
      {work.receipts.length > 0 && <div className="vp-work-materials">{work.receipts.map(line => <div key={line.item_id}>
        <span>{line.relation === 'candidate_material' ? 'Candidate material · installation not established' : 'Work recorded on the document'}</span>
        <strong>{line.description || line.part_number || 'Receipt line'}</strong>
        <small>{[receiptSupplierLabel(line.vendor), line.part_number, line.quantity != null ? `Qty ${line.quantity}` : null, line.page_date ? date(line.page_date) : null].filter(Boolean).join(' · ')}</small>
        {line.amounts_visible ? line.amount != null && <b>{amount(line.amount, line.currency)} · line charge</b> : <small>Amount visible to owner & contributors</small>}
        <CatalogProductReference product={line.product} />
        {renderSource(line)}
      </div>)}</div>}
      {work.receipt_links_unavailable > 0 && <p className="vp-work-note">Some cited receipt lines are no longer available in this read.</p>}
      {work.gaps.length > 0 && <div className="vp-work-open"><strong>Still to reconcile</strong><ul>{work.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    </article>;
  })}</div></>;
}
