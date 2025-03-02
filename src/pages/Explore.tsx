
import React from 'react';
import { ExploreFeed } from '@/components/explore/ExploreFeed';
import { ScrollArea } from "@/components/ui/scroll-area";

const Explore = () => {
  return (
    <div className="container max-w-7xl p-6">
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
        <p className="text-muted-foreground">
          Discover content based on your interests and preferences
        </p>
      </div>
      
      <ScrollArea className="h-[calc(100vh-9rem)]">
        <ExploreFeed />
      </ScrollArea>
    </div>
  );
};

export default Explore;
