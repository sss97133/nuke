import { Progress } from "@/components/ui/progress";
import { LoaderCircle, Check, Search, Database } from "lucide-react";

interface ProcessingStatusProps {
  processingStep: string;
  progress: number;
}

export const ProcessingStatus = ({ processingStep, progress }: ProcessingStatusProps) => {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <LoaderCircle className="animate-spin h-4 w-4" />
          <span className="font-mono text-sm">{processingStep}</span>
        </div>
        <span className="font-mono text-sm">{progress}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      
      <div className="flex justify-between items-center text-sm font-mono">
        <div className="flex items-center space-x-2">
          {progress >= 20 && <Check className="h-4 w-4 text-green-500" />}
          <span>Image</span>
        </div>
        <div className="flex items-center space-x-2">
          {progress >= 40 && <Search className="h-4 w-4 text-blue-500" />}
          <span>OCR</span>
        </div>
        <div className="flex items-center space-x-2">
          {progress >= 60 && <Database className="h-4 w-4 text-purple-500" />}
          <span>Match</span>
        </div>
        <div className="flex items-center space-x-2">
          {progress >= 100 ? 
            <Check className="h-4 w-4 text-green-500" /> : 
            (progress >= 80 ? <LoaderCircle className="animate-spin h-4 w-4" /> : null)
          }
          <span>Verify</span>
        </div>
      </div>
    </div>
  );
};