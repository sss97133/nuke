
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarketplaceContent } from '@/components/marketplace/MarketplaceContent';
import { Helmet } from 'react-helmet';

const Marketplace = () => {
  return (
    <>
      <Helmet>
        <title>Marketplace | Vehicle Management System</title>
        <meta name="description" content="Browse and sell vehicles in our marketplace." />
      </Helmet>
      
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="pb-16">
          <MarketplaceContent />
        </div>
      </ScrollArea>
    </>
  );
};

export default Marketplace;
