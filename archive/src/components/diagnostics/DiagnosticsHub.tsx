
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DiagnosticsHeader from './DiagnosticsHeader';
import ThirdPartyTools from './ThirdPartyTools';
import OBDIIDataLogger from './OBDIIDataLogger';
import CloudMonitoring from './CloudMonitoring';
import SystemStatus from './SystemStatus';

const DiagnosticsHub = () => {
  const [activeTab, setActiveTab] = useState("obd-ii");

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-6">
      <DiagnosticsHeader />
      
      <Tabs defaultValue="obd-ii" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 md:grid-cols-4 mb-4 md:mb-8 w-full">
          <TabsTrigger value="obd-ii" className="text-xs sm:text-sm">OBD-II</TabsTrigger>
          <TabsTrigger value="third-party" className="text-xs sm:text-sm">3rd Party</TabsTrigger>
          <TabsTrigger value="cloud" className="text-xs sm:text-sm">Cloud</TabsTrigger>
          <TabsTrigger value="status" className="text-xs sm:text-sm">Status</TabsTrigger>
        </TabsList>
        
        <TabsContent value="obd-ii" className="space-y-4">
          <OBDIIDataLogger />
        </TabsContent>
        
        <TabsContent value="third-party" className="space-y-4">
          <ThirdPartyTools />
        </TabsContent>
        
        <TabsContent value="cloud" className="space-y-4">
          <CloudMonitoring />
        </TabsContent>
        
        <TabsContent value="status" className="space-y-4">
          <SystemStatus />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DiagnosticsHub;
