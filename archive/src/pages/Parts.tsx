import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Helmet } from 'react-helmet-async';
import PartsDashboard from '@/components/parts/PartsDashboard';
import InventoryBrowser from '@/components/parts/InventoryBrowser';
import VehiclePartsViewer from '@/components/parts/VehiclePartsViewer';
import BudgetPlanner from '@/components/parts/BudgetPlanner';
import SponsoredContent from '@/components/parts/SponsoredContent';
import AIInsightsPanel from '@/components/parts/AIInsightsPanel';

const Parts = () => {
  return (
    <div className="container mx-auto p-4 space-y-6">
      <Helmet>
        <title>Parts Management | Vehicle Manager</title>
      </Helmet>
      
      <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Parts Management</h1>
          <p className="text-muted-foreground">
            Track, manage, and budget for vehicle parts in one place
          </p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-6 mb-8">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="vehicle-parts">Vehicle Parts</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="sponsored">Deals</TabsTrigger>
          <TabsTrigger value="ai-insights">AI Insights</TabsTrigger>
        </TabsList>
        
        <TabsContent value="dashboard" className="mt-6">
          <PartsDashboard />
        </TabsContent>
        
        <TabsContent value="inventory" className="mt-6">
          <InventoryBrowser />
        </TabsContent>
        
        <TabsContent value="vehicle-parts" className="mt-6">
          <VehiclePartsViewer />
        </TabsContent>
        
        <TabsContent value="budget" className="mt-6">
          <BudgetPlanner />
        </TabsContent>
        
        <TabsContent value="sponsored" className="mt-6">
          <SponsoredContent />
        </TabsContent>
        
        <TabsContent value="ai-insights" className="mt-6">
          <AIInsightsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Parts;
