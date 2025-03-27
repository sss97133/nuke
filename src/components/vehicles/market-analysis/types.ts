export interface TokenAnalysis {
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

export interface Analysis {
  marketAnalysis: string;
  uniqueFeatures: string[];
  valueFactors: string[];
  investmentOutlook: string;
  priceAnalysis?: {
    estimatedValue: number;
    confidence: number;
    trendDirection: string;
    comparableSales: Array<{
      price: number;
      date: string;
      notes: string;
    }>;
  };
  tokenAnalysis?: {
    currentTokenPrice: number;
    tokenVolume24h: number;
    marketCap: number;
    circulatingSupply: number;
    derivativesData: Array<{
      type: string;
      price: number;
      expirationDate: string;
    }>;
  };
}

export interface MarketAnalysisProps {
  vehicleData: {
    id: string;
    make: string;
    model: string;
    year: number;
    historical_data?: {
      prices: Array<{
        date: string;
        price: number;
      }>;
      events: Array<{
        date: string;
        description: string;
      }>;
    };
  };
}
