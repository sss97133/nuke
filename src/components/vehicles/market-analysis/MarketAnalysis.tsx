
import React from "react";
import { Analysis, MarketAnalysisProps } from "./types";
import { MarketPositionCard } from "./MarketPositionCard";
import { FeaturesAndFactors } from "./FeaturesAndFactors";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { InvestmentOutlookCard } from "./InvestmentOutlookCard";
import { TokenAnalysisCard } from "./TokenAnalysisCard";
import { DerivativesCard } from "./DerivativesCard";
import { Card } from "@/components/ui/card";

export const MarketAnalysis = ({ vehicleData }: MarketAnalysisProps) => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);

  React.useEffect(() => {
    const fetchMarketAnalysis = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // In a production environment, this would be a call to your backend
        // For now, we're simulating this with sample data
        const mockAnalysis: Analysis = {
          marketAnalysis: `${vehicleData.make} ${vehicleData.model} (${vehicleData.year}) currently holds a strong position in the automotive market with high brand recognition and steady demand. Market penetration analysis indicates a 7.2% share in its segment, with particular strength in urban markets and sustainability-focused consumer groups.`,
          uniqueFeatures: [
            "Brand recognition and established market presence",
            "Design language that appeals to target demographic",
            "Strong aftermarket and customization support",
            "Historical significance in automotive development",
            "Cultural impact and representation in media"
          ],
          valueFactors: [
            "Limited production numbers increase collectibility",
            "Original documentation and service history",
            "Unmodified factory specifications",
            "Historical price appreciation pattern",
            "Market trend alignment with current buyer preferences"
          ],
          investmentOutlook: `The ${vehicleData.make} ${vehicleData.model} shows positive investment potential with an estimated annual appreciation of 4-7% over the next five years. Cognitive market share analysis suggests increasing mindshare among collectors and enthusiasts, particularly in the 30-45 age demographic.`,
          priceAnalysis: {
            estimatedValue: 32500,
            confidence: 0.87,
            trendDirection: "up",
            comparableSales: [
              { price: 29800, date: "2023-06-15", notes: "Similar condition, higher mileage" },
              { price: 34200, date: "2023-04-22", notes: "Excellent condition, original parts" },
              { price: 31500, date: "2023-08-30", notes: "Standard specification" }
            ]
          },
          tokenAnalysis: {
            currentTokenPrice: 12.58,
            tokenVolume24h: 156000,
            marketCap: 12580000,
            circulatingSupply: 1000000,
            derivativesData: [
              { type: "Futures Contract", price: 13.25, expirationDate: "2023-12-15" },
              { type: "Call Option", price: 2.35, expirationDate: "2023-11-30" },
              { type: "Put Option", price: 1.85, expirationDate: "2023-11-30" }
            ]
          }
        };

        // Add some simulated chart data
        const chartData = [
          { date: "2022-01", price: 27500 },
          { date: "2022-04", price: 28200 },
          { date: "2022-07", price: 29000 },
          { date: "2022-10", price: 29800 },
          { date: "2023-01", price: 30500 },
          { date: "2023-04", price: 31200 },
          { date: "2023-07", price: 32100 },
          { date: "2023-10", price: 32500 }
        ];

        // Simulate API delay
        setTimeout(() => {
          setAnalysis(mockAnalysis);
          setLoading(false);
        }, 1000);
      } catch (err) {
        console.error("Error fetching market analysis:", err);
        setError("Failed to load market analysis data. Please try again.");
        setLoading(false);
      }
    };

    fetchMarketAnalysis();
  }, [vehicleData]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="p-6">
          <div className="h-6 w-2/3 bg-gray-200 animate-pulse rounded"></div>
          <div className="h-24 w-full bg-gray-200 animate-pulse rounded mt-4"></div>
        </Card>
        <div className="grid md:grid-cols-2 gap-6">
          <Card className="p-6">
            <div className="h-6 w-1/2 bg-gray-200 animate-pulse rounded"></div>
            <div className="space-y-2 mt-4">
              <div className="h-4 w-full bg-gray-200 animate-pulse rounded"></div>
              <div className="h-4 w-full bg-gray-200 animate-pulse rounded"></div>
              <div className="h-4 w-3/4 bg-gray-200 animate-pulse rounded"></div>
            </div>
          </Card>
          <Card className="p-6">
            <div className="h-6 w-1/2 bg-gray-200 animate-pulse rounded"></div>
            <div className="space-y-2 mt-4">
              <div className="h-4 w-full bg-gray-200 animate-pulse rounded"></div>
              <div className="h-4 w-full bg-gray-200 animate-pulse rounded"></div>
              <div className="h-4 w-3/4 bg-gray-200 animate-pulse rounded"></div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-red-200 bg-red-50">
        <div className="text-red-600">
          <h3 className="text-lg font-semibold">Error Loading Analysis</h3>
          <p>{error}</p>
        </div>
      </Card>
    );
  }

  if (!analysis) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 grid-cols-1">
        <MarketPositionCard marketAnalysis={analysis.marketAnalysis} />
        
        <FeaturesAndFactors 
          uniqueFeatures={analysis.uniqueFeatures} 
          valueFactors={analysis.valueFactors} 
        />
        
        <PriceHistoryChart chartData={analysis.priceAnalysis.comparableSales} />
        
        <InvestmentOutlookCard 
          investmentOutlook={analysis.investmentOutlook} 
          priceAnalysis={analysis.priceAnalysis} 
        />
        
        {analysis.tokenAnalysis && (
          <>
            <TokenAnalysisCard tokenAnalysis={analysis.tokenAnalysis} />
            <DerivativesCard derivativesData={analysis.tokenAnalysis.derivativesData} />
          </>
        )}
        
        <Card className="p-6">
          <h3 className="font-mono text-lg font-semibold mb-4">Data Science Goals</h3>
          <div className="space-y-4">
            <div>
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Mental Real Estate Analysis</h4>
              <p className="font-mono text-sm text-[#283845]">
                Track and analyze brand perception, consumer mindshare, and market positioning to identify 
                opportunities for value appreciation and market trends before they materialize in price action.
              </p>
            </div>
            
            <div>
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Consumer Behavior Tracking</h4>
              <p className="font-mono text-sm text-[#283845]">
                Implement advanced sentiment analysis and brand loyalty metrics to predict market movements
                and identify emerging collector interests across different vehicle segments.
              </p>
            </div>
            
            <div>
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Decision-Making Pattern Recognition</h4>
              <p className="font-mono text-sm text-[#283845]">
                Develop AI models that can recognize patterns in consumer decision-making, purchase motivation,
                and brand association to predict future market behavior with increasing accuracy.
              </p>
            </div>
            
            <div>
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Market Share Projection</h4>
              <p className="font-mono text-sm text-[#283845]">
                Create cognitive market share models that track emotional connections and brand value 
                to predict how vehicles will appreciate or depreciate based on psychological factors.
              </p>
            </div>
            
            <div>
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Deep Research Integration</h4>
              <p className="font-mono text-sm text-[#283845]">
                Integrate historical price data, comparable sales analysis, and market trends to generate
                investment outlooks with confidence scores and probabilistic forecasting.
              </p>
            </div>
            
            <div>
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Token Economy Development</h4>
              <p className="font-mono text-sm text-[#283845]">
                Build sophisticated models for tokenized vehicle assets, including derivatives pricing,
                market liquidity prediction, and volatility analysis for automotive securities.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
