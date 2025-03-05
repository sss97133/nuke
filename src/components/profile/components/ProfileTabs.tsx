
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import VehicleRelationshipsSection from './VehicleRelationshipsSection';

interface ProfileTabsProps {
  userId: string;
  isOwnProfile: boolean;
}

export const ProfileTabs = ({ userId, isOwnProfile }: ProfileTabsProps) => {
  return (
    <Tabs defaultValue="vehicles">
      <TabsList>
        <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        <TabsTrigger value="relationships">Relationships</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        {isOwnProfile && (
          <TabsTrigger value="settings">Settings</TabsTrigger>
        )}
      </TabsList>
      
      <TabsContent value="vehicles">
        <Card>
          <CardContent>
            <h3 className="font-semibold mb-4">Vehicles</h3>
            <p>Your vehicles will appear here.</p>
          </CardContent>
        </Card>
      </TabsContent>
      
      <TabsContent value="relationships">
        <VehicleRelationshipsSection userId={userId} />
      </TabsContent>
      
      <TabsContent value="history">
        <Card>
          <CardContent>
            <h3 className="font-semibold mb-4">Activity History</h3>
            <p>Your activity history will be displayed here.</p>
          </CardContent>
        </Card>
      </TabsContent>
      
      {isOwnProfile && (
        <TabsContent value="settings">
          <Card>
            <CardContent>
              <h3 className="font-semibold mb-4">Profile Settings</h3>
              <p>Manage your profile settings here.</p>
            </CardContent>
          </Card>
        </TabsContent>
      )}
    </Tabs>
  );
};

export default ProfileTabs;
