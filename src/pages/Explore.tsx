
import React from 'react';
import { ExploreFeed } from '@/components/explore/ExploreFeed';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles } from "lucide-react";

const Explore = () => {
  return (
    <div className="container max-w-7xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
            <Sparkles className="h-5 w-5 text-amber-500" />
          </div>
          <p className="text-muted-foreground">
            Discover personalized content based on your interests and activities
          </p>
        </div>
      </div>
      
      <ScrollArea className="h-[calc(100vh-9rem)]">
        <ExploreFeed />
      </ScrollArea>
    </div>
  );
};

export default Explore;
