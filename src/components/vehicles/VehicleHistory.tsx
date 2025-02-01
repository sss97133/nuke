import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, ChevronUp, Calendar, DollarSign, Wrench, Car } from "lucide-react";
import { useState } from "react";
import type { VehicleHistoricalData } from "@/types/inventory";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface VehicleHistoryProps {
  historicalData: VehicleHistoricalData | null;
  onSearch: () => void;
  isSearching: boolean;
}

export const VehicleHistory = ({ historicalData, onSearch, isSearching }: VehicleHistoryProps) => {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

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

      {historicalData.previousSales && historicalData.previousSales.length > 0 && (
        <Collapsible 
          className="bg-white rounded-lg border p-4 shadow-sm"
          open={openSections['sales']}
          onOpenChange={() => toggleSection('sales')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[#283845]" />
              <h4 className="font-mono text-sm font-semibold text-[#283845]">
                Previous Sales ({historicalData.previousSales.length})
              </h4>
            </div>
            {openSections['sales'] ? (
              <ChevronUp className="h-4 w-4 text-[#283845]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#283845]" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {historicalData.previousSales.map((sale, index) => (
              <div key={index} className="bg-gray-50 p-3 rounded-md border text-sm font-mono">
                {sale.date && <div className="flex items-center gap-2"><Calendar className="h-3 w-3" /> {sale.date}</div>}
                {sale.price && <div className="flex items-center gap-2"><DollarSign className="h-3 w-3" /> {sale.price}</div>}
                {sale.source && <div className="text-muted-foreground text-xs mt-1">Source: {sale.source}</div>}
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {historicalData.modifications && historicalData.modifications.length > 0 && (
        <Collapsible 
          className="bg-white rounded-lg border p-4 shadow-sm"
          open={openSections['modifications']}
          onOpenChange={() => toggleSection('modifications')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[#283845]" />
              <h4 className="font-mono text-sm font-semibold text-[#283845]">
                Modifications ({historicalData.modifications.length})
              </h4>
            </div>
            {openSections['modifications'] ? (
              <ChevronUp className="h-4 w-4 text-[#283845]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#283845]" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <ul className="space-y-2 list-disc list-inside">
              {historicalData.modifications.map((mod, index) => (
                <li key={index} className="font-mono text-sm pl-2">{mod}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      {historicalData.notableHistory && (
        <Collapsible 
          className="bg-white rounded-lg border p-4 shadow-sm"
          open={openSections['history']}
          onOpenChange={() => toggleSection('history')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <Car className="h-4 w-4 text-[#283845]" />
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Notable History</h4>
            </div>
            {openSections['history'] ? (
              <ChevronUp className="h-4 w-4 text-[#283845]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#283845]" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-md border">
              {historicalData.notableHistory}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}

      {historicalData.conditionNotes && (
        <Collapsible 
          className="bg-white rounded-lg border p-4 shadow-sm"
          open={openSections['condition']}
          onOpenChange={() => toggleSection('condition')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[#283845]" />
              <h4 className="font-mono text-sm font-semibold text-[#283845]">Condition Assessment</h4>
            </div>
            {openSections['condition'] ? (
              <ChevronUp className="h-4 w-4 text-[#283845]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#283845]" />
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-md border">
              {historicalData.conditionNotes}
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};