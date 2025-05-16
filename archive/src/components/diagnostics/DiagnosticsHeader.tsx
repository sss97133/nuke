
import { Button } from "@/components/ui/button";
import { Gauge, Plus, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DiagnosticsHeader = () => {
  const { toast } = useToast();

  const handleRefresh = () => {
    toast({
      title: "Refreshing diagnostic data",
      description: "Fetching the latest diagnostic information..."
    });
  };
  
  const handleNewSession = () => {
    toast({
      title: "New diagnostic session",
      description: "Starting a new diagnostic session..."
    });
  };

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div>
        <div className="flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Vehicle Diagnostics</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Monitor, analyze, and diagnose your vehicle's systems
        </p>
      </div>
      
      <div className="flex gap-2">
        <Button variant="outline" onClick={handleRefresh} className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh Data
        </Button>
        <Button onClick={handleNewSession} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Session
        </Button>
      </div>
    </div>
  );
};

export default DiagnosticsHeader;
