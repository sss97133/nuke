// RM Sotheby's lot title -> year / make / model. Moved out of index.ts unchanged so lotKind.ts' gate and the
// write path can be tested against each other (lotKind.test.ts): a lot the gate lets through must land with both set.

// Parse title like "1997 Ferrari F310 B" into year/make/model
export function parseTitle(title: string): { year: number | null; make: string | null; model: string | null } {
  const yearMatch = title.match(/^(\d{4})\s+/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) {
    // Try to find year anywhere
    const anyYear = title.match(/\b(19|20)\d{2}\b/);
    if (anyYear) {
      const y = parseInt(anyYear[0], 10);
      const afterYear = title.slice(title.indexOf(anyYear[0]) + 4).trim();
      const parts = afterYear.split(/\s+/);
      return {
        year: y,
        make: parts[0]?.toLowerCase() || null,
        model: parts.slice(1).join(' ')?.toLowerCase() || null,
      };
    }
    return { year: null, make: null, model: null };
  }

  const afterYear = title.slice(4).trim();
  const parts = afterYear.split(/\s+/);
  const make = parts[0]?.toLowerCase() || null;
  const model = parts.slice(1).join(' ')?.toLowerCase() || null;

  return { year, make, model };
}
