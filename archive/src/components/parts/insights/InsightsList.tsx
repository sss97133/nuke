import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { type AIInsight } from '../AIInsightsPanel';

interface InsightsListProps {
  insights: AIInsight[];
  loading: boolean;
}

export function InsightsList({ insights, loading }: InsightsListProps) {
  const getBadgeColor = (category: string) => {
    switch (category) {
      case 'recommendation':
        return 'bg-blue-100 text-blue-800 hover:bg-blue-100';
      case 'prediction':
        return 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100';
      case 'analysis':
        return 'bg-green-100 text-green-800 hover:bg-green-100';
      default:
        return '';
    }
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.9) return 'High confidence';
    if (confidence >= 0.7) return 'Medium confidence';
    return 'Low confidence';
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex flex-col space-y-3">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex gap-2 mt-2">
                  <Skeleton className="h-4 w-20 rounded-full" />
                  <Skeleton className="h-4 w-24 rounded-full" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {insights.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No insights available at this time.
          </CardContent>
        </Card>
      ) : (
        insights.map((insight) => (
          <Card key={insight.id} className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-2">{insight.title}</h3>
              <p className="text-muted-foreground mb-3">{insight.description}</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={getBadgeColor(insight.category)}>
                  {insight.category.charAt(0).toUpperCase() + insight.category.slice(1)}
                </Badge>
                {insight.relatedVehicle && (
                  <Badge variant="outline" className="bg-gray-100 text-gray-800 hover:bg-gray-100">
                    {insight.relatedVehicle}
                  </Badge>
                )}
                <Badge variant="outline" className="bg-purple-100 text-purple-800 hover:bg-purple-100">
                  {getConfidenceLabel(insight.confidence)}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}