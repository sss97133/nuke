
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const algorithmDocs = [
  {
    name: "Feed Relevance",
    description: "Algorithm used to determine the relevance of feed items",
    formula: "Relevance = Base Score × Engagement Score × Content Weight × Technical Level Match × Time Decay × Geographic Relevance",
    components: [
      "Base Score: Initial relevance score",
      "Engagement Score: Based on user interactions",
      "Content Weight: Weight based on content type",
      "Technical Level Match: Compatibility with user's technical level",
      "Time Decay: Freshness factor",
      "Geographic Relevance: Location-based relevance"
    ]
  },
  {
    name: "Skill Interaction",
    description: "Calculates the interaction strength between different skills",
    formula: "Interaction = e^-(Level Difference + XP Correlation)",
    components: [
      "Level Difference: Absolute difference between skill levels",
      "XP Correlation: Normalized difference in experience points",
      "Exponential Decay: Ensures smooth interaction falloff"
    ]
  },
  {
    name: "Career Momentum",
    description: "Calculates professional growth momentum based on skills",
    formula: "Momentum = (Total XP / (10000 × Skill Count)) × 0.002 + Wave Factor",
    components: [
      "Total XP: Sum of all skill experience points",
      "Skill Count: Number of tracked skills",
      "Wave Factor: Periodic fluctuation for dynamic visualization",
      "Base Speed: Core progression rate"
    ]
  },
  {
    name: "Vehicle Probability Search",
    description: "Determines the likelihood of finding specific vehicles in an area",
    formula: "Complex geospatial analysis combining multiple factors",
    components: [
      "Geographic Bounds: Search area coordinates",
      "Historical Data: Past vehicle locations and movements",
      "Market Factors: Local market conditions and trends",
      "Time-based Patterns: Seasonal and temporal variations"
    ]
  },
  {
    name: "DAO Governance Weight",
    description: "Calculates voting power in governance decisions",
    formula: "Voting Weight = Token Holdings × Time Lock Multiplier × Participation Factor",
    components: [
      "Token Holdings: Number of governance tokens held",
      "Time Lock: Duration tokens are locked for voting",
      "Participation: Historical governance participation",
      "Reputation Factor: Community standing score"
    ]
  }
];

export const Algorithms = () => {
  return (
    <div className="container mx-auto py-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold">System Algorithms</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[70vh] pr-4">
            <div className="space-y-6">
              <p className="text-muted-foreground mb-6">
                This documentation describes the key algorithms that power various features of the system.
                Each algorithm is designed to optimize specific aspects of the platform&apos;s functionality.
              </p>
              
              <Accordion type="single" collapsible className="space-y-4">
                {algorithmDocs.map((algo, index) => (
                  <AccordionItem key={index} value={`algo-${index}`} className="border rounded-lg px-4">
                    <AccordionTrigger className="text-lg font-semibold py-4">
                      {algo.name}
                    </AccordionTrigger>
                    <AccordionContent className="pb-4 space-y-4">
                      <p className="text-muted-foreground">{algo.description}</p>
                      <div className="bg-muted p-3 rounded-md">
                        <p className="font-mono text-sm">{algo.formula}</p>
                      </div>
                      <div className="space-y-2">
                        <p className="font-medium">Components:</p>
                        <ul className="list-disc pl-5 space-y-1">
                          {algo.components.map((component, idx) => (
                            <li key={idx} className="text-muted-foreground">{component}</li>
                          ))}
                        </ul>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
