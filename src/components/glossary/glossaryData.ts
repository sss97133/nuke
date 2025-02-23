
import { GlossaryItem } from './data/types';
import { automotiveTerms } from './data/automotive-terms';
import { businessTerms } from './data/business-terms';
import { techTerms } from './data/tech-terms';
import { developmentTerms } from './data/development-terms';
import { sustainabilityTerms } from './data/sustainability-terms';

export type { GlossaryItem };

export const glossaryItems: GlossaryItem[] = [
  ...automotiveTerms,
  ...businessTerms,
  ...techTerms,
  ...developmentTerms,
  ...sustainabilityTerms
].sort((a, b) => a.term.localeCompare(b.term));

export const groupByFirstLetter = (items: GlossaryItem[]) => {
  return items.reduce((acc, item) => {
    const firstLetter = item.term[0].toUpperCase();
    if (!acc[firstLetter]) {
      acc[firstLetter] = [];
    }
    acc[firstLetter].push(item);
    return acc;
  }, {} as Record<string, GlossaryItem[]>);
};

