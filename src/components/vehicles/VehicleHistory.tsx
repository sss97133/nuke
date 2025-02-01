import { Button } from "@/components/ui/button";
import { Loader2, Calendar, DollarSign, Wrench, Car, Info } from "lucide-react";
import type { VehicleHistoricalData } from "@/types/inventory";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface VehicleHistoryProps {
  historicalData: VehicleHistoricalData | null;
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
        <div className="bg-gray-50 p-4 rounded-md border">
          <Info className="h-5 w-5 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground font-mono">
            No historical data available. Click "Search History" to discover information about this vehicle.
          </p>
        </div>
      </div>
    );
  }

  const hasData = historicalData.previousSales?.length || 
                  historicalData.modifications?.length || 
                  historicalData.notableHistory || 
                  historicalData.conditionNotes;

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

      {!hasData ? (
        <div className="bg-gray-50 p-4 rounded-md border">
          <Info className="h-5 w-5 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground font-mono">
            No significant historical data found for this vehicle.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {historicalData.previousSales && historicalData.previousSales.length > 0 && (
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[#283845]" />
                Sales History
              </h4>
              <div className="space-y-3">
                {historicalData.previousSales.map((sale, index) => (
                  <div key={index} className="bg-gray-50 p-3 rounded-md text-sm font-mono">
                    <div className="flex items-center gap-2 text-[#283845]">
                      {sale.date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {sale.date}</span>}
                      {sale.price && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> {sale.price}</span>}
                    </div>
                    {sale.source && <div className="text-muted-foreground text-xs mt-1">Source: {sale.source}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {historicalData.modifications && historicalData.modifications.length > 0 && (
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[#283845]" />
                Modifications
              </h4>
              <ul className="space-y-2 list-disc list-inside">
                {historicalData.modifications.map((mod, index) => (
                  <li key={index} className="font-mono text-sm text-[#283845]">{mod}</li>
                ))}
              </ul>
            </div>
          )}

          {historicalData.notableHistory && (
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
                <Car className="h-4 w-4 text-[#283845]" />
                Notable History
              </h4>
              <p className="font-mono text-sm text-[#283845] whitespace-pre-wrap">
                {historicalData.notableHistory}
              </p>
            </div>
          )}

          {historicalData.conditionNotes && (
            <div className="bg-white p-4 rounded-lg border shadow-sm">
              <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[#283845]" />
                Condition Assessment
              </h4>
              <p className="font-mono text-sm text-[#283845] whitespace-pre-wrap">
                {historicalData.conditionNotes}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};