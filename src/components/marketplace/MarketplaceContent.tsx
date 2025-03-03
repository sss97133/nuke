
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketplaceHeader } from './MarketplaceHeader';
import { FeaturedListings } from './tabs/FeaturedListings';
import { AllListings } from './tabs/AllListings';
import { NearbyListings } from './tabs/NearbyListings';
import { WatchedListings } from './tabs/WatchedListings';
import { ScrollArea } from "@/components/ui/scroll-area";

export const MarketplaceContent = () => {
  return (
    <div className="container max-w-7xl p-6">
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
        <p className="text-muted-foreground">
          Browse, buy, and sell vehicles in our public marketplace
        </p>
      </div>
      
      <MarketplaceHeader />
      
      <Tabs defaultValue="featured" className="mt-6">
        <TabsList className="mb-4">
          <TabsTrigger value="featured">Featured</TabsTrigger>
          <TabsTrigger value="all">All Listings</TabsTrigger>
          <TabsTrigger value="nearby">Nearby</TabsTrigger>
          <TabsTrigger value="watched">Watched</TabsTrigger>
        </TabsList>
        
        <ScrollArea className="h-[calc(100vh-18rem)]">
          <TabsContent value="featured">
            <FeaturedListings />
          </TabsContent>
          
          <TabsContent value="all">
            <AllListings />
          </TabsContent>
          
          <TabsContent value="nearby">
            <NearbyListings />
          </TabsContent>
          
          <TabsContent value="watched">
            <WatchedListings />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
};
