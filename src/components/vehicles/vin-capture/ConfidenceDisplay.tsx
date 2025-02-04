import { Check } from "lucide-react";

interface ConfidenceDisplayProps {
  confidence: number;
}

export const ConfidenceDisplay = ({ confidence }: ConfidenceDisplayProps) => {
  if (confidence === 0) return null;

  return (
    <div className="flex items-center justify-between p-2 bg-green-50 rounded-lg animate-fade-in">
      <div className="flex items-center space-x-2">
        <Check className="h-4 w-4 text-green-500" />
        <span className="font-mono text-sm">VIN Match Found</span>
      </div>
      <span className="font-mono text-sm text-green-600">{confidence}% confidence</span>
    </div>
  );
};