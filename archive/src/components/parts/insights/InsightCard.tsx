
import { Button } from '@/components/ui/button';
import { Brain, Lightbulb, BarChart3, Bot } from 'lucide-react';

export interface AIInsight {
  id: string;
  title: string;
  description: string;
  category: 'recommendation' | 'prediction' | 'analysis';
  relatedVehicle?: string;
  confidence: number;
}

interface InsightCardProps {
  insight: AIInsight;
}

export const InsightCard = ({ insight }: InsightCardProps) => {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'recommendation':
        return <Lightbulb className="h-5 w-5" />;
      case 'prediction':
        return <Brain className="h-5 w-5" />;
      case 'analysis':
        return <BarChart3 className="h-5 w-5" />;
      default:
        return <Bot className="h-5 w-5" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'recommendation':
        return 'bg-blue-100 text-blue-700';
      case 'prediction':
        return 'bg-purple-100 text-purple-700';
      case 'analysis':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-full ${getCategoryColor(insight.category)}`}>
          {getCategoryIcon(insight.category)}
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-medium mb-1">{insight.title}</h3>
          {insight.relatedVehicle && (
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {insight.relatedVehicle}
            </p>
          )}
          <p className="text-sm text-muted-foreground mb-3">{insight.description}</p>
          <div className="flex justify-between items-center">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium">AI Confidence:</span> {(insight.confidence * 100).toFixed(0)}%
            </div>
            <Button size="sm">View Details</Button>
          </div>
        </div>
      </div>
    </div>
  );
};
