
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const glossaryItems = [
  {
    term: "VIN Scanner",
    definition: "A tool that scans and decodes Vehicle Identification Numbers, providing detailed vehicle information."
  },
  {
    term: "Market Analysis",
    definition: "Tool for analyzing current market trends, prices, and demand for vehicles in specific regions."
  },
  {
    term: "Professional Dashboard",
    definition: "Central control panel for managing professional automotive operations and tracking business metrics."
  },
  {
    term: "Service Management",
    definition: "System for tracking and managing vehicle service records, maintenance schedules, and repair histories."
  },
  {
    term: "Inventory Management",
    definition: "Tools for tracking vehicle inventory, parts, and equipment across locations."
  },
  {
    term: "Studio Workspace",
    definition: "Professional environment for capturing and editing vehicle media content."
  },
  {
    term: "Skills Management",
    definition: "System for tracking and developing professional automotive skills and certifications."
  },
  {
    term: "Mental Real Estate",
    definition: "The space a brand or product occupies in consumers' minds, affecting their perception and decision-making."
  },
  {
    term: "Product-Market Fit",
    definition: "A condition where a product satisfies a strong market demand, indicated by rapid organic growth, high user retention, and strong word-of-mouth referrals. Term popularized by Marc Andreessen, defining the moment when a product meets the real needs of a market segment so well that growth becomes inevitable."
  }
];

export const Glossary = () => {
  return (
    <div className="container mx-auto py-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Glossary</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[70vh] pr-4">
            <div className="space-y-6">
              {glossaryItems.map((item, index) => (
                <div key={index} className="border-b border-border pb-4 last:border-0">
                  <h3 className="text-lg font-semibold mb-2">{item.term}</h3>
                  <p className="text-muted-foreground">{item.definition}</p>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};

