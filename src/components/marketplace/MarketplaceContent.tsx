
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Marketplace</h1>
          <Badge variant="outline" className="text-sm">
            Beta
          </Badge>
        </div>
        <p className="text-muted-foreground">
          The first blockchain-verified marketplace for classic and collectible vehicles
        </p>
        <div className="flex gap-2 mt-2">
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            {Math.floor(Math.random() * 1000)} Verified Listings
          </Badge>
          <Badge variant="secondary" className="bg-purple-100 text-purple-800">
            {Math.floor(Math.random() * 500)} Active Auctions
          </Badge>
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            {Math.floor(Math.random() * 5000)} Total Vehicles
          </Badge>
        </div>
      </div>
      
      <MarketplaceHeader />
      
      <Tabs defaultValue="featured" className="mt-6">
        <TabsList className="mb-4 flex flex-wrap gap-2">
          <TabsTrigger value="featured">Featured</TabsTrigger>
          <TabsTrigger value="verified">Verified History</TabsTrigger>
          <TabsTrigger value="auction">Live Auctions</TabsTrigger>
          <TabsTrigger value="classic">Classic Cars</TabsTrigger>
          <TabsTrigger value="collector">Collector Editions</TabsTrigger>
          <TabsTrigger value="all">All Listings</TabsTrigger>
          <TabsTrigger value="nearby">Nearby</TabsTrigger>
          <TabsTrigger value="watched">Watched</TabsTrigger>
        </TabsList>
        
        <div className="flex gap-4 mb-4">
          <div className="flex-1 space-y-2">
            <h3 className="text-sm font-medium">Documentation Score</h3>
            <select className="w-full border rounded-md p-2">
              <option value="any">Any Score</option>
              <option value="90">90% and above</option>
              <option value="75">75% and above</option>
              <option value="50">50% and above</option>
            </select>
          </div>
          
          <div className="flex-1 space-y-2">
            <h3 className="text-sm font-medium">Verification Status</h3>
            <select className="w-full border rounded-md p-2">
              <option value="any">All Listings</option>
              <option value="verified">Verified Only</option>
              <option value="nft">NFT Backed</option>
              <option value="both">Verified & NFT Backed</option>
            </select>
          </div>
          
          <div className="flex-1 space-y-2">
            <h3 className="text-sm font-medium">Price Range</h3>
            <select className="w-full border rounded-md p-2">
              <option value="any">Any Price</option>
              <option value="under25">Under $25,000</option>
              <option value="25to50">$25,000 - $50,000</option>
              <option value="50to100">$50,000 - $100,000</option>
              <option value="over100">$100,000+</option>
            </select>
          </div>
        </div>

        <ScrollArea className="h-[calc(100vh-24rem)]">
          <TabsContent value="featured">
            <FeaturedListings />
          </TabsContent>
          
          <TabsContent value="verified">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Verified listings will be populated here */}
            </div>
          </TabsContent>

          <TabsContent value="auction">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Active auctions will be populated here */}
            </div>
          </TabsContent>

          <TabsContent value="classic">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Classic car listings will be populated here */}
            </div>
          </TabsContent>

          <TabsContent value="collector">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Collector edition listings will be populated here */}
            </div>
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
