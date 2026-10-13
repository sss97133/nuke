/**
 * The evidence block of docs/POSITIONING.md, parsed for the About page.
 *
 * scripts/data/readme-stats.mjs measures the live database every day and rewrites the block between
 * `<!-- evidence:start -->` and `<!-- evidence:end -->`: a preface with the measurement stamp, one table row per
 * graded model and a few measured notes. The About page renders that block instead of carrying numbers of its own,
 * so what a visitor reads is what the daily job measured, with its date. A block the parser cannot read yields null
 * and the page says so; it never falls back to a typed number.
 */

export type EvidenceModel = {
  model: string;
  /** Sold lots graded, of lots ended: the table's second column. */
  graded: number;
  ended: number;
  cells: string[];
};

export type EvidenceNote = { title: string; text: string };

export type Evidence = {
  /** ISO instant of the measurement, from "Measured YYYY-MM-DD HH:MM UTC". */
  measuredAt: string | null;
  preface: string;
  columns: string[];
  models: EvidenceModel[];
  notes: EvidenceNote[];
};

const START = '<!-- evidence:start -->';
const END = '<!-- evidence:end -->';

/** Markdown to plain text: links keep their text, code and emphasis lose their marks. */
export function plain(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const count = (s: string): number => Number(s.replace(/,/g, ''));

export function parseEvidence(markdown: string): Evidence | null {
  const a = markdown.indexOf(START);
  const b = markdown.indexOf(END);
  if (a < 0 || b < 0 || b <= a) return null;
  const lines = markdown.slice(a + START.length, b).split('\n').map(l => l.trim());

  const prefaceLines: string[] = [];
  const tableLines: string[] = [];
  const notes: EvidenceNote[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('|')) tableLines.push(line);
    else if (line.startsWith('- ')) {
      const m = /^- \*\*(.+?):?\*\*:?\s*(.*)$/.exec(line);
      if (m) notes.push({ title: plain(m[1]).replace(/:$/, ''), text: plain(m[2]) });
      else notes.push({ title: '', text: plain(line.slice(2)) });
    } else if (tableLines.length === 0 && notes.length === 0) prefaceLines.push(line);
  }
  const preface = plain(prefaceLines.join(' '));
  const stamp = /^Measured (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC/.exec(preface);
  const measuredAt = stamp ? `${stamp[1]}T${stamp[2]}:00Z` : null;

  const cellsOf = (row: string) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => plain(c));
  const columns = tableLines.length ? cellsOf(tableLines[0]) : [];
  const models: EvidenceModel[] = [];
  for (const row of tableLines.slice(1)) {
    if (/^\|\s*-+/.test(row)) continue;
    const cells = cellsOf(row);
    if (cells.length !== columns.length || cells.length < 2) continue;
    const of = /^([\d,]+) of ([\d,]+)/.exec(cells[1]);
    models.push({ model: cells[0], graded: of ? count(of[1]) : 0, ended: of ? count(of[2]) : 0, cells });
  }
  if (!preface || columns.length === 0 || models.length === 0) return null;
  return { measuredAt, preface, columns, models, notes };
}
