import React, { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserProfileHeader from "../UserProfileHeader";
import { UserMetrics } from "../UserMetrics";
import { Separator } from "@/components/ui/separator";
import { Car, Settings, Users, Award, Clock, BarChart3 } from 'lucide-react';
import { ProfileInsights } from '../ProfileInsights';
import { UserDevelopmentSpectrum } from '../UserDevelopmentSpectrum';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Profile, toSocialLinks, toStreamingLinks } from '@/types/profile';

interface ProfileContentContainerProps {
  userId: string;
  isOwnProfile: boolean;
}

export const ProfileContentContainer = ({ userId, isOwnProfile }: ProfileContentContainerProps) => {
  const [profileData, setProfileData] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userVehicles, setUserVehicles] = useState<any[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  useEffect(() => {
    const fetchProfileData = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
          
        if (error) throw error;
        
        setProfileData(data as Profile);
      } catch (error) {
        console.error('Error fetching profile data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    const fetchUserVehicles = async () => {
      setVehiclesLoading(true);
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false });
          
        if (error) throw error;
        
        setUserVehicles(data || []);
      } catch (error) {
        console.error('Error fetching user vehicles:', error);
      } finally {
        setVehiclesLoading(false);
      }
    };

    fetchProfileData();
    fetchUserVehicles();
  }, [userId]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!profileData) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p>Profile not found.</p>
        </CardContent>
      </Card>
    );
  }

  const socialLinks = toSocialLinks(profileData.social_links);
  const streamingLinks = toStreamingLinks(profileData.streaming_links);

  const profileMetrics = {
    user_type: profileData.user_type || 'viewer',
    reputation_score: profileData.reputation_score || 0,
    achievements_count: 0, // This would come from actual data
    viewer_percentile: 50, // Sample percentile
    owner_percentile: userVehicles.length > 0 ? 40 : undefined,
    technician_percentile: undefined, // Only show if user has technician skills
    investor_percentile: undefined, // Only show if user has investments
    discovery_count: userVehicles.filter(v => v.discovery_date).length
  };

  return (
    <div className="space-y-6">
      <UserProfileHeader
        userId={userId}
        fullName={profileData.full_name || ''}
        username={profileData.username || ''}
        avatarUrl={profileData.avatar_url || undefined}
        bio={profileData.bio || ''}
        isOwnProfile={isOwnProfile}
      />
      
      <UserMetrics profile={profileMetrics} />
      
      <Separator />
      
      <Tabs defaultValue="vehicles" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-6 mb-6">
          <TabsTrigger value="vehicles" className="flex items-center gap-2">
            <Car className="h-4 w-4" />
            <span className="hidden md:inline">Vehicles</span>
          </TabsTrigger>
          <TabsTrigger value="community" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden md:inline">Community</span>
          </TabsTrigger>
          <TabsTrigger value="achievements" className="flex items-center gap-2">
            <Award className="h-4 w-4" />
            <span className="hidden md:inline">Achievements</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span className="hidden md:inline">History</span>
          </TabsTrigger>
          <TabsTrigger value="insights" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden md:inline">Insights</span>
          </TabsTrigger>
          {isOwnProfile && (
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden md:inline">Settings</span>
            </TabsTrigger>
          )}
        </TabsList>
        
        <TabsContent value="vehicles">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehiclesLoading ? (
              Array(3).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-[200px]" />
              ))
            ) : userVehicles.length > 0 ? (
              userVehicles.map(vehicle => (
                <VehicleCard 
                  key={vehicle.id} 
                  vehicle={vehicle} 
                  isOwner={isOwnProfile} 
                />
              ))
            ) : (
              <div className="col-span-full text-center py-8 text-muted-foreground">
                <p>No vehicles found.</p>
                {isOwnProfile && (
                  <p className="mt-2">Start building your collection by adding your first vehicle!</p>
                )}
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="community">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Community Participation</h3>
                <p className="text-muted-foreground">
                  This section will display the user's community engagement metrics.
                </p>
              </CardContent>
            </Card>
            
            <div className="space-y-4">
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-2">Social Links</h3>
                  <div className="space-y-2">
                    {Object.entries(socialLinks).map(([platform, url]) => 
                      url ? (
                        <div key={platform} className="flex items-center justify-between">
                          <span className="capitalize">{platform}</span>
                          <a href={url.startsWith('http') ? url : `https://${url}`} 
                             target="_blank" 
                             rel="noopener noreferrer"
                             className="text-blue-600 hover:underline">
                            View
                          </a>
                        </div>
                      ) : null
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        <TabsContent value="achievements">
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">Achievements & Badges</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <p className="text-muted-foreground md:col-span-full">
                  This section will display the user's achievements and badges.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="history">
          <Card>
            <CardContent className="p-6">
              <h3 className="font-semibold mb-4">Activity History</h3>
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  This section will display the user's recent activities.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="insights">
          <div className="space-y-6">
            <ProfileInsights userId={userId} />
            <UserDevelopmentSpectrum />
          </div>
        </TabsContent>
        
        {isOwnProfile && (
          <TabsContent value="settings">
            <Card>
              <CardContent className="p-6">
                <h3 className="font-semibold mb-4">Profile Settings</h3>
                <p className="text-muted-foreground">
                  This section will allow you to configure your profile settings and preferences.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

interface VehicleCardProps {
  vehicle: any;
  isOwner: boolean;
}

const VehicleCard = ({ vehicle, isOwner }: VehicleCardProps) => {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-[16/9] bg-muted relative">
        {vehicle.image_url ? (
          <img 
            src={vehicle.image_url} 
            alt={`${vehicle.make} ${vehicle.model}`} 
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Car className="h-16 w-16 text-muted-foreground/40" />
          </div>
        )}
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold truncate">{vehicle.year} {vehicle.make} {vehicle.model}</h3>
        <p className="text-sm text-muted-foreground truncate">{vehicle.trim || 'Standard'}</p>
      </CardContent>
    </Card>
  );
};
