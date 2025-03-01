
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";

export interface MarketAnalysisProps {
  vehicleData?: {
    make: string;
    model: string;
    year: number;
    historical_data?: any;
  };
}

export const MarketAnalysis = ({ vehicleData }: MarketAnalysisProps) => {
  const defaultVehicleData = vehicleData || {
    make: "Generic",
    model: "Vehicle",
    year: new Date().getFullYear(),
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold mb-4">Market Analysis</h1>
        <Card className="p-4">
          <p className="text-muted-foreground">Market analysis content for {defaultVehicleData.make} {defaultVehicleData.model} coming soon...</p>
        </Card>
      </div>
    </ScrollArea>
  );
};

export default MarketAnalysis;
