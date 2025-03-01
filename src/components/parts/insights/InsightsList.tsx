
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { InsightCard, AIInsight } from './InsightCard';

interface InsightsListProps {
  insights: AIInsight[];
  loading: boolean;
}

export const InsightsList = ({ insights, loading }: InsightsListProps) => {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {insights.map(insight => (
        <Card key={insight.id} className="overflow-hidden hover:shadow-md transition-shadow">
          <InsightCard insight={insight} />
        </Card>
      ))}
    </div>
  );
};
