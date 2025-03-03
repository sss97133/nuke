
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuidesTab } from './tabs/GuidesTab';
import { ApiTab } from './tabs/ApiTab';
import { TechTab } from './tabs/TechTab';
import { SupportTab } from './tabs/SupportTab';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Info } from 'lucide-react';

export const DocumentationContent = () => {
  return (
    <div className="container max-w-7xl p-6">
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground">
          Comprehensive reference materials, guides, and resources
        </p>
        
        <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950 p-3 rounded-md mt-4 text-sm">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <p className="text-blue-700 dark:text-blue-300">
            Our documentation has been expanded to cover all the latest features and improvements.
            Explore the tabs below to find detailed information about every aspect of the system.
          </p>
        </div>
      </div>
      
      <Tabs defaultValue="guides">
        <TabsList className="mb-4">
          <TabsTrigger value="guides">User Guides</TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
          <TabsTrigger value="tech">Technical Docs</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>
        
        <ScrollArea className="h-[calc(100vh-18rem)]">
          <TabsContent value="guides">
            <GuidesTab />
          </TabsContent>
          
          <TabsContent value="api">
            <ApiTab />
          </TabsContent>
          
          <TabsContent value="tech">
            <TechTab />
          </TabsContent>
          
          <TabsContent value="support">
            <SupportTab />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
};
