
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocumentationContent } from '@/components/documentation/DocumentationContent';
import { Helmet } from 'react-helmet';

const Documentation = () => {
  return (
    <>
      <Helmet>
        <title>Documentation | Vehicle Management System</title>
        <meta name="description" content="Comprehensive documentation for all features and capabilities of the vehicle management system." />
      </Helmet>
      
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="pb-16">
          <DocumentationContent />
        </div>
      </ScrollArea>
    </>
  );
};

export default Documentation;
