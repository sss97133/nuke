import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface AIClassification {
  label: string;
  score: number;
}

interface AIResultsProps {
  results: AIClassification[];
}

export const AIResults = ({ results }: AIResultsProps) => {
  if (results.length === 0) return null;

  return (
    <Alert>
      <AlertTitle>AI Detection Results</AlertTitle>
      <AlertDescription>
        <div className="mt-2 space-y-2">
          {results.map((result, index) => (
            <div key={index} className="flex items-center justify-between">
              <span>{result.label}</span>
              <span className="text-sm text-muted-foreground">
                {(result.score * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
};