
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import VehicleCollection from './VehicleCollection';
import VehicleRelationshipsSection from './VehicleRelationshipsSection';

interface ProfileTabsProps {
  userId: string;
  isOwnProfile: boolean;
}

// Sample skill data with correct type
const skillsData = [
  { name: "Restoration", value: 85, color: "#3498db", percentile: 92 },
  { name: "Diagnostics", value: 70, color: "#2ecc71", percentile: 78 },
  { name: "Modification", value: 65, color: "#f39c12", percentile: 65 },
  { name: "Paint & Body", value: 60, color: "#9b59b6", percentile: 55 },
  { name: "Maintenance", value: 90, color: "#1abc9c", percentile: 97 },
];

interface ProfileInsightsProps {
  userId: string;
}

const ProfileInsights: React.FC<ProfileInsightsProps> = ({ userId }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile Insights</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Profile insights coming soon...</p>
      </CardContent>
    </Card>
  );
};

interface UserDevelopmentSpectrumProps {
  userId: string;
  categories: string[];
}

const UserDevelopmentSpectrum: React.FC<UserDevelopmentSpectrumProps> = ({ userId, categories }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Development Spectrum</CardTitle>
      </CardHeader>
      <CardContent>
        <p>Development spectrum visualization coming soon...</p>
        <ul>
          {categories.map(category => (
            <li key={category}>{category}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

const ProfileTabs: React.FC<ProfileTabsProps> = ({ userId, isOwnProfile }) => {
  return (
    <Tabs defaultValue="vehicles" className="space-y-4">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        <TabsTrigger value="relationships">Relationships</TabsTrigger>
        <TabsTrigger value="insights">Insights</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      
      <TabsContent value="vehicles">
        <VehicleCollection 
          userId={userId} 
          isOwnProfile={isOwnProfile} 
        />
      </TabsContent>
      
      <TabsContent value="relationships">
        <VehicleRelationshipsSection userId={userId} />
      </TabsContent>
      
      <TabsContent value="insights">
        <div className="grid gap-4 md:grid-cols-2">
          <ProfileInsights userId={userId} />
          <UserDevelopmentSpectrum 
            userId={userId} 
            categories={["Mechanical", "Electrical", "Fabrication", "Design"]} 
          />
        </div>
      </TabsContent>
      
      <TabsContent value="activity">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-8">
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No recent activity to display
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
};

export default ProfileTabs;
