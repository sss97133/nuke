
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InterestsFeed } from './tabs/InterestsFeed';
import { TrendingFeed } from './tabs/TrendingFeed';
import { NearbyFeed } from './tabs/NearbyFeed';
import { DiscoverFeed } from './tabs/DiscoverFeed';
import { ExploreHeader } from './ExploreHeader';

export const ExploreFeed = () => {
  const [filter, setFilter] = useState('all');
  
  return (
    <div className="space-y-6">
      <ExploreHeader activeFilter={filter} onFilterChange={setFilter} />
      
      <Tabs defaultValue="interests">
        <TabsList className="mb-4">
          <TabsTrigger value="interests">For You</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
          <TabsTrigger value="nearby">Nearby</TabsTrigger>
          <TabsTrigger value="discover">Discover</TabsTrigger>
        </TabsList>
        
        <TabsContent value="interests">
          <InterestsFeed filter={filter} />
        </TabsContent>
        
        <TabsContent value="trending">
          <TrendingFeed filter={filter} />
        </TabsContent>
        
        <TabsContent value="nearby">
          <NearbyFeed filter={filter} />
        </TabsContent>
        
        <TabsContent value="discover">
          <DiscoverFeed filter={filter} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
