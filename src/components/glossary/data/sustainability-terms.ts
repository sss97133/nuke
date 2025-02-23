
import { GlossaryItem } from './types';

export const sustainabilityTerms: GlossaryItem[] = [
  {
    term: "Carbon Footprint",
    definition: "Measure of environmental impact from vehicle production and operation in terms of CO2 emissions."
  }
].sort((a, b) => a.term.localeCompare(b.term));

