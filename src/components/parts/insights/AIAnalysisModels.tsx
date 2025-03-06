import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const models = [
  {
    name: 'Predictive Maintenance Model',
    description: 'Predicts when parts will need replacement based on vehicle usage patterns',
    accuracy: 94,
    lastUpdate: '2 days ago'
  },
  {
    name: 'Cost Optimization Model',
    description: 'Identifies cost-saving opportunities across your parts inventory',
    accuracy: 88,
    lastUpdate: '3 days ago'
  },
  {
    name: 'Parts Compatibility Analysis',
    description: 'Analyzes optimal parts matches across your vehicle fleet',
    accuracy: 92,
    lastUpdate: '1 day ago'
  }
];

export function AIAnalysisModels() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Models</CardTitle>
        <CardDescription>
          These machine learning models power your parts insights
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {models.map((model) => (
            <div key={model.name} className="space-y-1">
              <div className="flex justify-between">
                <h4 className="font-medium">{model.name}</h4>
                <span className="text-sm text-muted-foreground">Updated {model.lastUpdate}</span>
              </div>
              <p className="text-sm text-muted-foreground">{model.description}</p>
              <div className="flex items-center gap-2">
                <Progress value={model.accuracy} className="h-2" />
                <span className="text-sm font-medium">{model.accuracy}%</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}