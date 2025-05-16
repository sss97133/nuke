
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { glossaryItems, groupByFirstLetter } from "./glossaryData";
import { GlossaryLetterSection } from "./GlossaryLetterSection";

type Category = "all" | "automotive" | "business" | "tech" | "development" | "sustainability";

export const Glossary = () => {
  const [selectedCategory, setSelectedCategory] = useState<Category>("all");

  const filteredItems = glossaryItems.filter((item) => {
    if (selectedCategory === "all") return true;
    
    // Check the item's category based on its definition being in the respective array
    const categoryMapping = {
      automotive: item.definition.includes("vehicle") || item.definition.includes("automotive"),
      business: item.definition.includes("business") || item.definition.includes("management"),
      tech: item.definition.includes("digital") || item.definition.includes("technology"),
      development: item.definition.includes("code") || item.definition.includes("software"),
      sustainability: item.definition.includes("environmental") || item.definition.includes("sustainable")
    };
    
    return categoryMapping[selectedCategory as keyof typeof categoryMapping];
  });

  const groupedItems = groupByFirstLetter(filteredItems);
  const letters = Object.keys(groupedItems).sort();

  return (
    <div className="container mx-auto py-4 max-w-4xl">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl">Automotive Glossary</CardTitle>
            <Select value={selectedCategory} onValueChange={(value: Category) => setSelectedCategory(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="automotive">Automotive</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="tech">Technology</SelectItem>
                <SelectItem value="development">Development</SelectItem>
                <SelectItem value="sustainability">Sustainability</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {filteredItems.length} terms {selectedCategory !== "all" && `in ${selectedCategory}`}
          </div>
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
