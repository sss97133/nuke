
import React, { useState } from 'react';
import { UserProfileHeader } from './UserProfileHeader';
import { UserMetrics } from './UserMetrics';
import { SocialLinksForm } from './SocialLinksForm';
import { StreamingLinksForm } from './StreamingLinksForm';
import { AchievementsList } from './AchievementsList';
import { TeamSection } from './TeamSection';
import { ContributionsGraph } from './ContributionsGraph';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, Users, Trophy, GitCommit } from 'lucide-react';
import { SocialLinks, StreamingLinks, toSocialLinks, toStreamingLinks } from '@/types/profile';
import { useProfileData } from './hooks/useProfileData';
import { useProfileActions } from './hooks/useProfileActions';

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
  
  const { profile, achievements, refetch } = useProfileData();
  const { handleSocialLinksUpdate, handleStreamingLinksUpdate } = useProfileActions(refetch);

  React.useEffect(() => {
    if (profile?.social_links) {
      setSocialLinks(toSocialLinks(profile.social_links));
    }
    if (profile?.streaming_links) {
      setStreamingLinks(toStreamingLinks(profile.streaming_links));
    }
  }, [profile]);

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
        
        <UserMetrics 
          userType={profile?.user_type}
          reputationScore={profile?.reputation_score}
          achievementsCount={achievements?.length || 0}
        />

        {profile?.id && (
          <div className="mt-6 border rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <GitCommit className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-medium">Video Analysis Contributions</h3>
            </div>
            <ContributionsGraph userId={profile.id} />
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
          </TabsList>

          <TabsContent value="profile" className="space-y-4 mt-4">
            <SocialLinksForm 
              socialLinks={socialLinks}
              onSocialLinksChange={setSocialLinks}
              onSubmit={() => handleSocialLinksUpdate(socialLinks)}
            />
            
            <StreamingLinksForm 
              streamingLinks={streamingLinks}
              onStreamingLinksChange={setStreamingLinks}
              onSubmit={() => handleStreamingLinksUpdate(streamingLinks)}
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
        </Tabs>
      </div>
    </div>
  );
};
