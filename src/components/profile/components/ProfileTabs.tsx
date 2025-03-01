
import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, Users, Trophy, GitCommit, Car } from 'lucide-react';
import { SocialLinksForm } from '../SocialLinksForm';
import { StreamingLinksForm } from '../StreamingLinksForm';
import { TeamSection } from '../TeamSection';
import { AchievementsList } from '../AchievementsList';
import { UserDiscoveredVehicles } from '../UserDiscoveredVehicles';
import { SocialLinks, StreamingLinks, Achievement } from '../types';

interface ProfileTabsProps {
  userId: string;
  socialLinks: SocialLinks;
  streamingLinks: StreamingLinks;
  achievements: Achievement[] | null;
  onSocialLinksChange: (links: SocialLinks) => void;
  onStreamingLinksChange: (links: StreamingLinks) => void;
  onSocialLinksSubmit: () => void;
  onStreamingLinksSubmit: () => void;
}

export const ProfileTabs = ({
  userId,
  socialLinks,
  streamingLinks,
  achievements,
  onSocialLinksChange,
  onStreamingLinksChange,
  onSocialLinksSubmit,
  onStreamingLinksSubmit
}: ProfileTabsProps) => {
  return (
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
          onSocialLinksChange={onSocialLinksChange}
          onSubmit={onSocialLinksSubmit}
        />
        
        <StreamingLinksForm 
          streamingLinks={streamingLinks}
          onStreamingLinksChange={onStreamingLinksChange}
          onSubmit={onStreamingLinksSubmit}
        />
      </TabsContent>

      <TabsContent value="team" className="mt-4">
        <TeamSection />
      </TabsContent>

      <TabsContent value="achievements" className="mt-4">
        {achievements && achievements.length > 0 ? (
          <AchievementsList achievements={achievements} />
        ) : (
          <div className="text-center p-4 border rounded-lg">
            <Trophy className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No achievements yet</p>
          </div>
        )}
      </TabsContent>
      
      <TabsContent value="discoveries" className="mt-4">
        {userId && (
          <div className="grid gap-4">
            <p className="text-muted-foreground mb-2">
              All vehicles you have discovered across the web and added to our database.
            </p>
            <UserDiscoveredVehicles userId={userId} />
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
};
