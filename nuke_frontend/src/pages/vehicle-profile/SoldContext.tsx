import { PrefetchLink as Link } from '../../components/PrefetchLink';
import { sanitizeIdentityToken } from '../../utils/vehicleIdentity';
import type { CompSale, CompScope } from './hooks/useVehicleIntel';

const money = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;
const labelKey = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** Exact recorded labels only. A shared model family does not establish a like-for-like sale. */
export function groupSoldContext(comps: CompSale[], subject: { year?: number | null; make?: string | null; model?: string | null }) {
  const subjectLabel = sanitizeIdentityToken(subject.model, subject);
  const groups = new Map<string, { label: string; sameLabel: boolean; sales: CompSale[] }>();
  for (const sale of comps) {
    if (!Number.isFinite(sale.sale_price) || !(sale.sale_price > 0) || !sale.sale_date || !Number.isFinite(Date.parse(sale.sale_date))) continue;
    const model = sanitizeIdentityToken(sale.model, { year: sale.year, make: subject.make });
    const label = [sale.year, model || 'Model unknown'].filter(Boolean).join(' ');
    const key = labelKey(label);
    const group = groups.get(key) ?? { label, sameLabel: Boolean(subjectLabel && model && sale.year === subject.year && labelKey(model) === labelKey(subjectLabel)), sales: [] };
    group.sales.push(sale);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.sameLabel) - Number(a.sameLabel));
}

export default function SoldContext({ comps, scope, subject, recordedSale }: { comps: CompSale[]; scope?: CompScope | null; subject: { year?: number | null; make?: string | null; model?: string | null }; recordedSale?: number | null }) {
  const groups = groupSoldContext(comps, subject);
  if (!groups.length) return null;
  const different = groups.some(group => !group.sameLabel);
  const matching = groups.filter(group => group.sameLabel).flatMap(group => group.sales).map(sale => sale.sale_price).sort((a, b) => a - b);
  const middle = Math.floor(matching.length / 2);
  const median = matching.length ? matching.length % 2 ? matching[middle] : (matching[middle - 1] + matching[middle]) / 2 : null;
  const difference = recordedSale && Number.isFinite(recordedSale) && median && matching.length >= 2 ? 100 * (recordedSale / median - 1) : null;
  return <details className="vp-sold-context">
    <summary>Sold context <span>{difference !== null
      ? `Latest sale ${difference >= 0 ? '+' : ''}${difference.toFixed(1)}% vs same-label median · ${matching.length} records`
      : groups.some(group => group.sameLabel) ? 'Same model first' : 'Other recorded models'}</span></summary>
    <div className="vp-sold-context__basis" title={scope?.basis ?? undefined}>{scope?.label} · current model labels · condition unmatched</div>
    {different && <p className="vp-sold-context__interpretation">Other variants are excluded from the same-label comparison. This measures recorded prices, not a configuration premium or an appraisal.</p>}
    {groups.map(group => <section key={group.label} className="vp-sold-context__group" aria-label={group.label}>
      <h3>{group.label}{group.sameLabel && <small>Same model label</small>}</h3>
      {group.sales.map(sale => <div className="vp-sold-context__sale" key={sale.id}>
        <Link to={`/vehicle/${sale.id}`} className="vp-sold-context__record" aria-label={`Inspect ${group.label}, sold ${sale.sale_date}`}>
          {sale.thumbnail && <img src={sale.thumbnail} width="40" height="30" alt="" loading="lazy" />}
          <span>{new Date(sale.sale_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
            <small>{sale.mileage != null ? `${sale.mileage.toLocaleString()} mi recorded` : 'Mileage unrecorded'}</small></span>
        </Link>
        <strong>{money(sale.sale_price)}</strong>
        {sale.source_url && /^https?:\/\//i.test(sale.source_url) && <a href={sale.source_url} target="_blank" rel="noreferrer" aria-label={`Sale source for ${group.label}, ${sale.sale_date}`}>↗</a>}
      </div>)}
    </section>)}
    <p className="vp-sold-context__basis">Mileage and model labels are current records. Condition, equipment at sale and sale terms have not been matched.</p>
  </details>;
}
