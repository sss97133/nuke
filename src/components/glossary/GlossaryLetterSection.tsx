
import { type GlossaryItem } from "./glossaryData";
import { GlossaryItem as GlossaryItemComponent } from "./GlossaryItem";

interface GlossaryLetterSectionProps {
  letter: string;
  items: GlossaryItem[];
}

export const GlossaryLetterSection = ({ letter, items }: GlossaryLetterSectionProps) => {
  return (
    <div className="space-y-2">
      <h2 className="text-2xl font-bold text-primary sticky top-0 bg-background py-1">
        {letter}
      </h2>
      {items.map((item, index) => (
        <GlossaryItemComponent key={index} item={item} />
      ))}
    </div>
  );
};
