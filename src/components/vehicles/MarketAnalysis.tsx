import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2 } from "lucide-react";
import { MarketAnalysisProps, Analysis } from "./market-analysis/types";
import { MarketPositionCard } from "./market-analysis/MarketPositionCard";
import { TokenAnalysisCard } from "./market-analysis/TokenAnalysisCard";
import { FeaturesAndFactors } from "./market-analysis/FeaturesAndFactors";
import { DerivativesCard } from "./market-analysis/DerivativesCard";
import { PriceHistoryChart } from "./market-analysis/PriceHistoryChart";
import { InvestmentOutlookCard } from "./market-analysis/InvestmentOutlookCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const MarketAnalysis = ({ vehicleData }: MarketAnalysisProps) => {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Load any existing market analysis data on component mount
  useEffect(() => {
    const loadExistingAnalysis = async () => {
      if (!vehicleData?.id || !supabase) return;
      
      try {
        setInitialLoading(true);
        setError(null);
        
        // First check if this vehicle has any existing market analysis
        const { data, error } = await supabase
          .from('vehicle_market_analysis')
          .select('*')
          .eq('vehicle_id', vehicleData.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
          
        if (error) throw new Error(error.message);
        
        if (data) {
          // Format the existing analysis data
          const formattedAnalysis: Analysis = {
            marketAnalysis: data.market_analysis || '',
            uniqueFeatures: data.unique_features || [],
            valueFactors: data.value_factors || [],
            investmentOutlook: data.investment_outlook || '',
            priceAnalysis: data.price_analysis ? {
              estimatedValue: data.price_analysis.estimated_value || 0,
              confidence: data.price_analysis.confidence || 0,
              trendDirection: data.price_analysis.trend_direction || 'stable',
              comparableSales: data.price_analysis.comparable_sales || []
            } : undefined,
            tokenAnalysis: data.token_analysis ? {
              currentTokenPrice: data.token_analysis.current_token_price || 0,
              tokenVolume24h: data.token_analysis.token_volume_24h || 0,
              marketCap: data.token_analysis.market_cap || 0,
              circulatingSupply: data.token_analysis.circulating_supply || 0,
              derivativesData: data.token_analysis.derivatives_data || []
            } : undefined
          };
          
          setAnalysis(formattedAnalysis);
        }
      } catch (err) {
        console.error('Error loading existing analysis:', err);
        setError(err instanceof Error ? err.message : 'Failed to load existing analysis');
      } finally {
        setInitialLoading(false);
      }
    };
    
    loadExistingAnalysis();
  }, [vehicleData?.id]);

  // Function to request a new market analysis
  const analyzeVehicle = async () => {
    if (!vehicleData?.id || !supabase) {
      toast({
        title: "Analysis Failed",
        description: "Missing vehicle data or database connection.",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // First, fetch comparable vehicle data for price analysis
      const { data: comparableVehicles, error: vehiclesError } = await supabase
        .from('vehicles')
        .select('id, make, model, year, historical_data')
        .eq('make', vehicleData.make)
        .eq('model', vehicleData.model)
        .neq('id', vehicleData.id)
        .order('year', { ascending: false })
        .limit(5);
        
      if (vehiclesError) throw new Error(vehiclesError.message);
      
      // Then get market trends from market_trends table
      const { data: marketTrends, error: trendsError } = await supabase
        .from('market_trends')
        .select('*')
        .eq('make', vehicleData.make)
        .eq('model', vehicleData.model)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
        
      if (trendsError) throw new Error(trendsError.message);
      
      // Generate analysis based on combined data
      // In a production app, this might call an Edge Function or external AI service
      // For now we'll construct a meaningful analysis from available data
      const comparableSales: Array<{ price: number; date: string; notes: string }> = [];
      let estimatedValue = 0;
      let valueSum = 0;
      let valueCount = 0;
      
      // Extract price data from comparable vehicles
      for (const vehicle of comparableVehicles || []) {
        if (vehicle.historical_data?.prices?.length) {
          // Use most recent price
          const latestPrice = vehicle.historical_data.prices.sort((a, b) => 
            new Date(b.date).getTime() - new Date(a.date).getTime()
          )[0];
          
          comparableSales.push({
            price: latestPrice.price,
            date: latestPrice.date,
            notes: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
          });
          
          valueSum += latestPrice.price;
          valueCount++;
        }
      }
      
      // Calculate estimated value based on comparable sales
      if (valueCount > 0) {
        estimatedValue = Math.round(valueSum / valueCount);
      } else if (vehicleData.historical_data?.prices?.length) {
        // Fall back to this vehicle's own price history
        estimatedValue = vehicleData.historical_data.prices.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        )[0].price;
      }
      
      // Determine value factors and trend direction
      const yearDiff = new Date().getFullYear() - vehicleData.year;
      const isVintage = yearDiff > 25;
      const isModern = yearDiff < 5;
      
      const uniqueFeatures: string[] = [];
      if (isVintage) uniqueFeatures.push('Vintage/Classic Status');
      if (isModern) uniqueFeatures.push('Modern Features');
      if (marketTrends?.demand_score > 7) uniqueFeatures.push('High Market Demand');
      
      const valueFactors: string[] = [];
      if (yearDiff > 50) valueFactors.push('Historical Significance');
      if (marketTrends?.rarity_score > 7) valueFactors.push('Rarity');
      if (marketTrends?.condition_importance > 7) valueFactors.push('Condition');
      if (marketTrends?.originality_importance > 7) valueFactors.push('Originality');
      
      // Generate trend direction
      let trendDirection = 'stable';
      if (marketTrends?.price_trend > 0.05) trendDirection = 'up';
      if (marketTrends?.price_trend < -0.05) trendDirection = 'down';
      
      // Create the analysis object
      const newAnalysis: Analysis = {
        marketAnalysis: `This ${vehicleData.year} ${vehicleData.make} ${vehicleData.model} ${marketTrends?.market_summary || 'shows typical market performance for its category'}. ${isVintage ? 'Its vintage status contributes significantly to its value.' : ''} ${isModern ? 'Modern features and technology contribute to its appeal.' : ''} ${marketTrends?.demand_score > 7 ? 'Current market demand for this model is strong.' : ''}`,
        uniqueFeatures: uniqueFeatures,
        valueFactors: valueFactors,
        investmentOutlook: marketTrends?.investment_outlook || `This vehicle ${trendDirection === 'up' ? 'shows potential for appreciation' : trendDirection === 'down' ? 'may face depreciation challenges' : 'is likely to maintain stable value'}. Consider ${isVintage ? 'its historical importance and rarity' : 'market trends and condition'} when evaluating long-term value.`,
        priceAnalysis: {
          estimatedValue,
          confidence: comparableSales.length > 2 ? 85 : comparableSales.length > 0 ? 70 : 50,
          trendDirection,
          comparableSales
        }
      };
      
      // If token analysis is enabled for this vehicle
      if (vehicleData.historical_data?.token_data) {
        newAnalysis.tokenAnalysis = {
          currentTokenPrice: vehicleData.historical_data.token_data.current_price || 0,
          tokenVolume24h: vehicleData.historical_data.token_data.volume_24h || 0,
          marketCap: vehicleData.historical_data.token_data.market_cap || 0,
          circulatingSupply: vehicleData.historical_data.token_data.circulating_supply || 0,
          derivativesData: vehicleData.historical_data.token_data.derivatives || []
        };
      }
      
      // Save the analysis to the database
      const { error: saveError } = await supabase
        .from('vehicle_market_analysis')
        .insert({
          vehicle_id: vehicleData.id,
          market_analysis: newAnalysis.marketAnalysis,
          unique_features: newAnalysis.uniqueFeatures,
          value_factors: newAnalysis.valueFactors,
          investment_outlook: newAnalysis.investmentOutlook,
          price_analysis: newAnalysis.priceAnalysis,
          token_analysis: newAnalysis.tokenAnalysis
        });
        
      if (saveError) throw new Error(saveError.message);

      setAnalysis(newAnalysis);
      toast({
        title: "Analysis Complete",
        description: "Market analysis has been updated with the latest data.",
      });
    } catch (err) {
      console.error("Error analyzing vehicle:", err);
      setError(err instanceof Error ? err.message : 'Unknown error during analysis');
      toast({
        title: "Analysis Failed",
        description: err instanceof Error ? err.message : "Unable to complete market analysis. Please try again.",
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
          disabled={loading || initialLoading}
          className="font-mono text-sm"
        >
          {(loading || initialLoading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {loading ? "Analyzing..." : initialLoading ? "Loading..." : "Analyze Market"}
        </Button>
      </div>
      
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {initialLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : analysis ? (
        <div className="grid gap-6">
          <MarketPositionCard marketAnalysis={analysis.marketAnalysis} />

          {analysis.tokenAnalysis && (
            <TokenAnalysisCard tokenAnalysis={analysis.tokenAnalysis} />
          )}

          <FeaturesAndFactors
            uniqueFeatures={analysis.uniqueFeatures}
            valueFactors={analysis.valueFactors}
          />

          {analysis.tokenAnalysis?.derivativesData && analysis.tokenAnalysis.derivativesData.length > 0 && (
            <DerivativesCard
              analysis={{
                tokenPrice: analysis.tokenAnalysis.currentTokenPrice || analysis.tokenAnalysis.derivativesData[0]?.price || 0,
                marketCap: analysis.tokenAnalysis.marketCap || analysis.tokenAnalysis.derivativesData.reduce((acc, curr) => acc + curr.price, 0),
                volume24h: analysis.tokenAnalysis.tokenVolume24h || 0,
                holders: analysis.tokenAnalysis.circulatingSupply 
                  ? Math.floor(analysis.tokenAnalysis.circulatingSupply / 1000) 
                  : analysis.tokenAnalysis.derivativesData.length
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
      ) : (
        <div className="p-6 border rounded-md bg-muted/20">
          <p className="text-center text-muted-foreground">No market analysis available. Click "Analyze Market" to generate insights.</p>
        </div>
      )}
    </div>
  );
};
