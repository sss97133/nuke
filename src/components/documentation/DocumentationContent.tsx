
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GuidesTab } from './tabs/GuidesTab';
import { ApiTab } from './tabs/ApiTab';
import { TechTab } from './tabs/TechTab';
import { SupportTab } from './tabs/SupportTab';

export const DocumentationContent = () => {
  return (
    <div className="container max-w-7xl p-6">
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground">
          Reference materials, guides, and resources
        </p>
      </div>
      
      <Tabs defaultValue="guides">
        <TabsList className="mb-4">
          <TabsTrigger value="guides">User Guides</TabsTrigger>
          <TabsTrigger value="api">API Reference</TabsTrigger>
          <TabsTrigger value="tech">Technical Docs</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
        </TabsList>
        
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
      </Tabs>
    </div>
  );
};
