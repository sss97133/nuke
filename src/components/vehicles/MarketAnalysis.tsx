import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { MarketAnalysisProps, Analysis } from "./market-analysis/types";
import { MarketPositionCard } from "./market-analysis/MarketPositionCard";
import { TokenAnalysisCard } from "./market-analysis/TokenAnalysisCard";
import { FeaturesAndFactors } from "./market-analysis/FeaturesAndFactors";
import { DerivativesCard } from "./market-analysis/DerivativesCard";
import { PriceHistoryChart } from "./market-analysis/PriceHistoryChart";
import { InvestmentOutlookCard } from "./market-analysis/InvestmentOutlookCard";

export const MarketAnalysis = ({ vehicleData }: MarketAnalysisProps) => {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const analyzeVehicle = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "analyze-vehicle-data",
        {
          body: { vehicleData },
        }
      );

      if (error) {
        console.error("Database query error:", error);
        throw error;
      }

      setAnalysis(data);
      toast({
        title: "Analysis Complete",
        description: "Market analysis has been updated with the latest data.",
      });
    } catch (error) {
      console.error("Error analyzing vehicle:", error);
      toast({
        title: "Analysis Failed",
        description: "Unable to complete market analysis. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const chartData = analysis?.priceAnalysis?.comparableSales?.map((sale) => ({
    date: new Date(sale.date).toLocaleDateString(),
    price: sale.price,
    notes: sale.notes,
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-mono text-sm text-[#666]">Market Analysis</h3>
        <Button
          onClick={analyzeVehicle}
          disabled={loading}
          className="font-mono text-sm"
        >
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? "Analyzing..." : "Analyze Market"}
        </Button>
      </div>

      {analysis && (
        <div className="grid gap-6">
          <MarketPositionCard marketAnalysis={analysis.marketAnalysis} />

          {analysis.tokenAnalysis && (
            <TokenAnalysisCard tokenAnalysis={analysis.tokenAnalysis} />
          )}

          <FeaturesAndFactors
            uniqueFeatures={analysis.uniqueFeatures}
            valueFactors={analysis.valueFactors}
          />

          {analysis.tokenAnalysis?.derivativesData && (
            <DerivativesCard
              analysis={{
                tokenPrice: analysis.tokenAnalysis.derivativesData[0]?.price || 0,
                marketCap: analysis.tokenAnalysis.derivativesData.reduce((acc, curr) => acc + curr.price, 0),
                volume24h: analysis.tokenAnalysis.derivativesData.reduce((acc, curr) => acc + curr.price, 0),
                holders: analysis.tokenAnalysis.derivativesData.length
              }}
            />
          )}

          {chartData && chartData.length > 0 && (
            <PriceHistoryChart chartData={chartData} />
          )}

          <InvestmentOutlookCard
            investmentOutlook={analysis.investmentOutlook}
            priceAnalysis={analysis.priceAnalysis}
          />
        </div>
      )}
    </div>
  );
};
