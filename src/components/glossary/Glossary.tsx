
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { glossaryItems, groupByFirstLetter } from "./glossaryData";
import { GlossaryLetterSection } from "./GlossaryLetterSection";

export const Glossary = () => {
  const groupedItems = groupByFirstLetter(glossaryItems);
  const letters = Object.keys(groupedItems).sort();

  return (
    <div className="container mx-auto py-4 max-w-4xl">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl">Automotive Glossary</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[70vh]">
            <div className="space-y-4">
              {letters.map((letter) => (
                <GlossaryLetterSection
                  key={letter}
                  letter={letter}
                  items={groupedItems[letter]}
                />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
