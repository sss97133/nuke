import React from "react";
import { Analysis, MarketAnalysisProps } from "./types";
import { MarketPositionCard } from "./MarketPositionCard";
import { FeaturesAndFactors } from "./FeaturesAndFactors";
import { PriceHistoryChart } from "./PriceHistoryChart";
import { InvestmentOutlookCard } from "./InvestmentOutlookCard";
import { TokenAnalysisCard } from "./TokenAnalysisCard";
import { DerivativesCard } from "./DerivativesCard";
import { Card } from "@/components/ui/card";
import { PriceAnalysisCard } from "./PriceAnalysisCard";
import { supabase } from "@/lib/supabase";
import { Database } from '@/types/supabase';
import { useState, useEffect } from 'react';

interface PriceAnalysis {
  estimatedValue: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  comparableSales: Array<{
    date: string;
    price: number;
  }>;
}

interface TokenAnalysis {
  tokenPrice: number;
  marketCap: number;
  volume24h: number;
  holders: number;
}

export const MarketAnalysis = ({ vehicleData }: MarketAnalysisProps) => {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [priceAnalysis, setPriceAnalysis] = useState<PriceAnalysis | null>(null);
  const [tokenAnalysis, setTokenAnalysis] = useState<TokenAnalysis | null>(null);

  React.useEffect(() => {
    async function fetchMarketAnalysis() {
      try {
        setLoading(true);
        setError(null);
        
        // Fetch market analysis data from Supabase
        const { data, error } = await supabase
          .from('market_analysis')
          .select(`
            *,
            price_analysis:price_analysis_id (*),
            token_analysis:token_analysis_id (*)
          `)
          .eq('vehicle_id', vehicleData.id)
          .single();
          
        if (error) {
          throw error;
        }
        
        if (data) {
          const analysis: Analysis = {
            marketAnalysis: data.market_analysis,
            uniqueFeatures: data.unique_features,
            valueFactors: data.value_factors,
            investmentOutlook: data.investment_outlook
          };
          
          // Add price analysis if available
          if (data.price_analysis) {
            const priceAnalysis: PriceAnalysis = {
              estimatedValue: data.price_analysis.estimated_value,
              confidence: data.price_analysis.confidence,
              trend: data.price_analysis.trend_direction as 'up' | 'down' | 'stable',
              comparableSales: data.price_analysis.comparable_sales
            };
            setPriceAnalysis(priceAnalysis);
          }
          
          // Add token analysis if available
          if (data.token_analysis) {
            const tokenAnalysis: TokenAnalysis = {
              tokenPrice: data.token_analysis.current_token_price,
              marketCap: data.token_analysis.market_cap,
              volume24h: data.token_analysis.token_volume_24h,
              holders: data.token_analysis.holders
            };
            setTokenAnalysis(tokenAnalysis);
          }
          
          setAnalysis(analysis);
        }
      } catch (err) {
        console.error('Error fetching market analysis:', err);
        setError('Failed to load market analysis');
      } finally {
        setLoading(false);
      }
    }
    
    if (vehicleData?.id) {
      fetchMarketAnalysis();
    }
  }, [vehicleData?.id]);

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
      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
        </div>
      ) : error ? (
        <div className="text-red-500 dark:text-red-400">{error}</div>
      ) : analysis ? (
        <>
          <div className="prose dark:prose-invert max-w-none">
            <p>{analysis.marketAnalysis}</p>
            <h3>Unique Features</h3>
            <ul>
              {analysis.uniqueFeatures.map((feature, index) => (
                <li key={index}>{feature}</li>
              ))}
            </ul>
            <h3>Value Factors</h3>
            <ul>
              {analysis.valueFactors.map((factor, index) => (
                <li key={index}>{factor}</li>
              ))}
            </ul>
            <h3>Investment Outlook</h3>
            <p>{analysis.investmentOutlook}</p>
          </div>
          
          {priceAnalysis && (
            <PriceAnalysisCard analysis={priceAnalysis} />
          )}
          
          {tokenAnalysis && (
            <DerivativesCard analysis={tokenAnalysis} />
          )}
        </>
      ) : null}
    </div>
  );
};
