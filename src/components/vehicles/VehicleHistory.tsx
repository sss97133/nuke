import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, ChevronUp, Calendar, DollarSign, Wrench, Car } from "lucide-react";
import { useState } from "react";
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
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="sales">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[#283845]" />
                <span className="font-mono text-sm font-semibold text-[#283845]">
                  Previous Sales ({historicalData.previousSales.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {historicalData.previousSales.map((sale, index) => (
                  <div key={index} className="bg-gray-50 p-3 rounded-md border text-sm font-mono">
                    {sale.date && <div className="flex items-center gap-2"><Calendar className="h-3 w-3" /> {sale.date}</div>}
                    {sale.price && <div className="flex items-center gap-2"><DollarSign className="h-3 w-3" /> {sale.price}</div>}
                    {sale.source && <div className="text-muted-foreground text-xs mt-1">Source: {sale.source}</div>}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {historicalData.modifications && historicalData.modifications.length > 0 && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="modifications">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[#283845]" />
                <span className="font-mono text-sm font-semibold text-[#283845]">
                  Modifications ({historicalData.modifications.length})
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2 list-disc list-inside">
                {historicalData.modifications.map((mod, index) => (
                  <li key={index} className="font-mono text-sm pl-2">{mod}</li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {historicalData.notableHistory && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="history">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Car className="h-4 w-4 text-[#283845]" />
                <span className="font-mono text-sm font-semibold text-[#283845]">Notable History</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-md border">
                {historicalData.notableHistory}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {historicalData.conditionNotes && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="condition">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[#283845]" />
                <span className="font-mono text-sm font-semibold text-[#283845]">Condition Assessment</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="font-mono text-sm whitespace-pre-wrap bg-gray-50 p-3 rounded-md border">
                {historicalData.conditionNotes}
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
};