import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

interface VehicleHistoryProps {
  historicalData: Json | null;
  onSearch: () => void;
  isSearching: boolean;
}

export const VehicleHistory = ({ historicalData, onSearch, isSearching }: VehicleHistoryProps) => {
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
        <p className="text-sm text-muted-foreground font-mono">
          No historical data available. Click "Search History" to find information about this vehicle.
        </p>
      </div>
    );
  }

  const data = typeof historicalData === 'string' ? JSON.parse(historicalData) : historicalData;

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

      {data.previousSales?.length > 0 && (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <h4 className="font-mono text-sm font-semibold mb-3 text-[#283845]">
            Previous Sales History ({data.previousSales.length})
          </h4>
          <div className="space-y-3">
            {data.previousSales.map((sale: any, index: number) => (
              <div key={index} className="bg-gray-50 p-4 rounded-md border">
                <p className="font-mono text-sm mb-1">
                  <span className="font-semibold">Date:</span> {sale.date || 'N/A'}
                </p>
                <p className="font-mono text-sm mb-1">
                  <span className="font-semibold">Price:</span> {sale.price || 'N/A'}
                </p>
                {sale.source && (
                  <p className="font-mono text-sm">
                    <span className="font-semibold">Source:</span> {sale.source}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.modifications?.length > 0 && (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <h4 className="font-mono text-sm font-semibold mb-3 text-[#283845]">
            Vehicle Modifications ({data.modifications.length})
          </h4>
          <ul className="list-disc list-inside space-y-2">
            {data.modifications.map((mod: string, index: number) => (
              <li key={index} className="font-mono text-sm pl-2">{mod}</li>
            ))}
          </ul>
        </div>
      )}

      {data.notableHistory && (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <h4 className="font-mono text-sm font-semibold mb-3 text-[#283845]">Notable History</h4>
          <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-4 rounded-md border">
            {data.notableHistory}
          </p>
        </div>
      )}

      {data.conditionNotes && (
        <div className="bg-white rounded-lg border p-4 shadow-sm">
          <h4 className="font-mono text-sm font-semibold mb-3 text-[#283845]">Condition Assessment</h4>
          <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-4 rounded-md border">
            {data.conditionNotes}
          </p>
        </div>
      )}
    </div>
  );
};