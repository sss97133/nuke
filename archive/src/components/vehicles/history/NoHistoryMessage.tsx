import { Info } from "lucide-react";

export const NoHistoryMessage = () => (
  <div className="bg-gray-50 p-4 rounded-md border">
    <Info className="h-5 w-5 text-muted-foreground mb-2" />
    <p className="text-sm text-muted-foreground font-mono">
      No historical data available. Click "Search History" to discover information about this vehicle.
    </p>
  </div>
);