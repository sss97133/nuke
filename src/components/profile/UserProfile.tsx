
import React, { useState, useEffect } from 'react';
import { UserProfileHeader } from './UserProfileHeader';
import { UserMetrics } from './UserMetrics';
import { SocialLinksForm } from './SocialLinksForm';
import { StreamingLinksForm } from './StreamingLinksForm';
import { AchievementsList } from './AchievementsList';
import { TeamSection } from './TeamSection';
import { ContributionsGraph } from './ContributionsGraph';
import { UserDiscoveredVehicles } from './UserDiscoveredVehicles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, Users, Trophy, GitCommit, AlertCircle, Car } from 'lucide-react';
import { SocialLinks, StreamingLinks } from './types';
import { useProfileData } from './hooks/useProfileData';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export const UserProfile = () => {
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({
    twitter: '',
    instagram: '',
    linkedin: '',
    github: ''
  });
  const [streamingLinks, setStreamingLinks] = useState<StreamingLinks>({
    twitch: '',
    youtube: '',
    tiktok: ''
  });
  
  const { profile, achievements, isLoading, error, refetch } = useProfileData();

  // Create wrapper functions that match the expected prop types
  const handleSocialLinksChange = (links: SocialLinks) => {
    setSocialLinks(links);
  };

  const handleStreamingLinksChange = (links: StreamingLinks) => {
    setStreamingLinks(links);
  };

  const handleSocialLinksSubmit = () => {
    console.log('Submitting social links:', socialLinks);
    // Actual implementation would call API to update social links
  };

  const handleStreamingLinksSubmit = () => {
    console.log('Submitting streaming links:', streamingLinks);
    // Actual implementation would call API to update streaming links
  };

  useEffect(() => {
    if (profile?.social_links) {
      // Type guard to check if social_links is an object
      if (typeof profile.social_links === 'object' && profile.social_links !== null && !Array.isArray(profile.social_links)) {
        setSocialLinks({
          twitter: (profile.social_links as any).twitter || '',
          instagram: (profile.social_links as any).instagram || '',
          linkedin: (profile.social_links as any).linkedin || '',
          github: (profile.social_links as any).github || ''
        });
      }
    }
    if (profile?.streaming_links) {
      // Type guard to check if streaming_links is an object
      if (typeof profile.streaming_links === 'object' && profile.streaming_links !== null && !Array.isArray(profile.streaming_links)) {
        setStreamingLinks({
          twitch: (profile.streaming_links as any).twitch || '',
          youtube: (profile.streaming_links as any).youtube || '',
          tiktok: (profile.streaming_links as any).tiktok || ''
        });
      }
    }
  }, [profile]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="bg-background p-4 border rounded-lg shadow-sm">
          <div className="flex items-start gap-4 mb-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-16 w-full mt-4" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-[200px] w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error loading profile</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : "An unknown error occurred"}
          <button 
            onClick={() => refetch()} 
            className="ml-2 text-sm underline hover:text-foreground/70"
          >
            Try again
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  // Enrich profile with achievements count for UserMetrics
  const enrichedProfile = profile ? {
    ...profile,
    achievements_count: achievements?.length || 0
  } : null;

  return (
    <div className="space-y-4">
      <div className="bg-background p-4 border rounded-lg shadow-sm">
        <UserProfileHeader 
          userId={profile?.id || ''}
          fullName={profile?.full_name} 
          username={profile?.username}
          avatarUrl={profile?.avatar_url}
          bio={profile?.bio}
        />
        
        {enrichedProfile && <UserMetrics profile={enrichedProfile} />}

        {profile?.id && (
          <div className="mt-6 border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <GitCommit className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-medium">Video Analysis Contributions</h3>
            </div>
            <ContributionsGraph userId={profile.id} />
          </div>
        )}

        {profile?.id && (
          <div className="mt-6">
            <UserDiscoveredVehicles userId={profile.id} />
          </div>
        )}

        <Tabs defaultValue="profile" className="w-full mt-6">
          <TabsList>
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <UserRound className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="team" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Team
            </TabsTrigger>
            <TabsTrigger value="achievements" className="flex items-center gap-2">
              <Trophy className="w-4 h-4" />
              Achievements
            </TabsTrigger>
            <TabsTrigger value="discoveries" className="flex items-center gap-2">
              <Car className="w-4 h-4" />
              Discoveries
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-4 mt-4">
            <SocialLinksForm 
              socialLinks={socialLinks}
              onSocialLinksChange={handleSocialLinksChange}
              onSubmit={handleSocialLinksSubmit}
            />
            
            <StreamingLinksForm 
              streamingLinks={streamingLinks}
              onStreamingLinksChange={handleStreamingLinksChange}
              onSubmit={handleStreamingLinksSubmit}
            />
          </TabsContent>

          <TabsContent value="team" className="mt-4">
            <TeamSection />
          </TabsContent>

          <TabsContent value="achievements" className="mt-4">
            {achievements && achievements.length > 0 && (
              <AchievementsList achievements={achievements} />
            )}
          </TabsContent>
          
          <TabsContent value="discoveries" className="mt-4">
            {profile?.id && (
              <div className="grid gap-4">
                <p className="text-muted-foreground mb-2">
                  All vehicles you have discovered across the web and added to our database.
                </p>
                <UserDiscoveredVehicles userId={profile.id} />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default UserProfile;
