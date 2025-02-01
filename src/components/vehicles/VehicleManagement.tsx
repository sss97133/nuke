import { useState } from "react";
import { VehicleList } from "@/components/inventory/VehicleList";
import { VehicleForm } from "./VehicleForm";
import { MarketDataCollector } from "@/components/market/MarketDataCollector";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const VehicleManagement = () => {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-mono text-[#283845] tracking-tight uppercase">Vehicle Registry</h2>
          <p className="text-xs text-[#666] font-mono mt-1">Asset Documentation System</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
        >
          {showForm ? "View Registry" : "Register Vehicle"}
        </Button>
      </div>

      {showForm ? (
        <VehicleForm />
      ) : (
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="list" className="flex-1">Vehicle List</TabsTrigger>
            <TabsTrigger value="market" className="flex-1">Market Analysis</TabsTrigger>
          </TabsList>
          <TabsContent value="list">
            <VehicleList />
          </TabsContent>
          <TabsContent value="market">
            <MarketDataCollector />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};