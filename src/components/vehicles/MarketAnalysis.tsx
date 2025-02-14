
import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Award, DollarSign, Wallet, CandlestickChart } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface MarketAnalysisProps {
  vehicleData: {
    make: string;
    model: string;
    year: number;
    historical_data?: any;
  };
}

interface TokenAnalysis {
  currentTokenPrice: number;
  tokenVolume24h: number;
  marketCap: number;
  circulatingSupply: number;
  derivativesData: Array<{
    type: string;
    price: number;
    expirationDate: string;
  }>;
}

interface Analysis {
  marketAnalysis: string;
  uniqueFeatures: string[];
  valueFactors: string[];
  investmentOutlook: string;
  priceAnalysis: {
    estimatedValue: number;
    confidence: number;
    trendDirection: "up" | "down" | "stable";
    comparableSales: Array<{ price: number; date: string; notes: string }>;
  };
  tokenAnalysis?: TokenAnalysis;
}

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

      if (error) throw error;

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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);

  const chartData = analysis?.priceAnalysis.comparableSales.map((sale) => ({
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
          <Card className="p-6">
            <div className="flex items-start gap-4">
              <TrendingUp className="h-5 w-5 text-[#283845] mt-1" />
              <div>
                <h4 className="font-mono text-sm font-semibold mb-2">
                  Market Position
                </h4>
                <p className="font-mono text-sm text-[#283845]">
                  {analysis.marketAnalysis}
                </p>
              </div>
            </div>
          </Card>

          {analysis.tokenAnalysis && (
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <Wallet className="h-5 w-5 text-[#283845] mt-1" />
                <div className="w-full">
                  <h4 className="font-mono text-sm font-semibold mb-4">
                    Token Analysis
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="font-mono text-sm text-[#666]">
                        Current Token Price:
                      </span>
                      <p className="font-mono text-lg font-semibold">
                        {formatCurrency(analysis.tokenAnalysis.currentTokenPrice)}
                      </p>
                    </div>
                    <div>
                      <span className="font-mono text-sm text-[#666]">
                        24h Volume:
                      </span>
                      <p className="font-mono text-lg font-semibold">
                        {formatCurrency(analysis.tokenAnalysis.tokenVolume24h)}
                      </p>
                    </div>
                    <div>
                      <span className="font-mono text-sm text-[#666]">
                        Market Cap:
                      </span>
                      <p className="font-mono text-lg font-semibold">
                        {formatCurrency(analysis.tokenAnalysis.marketCap)}
                      </p>
                    </div>
                    <div>
                      <span className="font-mono text-sm text-[#666]">
                        Circulating Supply:
                      </span>
                      <p className="font-mono text-lg font-semibold">
                        {analysis.tokenAnalysis.circulatingSupply.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <Award className="h-5 w-5 text-[#283845] mt-1" />
                <div>
                  <h4 className="font-mono text-sm font-semibold mb-2">
                    Unique Features
                  </h4>
                  <ul className="space-y-2">
                    {analysis.uniqueFeatures.map((feature, index) => (
                      <li
                        key={index}
                        className="font-mono text-sm text-[#283845]"
                      >
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-start gap-4">
                <DollarSign className="h-5 w-5 text-[#283845] mt-1" />
                <div>
                  <h4 className="font-mono text-sm font-semibold mb-2">
                    Value Factors
                  </h4>
                  <ul className="space-y-2">
                    {analysis.valueFactors.map((factor, index) => (
                      <li
                        key={index}
                        className="font-mono text-sm text-[#283845]"
                      >
                        {factor}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          </div>

          {analysis.tokenAnalysis?.derivativesData && (
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <CandlestickChart className="h-5 w-5 text-[#283845] mt-1" />
                <div className="w-full">
                  <h4 className="font-mono text-sm font-semibold mb-4">
                    Derivatives Market
                  </h4>
                  <div className="divide-y">
                    {analysis.tokenAnalysis.derivativesData.map((derivative, index) => (
                      <div
                        key={index}
                        className="py-3 grid grid-cols-3 gap-4"
                      >
                        <div className="font-mono text-sm">
                          {derivative.type}
                        </div>
                        <div className="font-mono text-sm">
                          {formatCurrency(derivative.price)}
                        </div>
                        <div className="font-mono text-sm text-[#666]">
                          Expires: {new Date(derivative.expirationDate).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {chartData && chartData.length > 0 && (
            <Card className="p-6">
              <h4 className="font-mono text-sm font-semibold mb-4">
                Price History
              </h4>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => value}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => formatCurrency(value)}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="rounded-lg border bg-background p-2 shadow-sm">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="font-mono text-sm font-medium">
                                Date:
                              </div>
                              <div className="font-mono text-sm">
                                {data.date}
                              </div>
                              <div className="font-mono text-sm font-medium">
                                Price:
                              </div>
                              <div className="font-mono text-sm">
                                {formatCurrency(data.price)}
                              </div>
                              {data.notes && (
                                <>
                                  <div className="font-mono text-sm font-medium">
                                    Notes:
                                  </div>
                                  <div className="font-mono text-sm">
                                    {data.notes}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#283845"
                      strokeWidth={2}
                      dot={{ fill: "#283845" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <Card className="p-6">
            <h4 className="font-mono text-sm font-semibold mb-2">
              Investment Outlook
            </h4>
            <p className="font-mono text-sm text-[#283845]">
              {analysis.investmentOutlook}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <span className="font-mono text-sm text-[#666]">
                  Estimated Value:
                </span>
                <p className="font-mono text-lg font-semibold">
                  {formatCurrency(analysis.priceAnalysis.estimatedValue)}
                </p>
              </div>
              <div>
                <span className="font-mono text-sm text-[#666]">
                  Market Trend:
                </span>
                <p className="font-mono text-lg font-semibold capitalize">
                  {analysis.priceAnalysis.trendDirection}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

