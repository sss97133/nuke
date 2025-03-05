
import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Car, Star, Medal, Clock } from 'lucide-react';
import VehicleCollection from './VehicleCollection';

interface VehicleCollectionTabsProps {
  userId: string;
  isOwnProfile: boolean;
}

export const VehicleCollectionTabs = ({ userId, isOwnProfile }: VehicleCollectionTabsProps) => {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  
  return (
    <Tabs defaultValue="all" onValueChange={setActiveFilter} className="w-full">
      <TabsList className="grid grid-cols-4 mb-6">
        <TabsTrigger value="all" className="flex items-center gap-2">
          <Car className="h-4 w-4" />
          <span className="hidden md:inline">All Vehicles</span>
        </TabsTrigger>
        <TabsTrigger value="owned" className="flex items-center gap-2">
          <Star className="h-4 w-4" />
          <span className="hidden md:inline">Owned</span>
        </TabsTrigger>
        <TabsTrigger value="discovered" className="flex items-center gap-2">
          <Medal className="h-4 w-4" />
          <span className="hidden md:inline">Discovered</span>
        </TabsTrigger>
        <TabsTrigger value="recent" className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span className="hidden md:inline">Recent</span>
        </TabsTrigger>
      </TabsList>
      
      <TabsContent value="all">
        <VehicleCollection userId={userId} isOwnProfile={isOwnProfile} filter="all" />
      </TabsContent>
      
      <TabsContent value="owned">
        <VehicleCollection userId={userId} isOwnProfile={isOwnProfile} filter="owned" />
      </TabsContent>
      
      <TabsContent value="discovered">
        <VehicleCollection userId={userId} isOwnProfile={isOwnProfile} filter="discovered" />
      </TabsContent>
      
      <TabsContent value="recent">
        <VehicleCollection userId={userId} isOwnProfile={isOwnProfile} filter="recent" />
      </TabsContent>
    </Tabs>
  );
};

export default VehicleCollectionTabs;
