
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Brain, LightBulb, BarChart3, Robot } from 'lucide-react';

interface AIInsight {
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

  useEffect(() => {
    const fetchAIInsights = async () => {
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
    };

    fetchAIInsights();
  }, [toast]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'recommendation':
        return <LightBulb className="h-5 w-5" />;
      case 'prediction':
        return <Brain className="h-5 w-5" />;
      case 'analysis':
        return <BarChart3 className="h-5 w-5" />;
      default:
        return <Robot className="h-5 w-5" />;
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
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">AI Parts Insights</h2>
          <p className="text-muted-foreground">
            Smart recommendations and analysis based on your vehicles and service history
          </p>
        </div>
        <Button variant="outline" className="flex items-center gap-2">
          <Robot className="h-4 w-4" />
          Refresh Insights
        </Button>
      </div>
      
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {insights.map(insight => (
            <Card key={insight.id} className="overflow-hidden hover:shadow-md transition-shadow">
              <CardContent className="p-6">
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>AI Analysis Models</CardTitle>
              <CardDescription>The systems powering your insights</CardDescription>
            </div>
            <div className="p-2 bg-purple-100 rounded-full">
              <Brain className="h-5 w-5 text-purple-700" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-1">Maintenance Prediction</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Analyzes vehicle history, manufacturer recommendations, and usage patterns to predict maintenance needs.
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full" style={{ width: '95%' }}></div>
              </div>
              <div className="flex justify-end mt-1">
                <span className="text-xs text-muted-foreground">95% accuracy</span>
              </div>
            </div>
            
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-1">Budget Optimization</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Identifies cost-saving opportunities and optimal purchase timing based on market trends and service schedules.
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-green-600 h-2 rounded-full" style={{ width: '87%' }}></div>
              </div>
              <div className="flex justify-end mt-1">
                <span className="text-xs text-muted-foreground">87% accuracy</span>
              </div>
            </div>
            
            <div className="border rounded-md p-4">
              <h4 className="font-medium mb-1">Parts Compatibility</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Cross-references your vehicles with our parts database to ensure perfect compatibility and optimal performance.
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className="bg-purple-600 h-2 rounded-full" style={{ width: '99%' }}></div>
              </div>
              <div className="flex justify-end mt-1">
                <span className="text-xs text-muted-foreground">99% accuracy</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AIInsightsPanel;
