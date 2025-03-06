import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Bot } from 'lucide-react';
import { InsightsList } from './insights/InsightsList';
import { AIAnalysisModels } from './insights/AIAnalysisModels';

export interface AIInsight {
  id: string;
  title: string;
  description: string;
  category: 'recommendation' | 'prediction' | 'analysis';
  relatedVehicle?: string;
  confidence: number;
}

const AIInsightsPanel = () => {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchAIInsights = useCallback(async () => {
    try {
      setLoading(true);
      // In a real implementation, this would fetch from your API
      // For demo purposes, we're using mock data
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // Mock data
      const mockInsights: AIInsight[] = [
        {
          id: '1',
          title: 'Oil Change Parts Recommendation',
          description: 'Based on your 2019 Toyota Camry\'s service history, we recommend scheduling an oil change in the next 2 weeks. Click to see the recommended parts for this service.',
          category: 'recommendation',
          relatedVehicle: '2019 Toyota Camry',
          confidence: 0.92
        },
        {
          id: '2',
          title: 'Potential Battery Replacement',
          description: 'Your Honda Civic\'s battery is approaching the end of its typical lifespan. Consider purchasing a replacement battery in the next 1-2 months to avoid unexpected failure.',
          category: 'prediction',
          relatedVehicle: '2020 Honda Civic',
          confidence: 0.85
        },
        {
          id: '3',
          title: 'Cost Saving Opportunity',
          description: 'You could save 15% on your annual parts budget by purchasing the Brake System Bundle currently on sale, which matches your upcoming maintenance needs for your Ford F-150.',
          category: 'analysis',
          relatedVehicle: '2018 Ford F-150',
          confidence: 0.78
        },
        {
          id: '4',
          title: 'Seasonal Maintenance Suggestion',
          description: 'With summer approaching, now is the optimal time to replace the cabin air filter and check your A/C system components for all your vehicles.',
          category: 'recommendation',
          confidence: 0.88
        },
      ];
      
      setInsights(mockInsights);
      toast({
        title: "Insights refreshed",
        description: "New AI insights have been generated"
      });
    } catch (error) {
      console.error('Error fetching AI insights:', error);
      toast({
        title: "Error",
        description: "Could not load AI insights",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAIInsights();
  }, [fetchAIInsights]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">AI Parts Insights</h2>
          <p className="text-muted-foreground">
            Smart recommendations and analysis based on your vehicles and service history
          </p>
        </div>
        <Button 
          variant="outline" 
          className="flex items-center gap-2" 
          onClick={fetchAIInsights}
          disabled={loading}
        >
          <Bot className="h-4 w-4" />
          {loading ? 'Generating insights...' : 'Refresh Insights'}
        </Button>
      </div>
      
      <InsightsList insights={insights} loading={loading} />
      
      <AIAnalysisModels />
    </div>
  );
};

export default AIInsightsPanel;