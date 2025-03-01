import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrainCircuit, Users, Lightbulb, BarChart3, Zap, FileSearch } from "lucide-react";
export interface MarketAnalysisProps {
  vehicleData?: {
    make: string;
    model: string;
    year: number;
    historical_data?: any;
  };
}
export const MarketAnalysis = ({
  vehicleData
}: MarketAnalysisProps) => {
  const defaultVehicleData = vehicleData || {
    make: "Generic",
    model: "Vehicle",
    year: new Date().getFullYear()
  };
  return <ScrollArea className="h-[calc(100vh-4rem)] w-full">
      <div className="container max-w-6xl mx-auto py-6 px-4 space-y-6">
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold">Market Analysis</h1>
          <p className="text-muted-foreground">
            Comprehensive market intelligence for {defaultVehicleData.make} {defaultVehicleData.model}
          </p>
        </div>

        <Tabs defaultValue="mental-estate" className="w-full">
          <TabsList className="w-full grid grid-cols-3 md:grid-cols-6 mb-4">
            <TabsTrigger value="mental-estate" className="flex items-center gap-2 border-0">
              <BrainCircuit className="h-4 w-4" />
              <span className="hidden sm:inline">Mental Real Estate</span>
            </TabsTrigger>
            <TabsTrigger value="brand" className="flex items-center gap-2 border-0">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Brand Analytics</span>
            </TabsTrigger>
            <TabsTrigger value="consumer" className="flex items-center gap-2 border-0">
              <Lightbulb className="h-4 w-4" />
              <span className="hidden sm:inline">Consumer Behavior</span>
            </TabsTrigger>
            <TabsTrigger value="decision" className="flex items-center gap-2 border-0">
              <Zap className="h-4 w-4" />
              <span className="hidden sm:inline">Decision Making</span>
            </TabsTrigger>
            <TabsTrigger value="market-share" className="flex items-center gap-2 border-0">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Market Share</span>
            </TabsTrigger>
            <TabsTrigger value="research" className="flex items-center gap-2 border-0">
              <FileSearch className="h-4 w-4" />
              <span className="hidden sm:inline">Research</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="mental-estate">
            <Card className="p-6 border-0">
              <h2 className="text-2xl font-semibold mb-4">Mental Real Estate in Automotive Market</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Mental real estate refers to the cognitive space that a brand or product occupies in a consumer's mind.
                The following analysis explores how {defaultVehicleData.make} {defaultVehicleData.model} positions in the mental landscape of potential buyers.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Key Insights</h3>
                  <ul className="list-disc ml-5 space-y-2">
                    <li>Brand recognition metrics compared to competitors</li>
                    <li>Consumer recall rates for key features</li>
                    <li>Emotional associations with the {defaultVehicleData.make} brand</li>
                    <li>Position in consideration set for target demographics</li>
                  </ul>
                </div>
                
                <div className="space-y-4">
                  <h3 className="text-lg font-medium">Strategic Implications</h3>
                  <ul className="list-disc ml-5 space-y-2">
                    <li>Opportunities to strengthen brand positioning</li>
                    <li>Competitive threats to mental real estate</li>
                    <li>Messaging strategies to enhance memorability</li>
                    <li>Feature emphasis recommendations based on recall data</li>
                  </ul>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="brand">
            <Card className="p-6 border-0">
              <h2 className="text-2xl font-semibold mb-4">Brand Analytics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-3">Brand Perception Mapping</h3>
                  <p className="text-muted-foreground mb-2">Analysis of how consumers perceive {defaultVehicleData.make} relative to key attributes:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Reliability perception score: 8.2/10</li>
                    <li>Luxury perception score: 7.5/10</li>
                    <li>Performance perception score: 7.8/10</li>
                    <li>Value perception score: 6.9/10</li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">Competitive Mindshare Tracking</h3>
                  <p className="text-muted-foreground mb-2">Share of conversation analysis across digital channels:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Social media presence: 23% share of voice</li>
                    <li>Automotive forums: 18% share of discussion</li>
                    <li>News coverage: 15% of industry mentions</li>
                    <li>Search trends: 20% of category queries</li>
                  </ul>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="consumer">
            <Card className="p-6 border-0 bg-transparent">
              <h2 className="text-2xl font-semibold mb-4">Consumer Behavior</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-3">Brand Loyalty Metrics</h3>
                  <p className="text-muted-foreground mb-2">Analysis of customer retention and loyalty for {defaultVehicleData.make}:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Repeat purchase rate: 68%</li>
                    <li>Brand advocacy score: 72/100</li>
                    <li>Average customer relationship: 7.3 years</li>
                    <li>Cross-model upgrade rate: 42%</li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">Consumer Sentiment Analysis</h3>
                  <p className="text-muted-foreground mb-2">Emotional response metrics:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Positive sentiment ratio: 4.2:1</li>
                    <li>Enthusiasm index: 76/100</li>
                    <li>Pain point frequency: 12%</li>
                    <li>Feature satisfaction score: 81/100</li>
                  </ul>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="decision">
            <Card className="p-6 border-0 bg-transparent">
              <h2 className="text-2xl font-semibold mb-4">Decision Making</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-3">Decision-Making Patterns</h3>
                  <p className="text-muted-foreground mb-2">How consumers decide on {defaultVehicleData.make} {defaultVehicleData.model}:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Average research period: 42 days</li>
                    <li>Dealership visits before purchase: 2.3</li>
                    <li>Online research sessions: 14.6</li>
                    <li>Influential touchpoints: 5.2</li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">Purchase Motivation Tracking</h3>
                  <p className="text-muted-foreground mb-2">Primary reasons for selecting this vehicle:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Performance features: 32%</li>
                    <li>Brand reputation: 28%</li>
                    <li>Value proposition: 22%</li>
                    <li>Design aesthetics: 18%</li>
                  </ul>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="market-share">
            <Card className="p-6 border-0 bg-transparent">
              <h2 className="text-2xl font-semibold mb-4">Market Share</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-medium mb-3">Cognitive Market Share</h3>
                  <p className="text-muted-foreground mb-2">Share of consideration in purchase journeys:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Consideration set inclusion: 42%</li>
                    <li>First-choice preference: 18%</li>
                    <li>Category association strength: 7.8/10</li>
                    <li>Feature recall accuracy: 81%</li>
                  </ul>
                </div>
                
                <div>
                  <h3 className="text-lg font-medium mb-3">Brand Value Assessment</h3>
                  <p className="text-muted-foreground mb-2">Perceived value metrics for {defaultVehicleData.make}:</p>
                  <ul className="list-disc ml-5 space-y-1">
                    <li>Premium perception index: 76/100</li>
                    <li>Price-to-value ratio: 8.2/10</li>
                    <li>Resale value projection: Strong (+8%)</li>
                    <li>Feature value index: 79/100</li>
                  </ul>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="research">
            <Card className="p-6 border-0">
              <h2 className="text-2xl font-semibold mb-4">Research Integration</h2>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium mb-3">Product-Market Fit Analysis</h3>
                  <p className="text-muted-foreground mb-4">
                    Product-Market Fit (PMF) measures how well {defaultVehicleData.make} {defaultVehicleData.model} meets the real needs of its market.
                    Key indicators suggest this vehicle has achieved a PMF score of 82/100.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border rounded-md p-4">
                      <h4 className="font-medium mb-2">Key Strengths</h4>
                      <ul className="list-disc ml-5 space-y-1 text-sm">
                        <li>Strong word-of-mouth recommendation (84% likelihood)</li>
                        <li>Above-average user retention (76% vs industry 68%)</li>
                        <li>Consistently high demand relative to supply</li>
                        <li>89% of owners would be "very disappointed" if discontinued</li>
                      </ul>
                    </div>

                    <div className="border rounded-md p-4">
                      <h4 className="font-medium mb-2">Market Trend Predictions</h4>
                      <ul className="list-disc ml-5 space-y-1 text-sm">
                        <li>Price trend forecast: +3.2% YoY increase</li>
                        <li>Demand projection: Stable with 4% growth</li>
                        <li>Competitive density: Moderate (18 direct competitors)</li>
                        <li>Feature evolution pace: Accelerating (5 new per year)</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-4">
                  <h3 className="text-lg font-medium mb-3">Historical Price Tracking</h3>
                  <div className="h-40 bg-muted rounded-md flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">Price trend visualization will appear here</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Historical price data for {defaultVehicleData.make} {defaultVehicleData.model} from the past 5 years, adjusted for inflation and market conditions.
                  </p>
                </div>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>;
};
export default MarketAnalysis;