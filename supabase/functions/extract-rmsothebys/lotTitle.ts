// RM Sotheby's lot title -> year / make / model. Moved out of index.ts unchanged so lotKind.ts' gate and the
// write path can be tested against each other (lotKind.test.ts): a lot the gate lets through must land with both set.

const TWO_WORD_MAKES = new Set([
  'alfa romeo',
  'american lafrance',
  'american motors',
  'aston martin',
  'austin healey',
  'de soto',
  'de tomaso',
  'facel vega',
  'hispano suiza',
  'international harvester',
  'isotta fraschini',
  'land rover',
  'mercedes benz',
  'pierce arrow',
  'range rover',
  'rolls royce',
  'shelby american',
  'talbot lago',
]);

function splitMakeAndModel(afterYear: string): { make: string | null; model: string | null } {
  const parts = afterYear.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { make: null, model: null };
  if (parts.length >= 2) {
    const firstTwo = `${parts[0]} ${parts[1]}`.toLowerCase();
    if (TWO_WORD_MAKES.has(firstTwo)) {
      return {
        make: firstTwo,
        model: parts.slice(2).join(' ').toLowerCase() || null,
      };
    }
  }
  return {
    make: parts[0]?.toLowerCase() || null,
    model: parts.slice(1).join(' ')?.toLowerCase() || null,
  };
}

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
      const { make, model } = splitMakeAndModel(afterYear);
      return { year: y, make, model };
    }
    return { year: null, make: null, model: null };
  }

  const afterYear = title.slice(4).trim();
  const { make, model } = splitMakeAndModel(afterYear);

  return { year, make, model };
}
