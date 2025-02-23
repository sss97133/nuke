
import { type GlossaryItem as GlossaryItemType } from "./glossaryData";

interface GlossaryItemProps {
  item: GlossaryItemType;
}

export const GlossaryItem = ({ item }: GlossaryItemProps) => {
  return (
    <div className="border-b border-border pb-2 last:border-0">
      <h3 className="text-base font-medium">{item.term}</h3>
      <p className="text-sm text-muted-foreground">{item.definition}</p>
    </div>
  );
};

