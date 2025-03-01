
import { Brain } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '@/components/ui/card';

interface AnalysisModel {
  name: string;
  description: string;
  accuracy: number;
  colorClass: string;
}

export const AIAnalysisModels = () => {
  const analysisModels: AnalysisModel[] = [
    {
      name: 'Maintenance Prediction',
      description: 'Analyzes vehicle history, manufacturer recommendations, and usage patterns to predict maintenance needs.',
      accuracy: 95,
      colorClass: 'bg-blue-600'
    },
    {
      name: 'Budget Optimization',
      description: 'Identifies cost-saving opportunities and optimal purchase timing based on market trends and service schedules.',
      accuracy: 87,
      colorClass: 'bg-green-600'
    },
    {
      name: 'Parts Compatibility',
      description: 'Cross-references your vehicles with our parts database to ensure perfect compatibility and optimal performance.',
      accuracy: 99,
      colorClass: 'bg-purple-600'
    }
  ];

  return (
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
          {analysisModels.map((model, index) => (
            <div key={index} className="border rounded-md p-4">
              <h4 className="font-medium mb-1">{model.name}</h4>
              <p className="text-sm text-muted-foreground mb-2">
                {model.description}
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div className={`${model.colorClass} h-2 rounded-full`} style={{ width: `${model.accuracy}%` }}></div>
              </div>
              <div className="flex justify-end mt-1">
                <span className="text-xs text-muted-foreground">{model.accuracy}% accuracy</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
