import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency } from '@/utils/format';

interface PriceAnalysisCardProps {
  analysis: {
    estimatedValue: number;
    confidence: number;
    trend: 'up' | 'down' | 'stable';
    comparableSales: Array<{
      date: string;
      price: number;
    }>;
  };
}

export function PriceAnalysisCard({ analysis }: PriceAnalysisCardProps) {
  const getTrendIcon = () => {
    switch (analysis.trend) {
      case 'up':
        return <TrendingUp className="w-5 h-5 text-green-500" />;
      case 'down':
        return <TrendingDown className="w-5 h-5 text-red-500" />;
      default:
        return <TrendingUp className="w-5 h-5 text-gray-500" />;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Price Analysis</h3>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Estimated Value</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{formatCurrency(analysis.estimatedValue)}</span>
            {getTrendIcon()}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600">Confidence</span>
          <span className="font-semibold">{analysis.confidence}%</span>
        </div>
        {analysis.comparableSales.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">Comparable Sales</h4>
            <ul className="space-y-2">
              {analysis.comparableSales.map((sale, index) => (
                <li key={index} className="flex justify-between text-sm">
                  <span className="text-gray-600">{new Date(sale.date).toLocaleDateString()}</span>
                  <span>{formatCurrency(sale.price)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
} 