import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { VehicleHistoricalData } from "@/types/inventory";
import { NoHistoryMessage } from "./history/NoHistoryMessage";
import { SalesHistory } from "./history/SalesHistory";
import { ModificationsList } from "./history/ModificationsList";
import { HistorySection } from "./history/HistorySection";

interface VehicleHistoryProps {
  historicalData: VehicleHistoricalData | null;
  onSearch: () => void;
  isSearching: boolean;
}

export const VehicleHistory = ({ 
  historicalData, 
  onSearch, 
  isSearching 
}: VehicleHistoryProps) => {
  if (!historicalData) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-mono text-sm text-[#666]">Vehicle History</h3>
          <Button 
            onClick={onSearch} 
            disabled={isSearching}
            className="font-mono text-sm"
          >
            {isSearching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSearching ? 'Searching...' : 'Search History'}
          </Button>
        </div>
        <NoHistoryMessage />
      </div>
    );
  }

  const hasData = historicalData.previousSales?.length || 
                  historicalData.modifications?.length || 
                  historicalData.notableHistory || 
                  historicalData.conditionNotes;

  if (!hasData) {
    return <NoHistoryMessage />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-mono text-sm text-[#666]">Vehicle History</h3>
        <Button 
          onClick={onSearch} 
          disabled={isSearching}
          className="font-mono text-sm"
        >
          {isSearching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSearching ? 'Searching...' : 'Refresh History'}
        </Button>
      </div>

      <div className="grid gap-4">
        {historicalData.previousSales?.length > 0 && (
          <SalesHistory sales={historicalData.previousSales} />
        )}

        {historicalData.modifications?.length > 0 && (
          <ModificationsList modifications={historicalData.modifications} />
        )}

        {historicalData.notableHistory && (
          <HistorySection 
            title="Notable History"
            content={historicalData.notableHistory}
          />
        )}

        {historicalData.conditionNotes && (
          <HistorySection 
            title="Condition Assessment"
            content={historicalData.conditionNotes}
          />
        )}
      </div>
    </div>
  );
};