
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocumentationContent } from '@/components/documentation/DocumentationContent';

const Documentation = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <DocumentationContent />
    </ScrollArea>
  );
};

export default Documentation;
