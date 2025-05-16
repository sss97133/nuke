interface AIClassification {
  label: string;
  score: number;
}

interface AIResultsProps {
  results: AIClassification[];
}

export const AIResults = ({ results }: AIResultsProps) => {
  if (!results.length) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">AI Scan Results</h4>
      <div className="space-y-1">
        {results.map((result, index) => (
          <div 
            key={index}
            className="flex justify-between text-sm p-2 bg-muted/50 rounded"
          >
            <span>{result.label}</span>
            <span className="text-muted-foreground">
              {(result.score * 100).toFixed(1)}% confidence
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};