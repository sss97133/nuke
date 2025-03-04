
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InterestsFeed } from './tabs/InterestsFeed';
import { TrendingFeed } from './tabs/TrendingFeed';
import { NearbyFeed } from './tabs/NearbyFeed';
import { DiscoverFeed } from './tabs/DiscoverFeed';
import { ExploreHeader } from './ExploreHeader';
import { ExploreSearch } from './ExploreSearch';

export const ExploreFeed = () => {
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  return (
    <div className="space-y-6">
      <ExploreHeader activeFilter={filter} onFilterChange={setFilter} />
      <ExploreSearch onSearch={setSearchTerm} />
      
      <Tabs defaultValue="interests">
        <TabsList className="mb-4">
          <TabsTrigger value="interests">For You</TabsTrigger>
          <TabsTrigger value="trending">Trending</TabsTrigger>
          <TabsTrigger value="nearby">Nearby</TabsTrigger>
          <TabsTrigger value="discover">Discover</TabsTrigger>
        </TabsList>
        
        <TabsContent value="interests">
          <InterestsFeed filter={filter} searchTerm={searchTerm} />
        </TabsContent>
        
        <TabsContent value="trending">
          <TrendingFeed filter={filter} searchTerm={searchTerm} />
        </TabsContent>
        
        <TabsContent value="nearby">
          <NearbyFeed filter={filter} searchTerm={searchTerm} />
        </TabsContent>
        
        <TabsContent value="discover">
          <DiscoverFeed filter={filter} searchTerm={searchTerm} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
