import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { UserProfileHeader } from './UserProfileHeader';
import { UserMetrics } from './UserMetrics';
import { SocialLinksForm } from './SocialLinksForm';
import { StreamingLinksForm } from './StreamingLinksForm';
import { AchievementsList } from './AchievementsList';
import { TeamSection } from './TeamSection';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, Users, Trophy } from 'lucide-react';
import { SocialLinks, StreamingLinks, toSocialLinks, toStreamingLinks, toJson } from '@/types/profile';

export const UserProfile = () => {
  const { toast } = useToast();
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
  
  const { data: profile, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (error) {
        toast({
          title: 'Error loading profile',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }

      if (data?.social_links) {
        setSocialLinks(toSocialLinks(data.social_links));
      }
      if (data?.streaming_links) {
        setStreamingLinks(toStreamingLinks(data.streaming_links));
      }
      
      return data;
    },
  });

  const { data: achievements } = useQuery({
    queryKey: ['achievements'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*')
        .eq('user_id', user.id)
        .order('earned_at', { ascending: false });
      
      if (error) {
        toast({
          title: 'Error loading achievements',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data || [];
    },
  });

  const handleSocialLinksUpdate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ social_links: toJson(socialLinks) })
      .eq('id', user.id);

    if (error) {
      toast({
        title: 'Error updating social links',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Social links updated',
      description: 'Your social media links have been updated successfully.',
    });
    refetch();
  };

  const handleStreamingLinksUpdate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ streaming_links: toJson(streamingLinks) })
      .eq('id', user.id);

    if (error) {
      toast({
        title: 'Error updating streaming links',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Streaming links updated',
      description: 'Your streaming platform links have been updated successfully.',
    });
    refetch();
  };

  return (
    <div className="space-y-4">
      <div className="bg-background p-4 border rounded-lg shadow-sm">
        <UserProfileHeader 
          fullName={profile?.full_name} 
          username={profile?.username} 
        />
        
        <UserMetrics 
          userType={profile?.user_type}
          reputationScore={profile?.reputation_score}
          achievementsCount={achievements?.length || 0}
        />

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
              onSubmit={handleSocialLinksUpdate}
            />
            
            <StreamingLinksForm 
              streamingLinks={streamingLinks}
              onStreamingLinksChange={setStreamingLinks}
              onSubmit={handleStreamingLinksUpdate}
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