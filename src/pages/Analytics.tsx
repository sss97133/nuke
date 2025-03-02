
import TheoremExplainAgent from '@/components/analytics/TheoremExplainAgent';
import { StudioAnalytics } from '@/components/studio/analytics/StudioAnalytics';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from 'react';

const Analytics = () => {
  const [activeTab, setActiveTab] = useState("studio");

  return (
    <div className="container mx-auto py-6 space-y-6">
      <h1 className="text-3xl font-bold">Analytics</h1>
      
      <Tabs defaultValue="studio" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="studio">Studio Analytics</TabsTrigger>
          <TabsTrigger value="theorems">Theorem Visualization</TabsTrigger>
        </TabsList>
        
        <TabsContent value="studio">
          <StudioAnalytics />
        </TabsContent>
        
        <TabsContent value="theorems">
          <TheoremExplainAgent />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Analytics;
