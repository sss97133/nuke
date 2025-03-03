
import React from 'react';
import { ExploreFeed } from '@/components/explore/ExploreFeed';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { Link } from "react-router-dom";

const Explore = () => {
  return (
    <div className="container max-w-7xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
          <p className="text-muted-foreground">
            Discover content based on your interests and preferences
          </p>
        </div>
        
        <Link to="/explore/manage">
          <Button variant="outline" className="ml-auto flex items-center gap-1">
            <PlusCircle className="h-4 w-4" />
            Manage Content
          </Button>
        </Link>
      </div>
      
      <ScrollArea className="h-[calc(100vh-9rem)]">
        <ExploreFeed />
      </ScrollArea>
    </div>
  );
};

export default Explore;
