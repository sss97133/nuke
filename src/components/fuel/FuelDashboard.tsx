
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FuelEntryList } from "./FuelEntryList";
import { FuelStatistics } from "./FuelStatistics";
import { FuelEntryForm } from "./FuelEntryForm";
import { useState } from "react";

export const FuelDashboard = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleEntryAdded = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Add Fuel Entry</CardTitle>
          </CardHeader>
          <CardContent>
            <FuelEntryForm onEntryAdded={handleEntryAdded} />
          </CardContent>
        </Card>
        <FuelStatistics refreshTrigger={refreshTrigger} />
      </div>
      
      <Tabs defaultValue="entries" className="w-full">
        <TabsList>
          <TabsTrigger value="entries">Recent Entries</TabsTrigger>
          <TabsTrigger value="trends">Consumption Trends</TabsTrigger>
        </TabsList>
        <TabsContent value="entries">
          <Card>
            <CardHeader>
              <CardTitle>Fuel Entries</CardTitle>
            </CardHeader>
            <CardContent>
              <FuelEntryList refreshTrigger={refreshTrigger} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="trends">
          <Card>
            <CardHeader>
              <CardTitle>Fuel Consumption Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <FuelConsumptionChart refreshTrigger={refreshTrigger} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const FuelConsumptionChart = ({ refreshTrigger }: { refreshTrigger: number }) => {
  // This would normally fetch data based on the refreshTrigger
  
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-muted-foreground">Consumption trends visualization will appear here</p>
    </div>
  );
};
