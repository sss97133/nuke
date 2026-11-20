import { valueText } from '../../kit';
import type { FacetItem, TokenItems } from '../../kit/types';

const said = (item: FacetItem | undefined) => (item ? item.stated?.trim() || valueText(item.value, item.unit) : null);

/** One plain sentence under the header for a tribute: what the VIN says the car was built as, and what it carries now. Reader values only. */
export function identityLead(items: TokenItems | null | undefined, trim?: string | null): string | null {
  const find = (dimension: string, key: string) => items?.[dimension]?.find(item => item.key === key);
  const decoded = said(find('trim', 'trim.decode'));
  if (!decoded) return null;
  const built = said(find('engine', 'engine.as_built.engine'));
  const now = said(find('engine', 'engine.current.displacement'));
  const engine = built && now ? ` Built with a ${built} engine; it now carries a ${now}, not the original.` : now ? ` It now carries a ${now} engine.` : '';
  return `A tribute, not a factory ${trim?.replace(/\*+$/, '').trim() || 'car of this trim'}: the VIN decodes to ${decoded}.${engine}`;
}
