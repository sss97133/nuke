
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import VehicleCollection from './VehicleCollection';

interface VehicleCollectionTabsProps {
  userId: string;
  isOwnProfile: boolean;
}

export const VehicleCollectionTabs: React.FC<VehicleCollectionTabsProps> = ({ 
  userId, 
  isOwnProfile 
}) => {
  return (
    <Tabs defaultValue="all" className="w-full">
      <TabsList className="grid grid-cols-4 mb-6">
        <TabsTrigger value="all">All Vehicles</TabsTrigger>
        <TabsTrigger value="owned">Owned</TabsTrigger>
        <TabsTrigger value="claimed">Claimed</TabsTrigger>
        <TabsTrigger value="discovered">Discovered</TabsTrigger>
      </TabsList>
      
      <TabsContent value="all">
        <VehicleCollection 
          userId={userId} 
          isOwnProfile={isOwnProfile} 
          filter="all" 
        />
      </TabsContent>
      
      <TabsContent value="owned">
        <VehicleCollection 
          userId={userId} 
          isOwnProfile={isOwnProfile} 
          filter="owned" 
        />
      </TabsContent>
      
      <TabsContent value="claimed">
        <VehicleCollection 
          userId={userId} 
          isOwnProfile={isOwnProfile} 
          filter="claimed" 
        />
      </TabsContent>
      
      <TabsContent value="discovered">
        <VehicleCollection 
          userId={userId} 
          isOwnProfile={isOwnProfile} 
          filter="discovered" 
        />
      </TabsContent>
    </Tabs>
  );
};

// Add a default export in addition to the named export
export default VehicleCollectionTabs;
