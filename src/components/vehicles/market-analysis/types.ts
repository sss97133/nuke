
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
  priceAnalysis: {
    estimatedValue: number;
    confidence: number;
    trendDirection: "up" | "down" | "stable";
    comparableSales: Array<{ price: number; date: string; notes: string }>;
  };
  tokenAnalysis?: TokenAnalysis;
}

export interface MarketAnalysisProps {
  vehicleData: {
    make: string;
    model: string;
    year: number;
    historical_data?: any;
  };
}
