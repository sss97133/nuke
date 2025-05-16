
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FileImportTab from '@/components/import/FileImportTab';
import WebImportTab from '@/components/import/WebImportTab';
import APIConnectionTab from '@/components/import/APIConnectionTab';
import DocumentScanTab from '@/components/import/DocumentScanTab';

const ImportPage = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Import</h1>
          <p className="text-muted-foreground">
            Import data from various sources into your system
          </p>
        </div>
        
        <Tabs defaultValue="file">
          <TabsList className="mb-4">
            <TabsTrigger value="file">File Import</TabsTrigger>
            <TabsTrigger value="web">Web Import</TabsTrigger>
            <TabsTrigger value="api">API Connection</TabsTrigger>
            <TabsTrigger value="scan">Document Scan</TabsTrigger>
          </TabsList>
          
          <TabsContent value="file">
            <FileImportTab />
          </TabsContent>
          
          <TabsContent value="web">
            <WebImportTab />
          </TabsContent>
          
          <TabsContent value="api">
            <APIConnectionTab />
          </TabsContent>
          
          <TabsContent value="scan">
            <DocumentScanTab />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

export default ImportPage;
