import { formatCurrency } from '@/utils/format';

interface DerivativesCardProps {
  analysis: {
    tokenPrice: number;
    marketCap: number;
    volume24h: number;
    holders: number;
  };
}

export function DerivativesCard({ analysis }: DerivativesCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Token Analysis</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Token Price</span>
          <span className="font-semibold">{formatCurrency(analysis.tokenPrice)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Market Cap</span>
          <span className="font-semibold">{formatCurrency(analysis.marketCap)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">24h Volume</span>
          <span className="font-semibold">{formatCurrency(analysis.volume24h)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Holders</span>
          <span className="font-semibold">{analysis.holders.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
