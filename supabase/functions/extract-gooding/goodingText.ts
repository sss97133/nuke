// The prose of a Gooding lot, read from the Gatsby page-data. The lot's narrative is item.description
// (childMarkdownRemark.html); provenance, exhibition and race history and documentation are separate fields. The extractor
// used to read only item.note and the highlight bullets, so the narrative reached the database on 2 of 12 lots sampled on
// 2026-10-15 while every retained capture held it. Pure functions, tested in goodingText.test.ts.

/** Lots not yet written up carry this stock line in item.description; it is not a description. */
const PLACEHOLDER = /will be available closer to the auction/i;

import { htmlToText } from '../_shared/htmlToText.ts';
export { htmlToText };

/** Contentful rich text (document of nodes) to plain text, paragraph per block. */
function richTextToText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  const kids: any[] = Array.isArray(node.content) ? node.content : [];
  const inner = kids.map(richTextToText);
  const block = ['paragraph', 'heading-1', 'heading-2', 'heading-3', 'list-item'].includes(node.nodeType);
  return block ? inner.join('') + '\n' : inner.join('');
}

/** Any of the shapes Gooding's fields take: a string, {childMarkdownRemark:{html}}, {raw} rich text, or a list of those. */
export function fieldText(v: unknown): string | null {
  if (v == null) return null;
  let text = '';
  if (typeof v === 'string') text = htmlToText(v);
  else if (Array.isArray(v)) text = v.map(fieldText).filter(Boolean).join('\n');
  else if (typeof v === 'object') {
    const o = v as Record<string, any>;
    if (typeof o.childMarkdownRemark?.html === 'string') text = htmlToText(o.childMarkdownRemark.html);
    else if (typeof o.raw === 'string') {
      try { text = richTextToText(JSON.parse(o.raw)).replace(/\n{3,}/g, '\n\n').trim(); } catch { text = ''; }
    }
  }
  text = text.trim();
  return text && !PLACEHOLDER.test(text) ? text : null;
}

export interface LotProse {
  narrative: string | null;
  provenance: string | null;
  exhibition: string | null;
  racing: string | null;
  documentation: string | null;
}

export function lotProse(item: Record<string, unknown> | null | undefined): LotProse {
  return {
    narrative: fieldText(item?.description),
    provenance: fieldText(item?.provenance),
    exhibition: fieldText(item?.exhibitionHighlights),
    racing: fieldText(item?.raceHighlights),
    documentation: fieldText(item?.documentation),
  };
}

export const DESCRIPTION_LIMIT = 20000;

/**
 * The full description: the narrative first, then the labelled sections, the collection note, then the highlight
 * bullets. Null only when every source is empty.
 */
export function buildFullDescription(prose: LotProse, note: string | null, highlights: string[]): string | null {
  const parts: string[] = [];
  if (prose.narrative) parts.push(prose.narrative);
  if (prose.provenance) parts.push(`Provenance\n${prose.provenance}`);
  if (prose.exhibition) parts.push(`Exhibition history\n${prose.exhibition}`);
  if (prose.racing) parts.push(`Racing history\n${prose.racing}`);
  if (prose.documentation) parts.push(`Documentation\n${prose.documentation}`);
  const cleanNote = htmlToText(note || '');
  if (cleanNote.length > 20) parts.push(cleanNote);
  const bullets = highlights.map((h) => htmlToText(h)).filter((h) => h.length > 5);
  if (bullets.length > 0) parts.push(bullets.join('\n'));
  return parts.length ? parts.join('\n\n').slice(0, DESCRIPTION_LIMIT) : null;
}
