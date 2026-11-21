import type { FacetItem, FacetItemSource } from '../../../kit/types';

/** The same record-field to token owner used by the structured dossier. */
export const FIELD_TOKEN: Record<string, string> = {
  year: 'year', make: 'make', model: 'model', trim: 'trim', body_style: 'body_style',
  engine_type: 'engine', engine_size: 'engine', engine_configuration: 'engine',
  engine_displacement_l: 'engine', engine_code: 'engine',
  transmission: 'transmission', transmission_model: 'transmission', transmission_code: 'transmission',
  rear_axle_ratio: 'transmission', tire_spec_rear: 'transmission', drivetrain: 'drivetrain',
  color: 'paint', location: 'location',
};

export type FacetImageCitation = {
  imageId: string; itemKey: string; facet: FacetItem['facet']; status: FacetItem['status'];
  relation: 'source' | 'conflict_side' | 'examined' | 'availability';
  sideValue?: unknown; source: FacetItemSource;
};

const imageSource = (value: unknown): value is FacetItemSource & { witness: { kind: 'image'; id: string } } => {
  if (!value || typeof value !== 'object') return false;
  const witness = (value as FacetItemSource).witness;
  return !!witness && witness.kind === 'image' && typeof witness.id === 'string'
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(witness.id);
};

/** Keep conflicting and examined testimony attached to its own item and side. */
export function facetImageCitations(items: FacetItem[]): FacetImageCitation[] {
  const out: FacetImageCitation[] = [];
  for (const item of items) {
    const add = (source: unknown, relation: FacetImageCitation['relation'], sideValue?: unknown) => {
      if (imageSource(source)) out.push({ imageId: source.witness.id, itemKey: item.key,
        facet: item.facet, status: item.status, relation, sideValue, source });
    };
    item.sources?.forEach(source => add(source, 'source'));
    item.sides?.forEach(side => side.sources?.forEach(source => add(source, 'conflict_side', side.value)));
    // Examined/availability rows are optional reader extensions. Only an
    // explicit typed image witness can enter this path; URLs and raw image_id
    // fields never become citations.
    for (const [relation, rows] of [['examined', item.examined], ['availability', item.availability]] as const) {
      rows?.forEach(row => {
        add(row, relation);
        if (row && typeof row === 'object') {
          const record = row as { source?: unknown; sources?: unknown[] };
          add(record.source, relation);
          record.sources?.forEach(source => add(source, relation));
        }
      });
    }
  }
  return out;
}
