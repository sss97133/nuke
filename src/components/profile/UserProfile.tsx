import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { UserRound, Award, Star, Trophy, Link as LinkIcon, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface SocialLinks {
  twitter: string;
  instagram: string;
  linkedin: string;
  github: string;
}

interface StreamingLinks {
  twitch: string;
  youtube: string;
  tiktok: string;
}

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
        setSocialLinks(data.social_links as unknown as SocialLinks);
      }
      if (data?.streaming_links) {
        setStreamingLinks(data.streaming_links as unknown as StreamingLinks);
      }
      
      return data;
    },
  });

  const handleSocialLinksUpdate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ 
        social_links: socialLinks as unknown as Record<string, unknown>
      })
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
      .update({ 
        streaming_links: streamingLinks as unknown as Record<string, unknown>
      })
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
    <div className="space-y-4 font-system">
      <div className="bg-[#f3f3f3] p-4 border border-[#000066] shadow-sm">
        <div className="flex items-start gap-4 mb-6 bg-white p-3 border border-[#999]">
          <div className="bg-[#eee] p-2 border border-[#ccc]">
            <UserRound className="w-6 h-6 text-[#000066]" />
          </div>
          <div className="text-left">
            <h2 className="text-doc font-mono text-[#000066]">{profile?.full_name || 'USER_NAME_NOT_FOUND'}</h2>
            <p className="text-tiny text-[#555555] font-mono">@{profile?.username || 'username_404'}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <div className="bg-white p-3 border border-[#999]">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-[#000066]" />
              <span className="text-tiny font-mono text-[#333333]">ROLE</span>
            </div>
            <p className="text-tiny font-mono text-[#555555] uppercase">{profile?.user_type || 'N/A'}</p>
          </div>
          
          <div className="bg-white p-3 border border-[#999]">
            <div className="flex items-center gap-2 mb-2">
              <Star className="w-4 h-4 text-[#000066]" />
              <span className="text-tiny font-mono text-[#333333]">REPUTATION_PTS</span>
            </div>
            <p className="text-tiny font-mono text-[#555555]">{profile?.reputation_score || '0'}</p>
          </div>
          
          <div className="bg-white p-3 border border-[#999]">
            <div className="flex items-center gap-2 mb-2">
              <Award className="w-4 h-4 text-[#000066]" />
              <span className="text-tiny font-mono text-[#333333]">ACHIEVEMENTS</span>
            </div>
            <p className="text-tiny font-mono text-[#555555]">{achievements?.length || '0'}_TOTAL</p>
          </div>
        </div>

        <div className="mb-6 bg-white p-3 border border-[#999]">
          <div className="flex items-center gap-2 mb-3">
            <LinkIcon className="w-4 h-4 text-[#000066]" />
            <h3 className="text-tiny font-mono text-[#333333]">SOCIAL_MEDIA_LINKS</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              placeholder="TWITTER_URL"
              value={socialLinks.twitter}
              onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
            <Input
              placeholder="INSTAGRAM_URL"
              value={socialLinks.instagram}
              onChange={(e) => setSocialLinks({ ...socialLinks, instagram: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
            <Input
              placeholder="LINKEDIN_URL"
              value={socialLinks.linkedin}
              onChange={(e) => setSocialLinks({ ...socialLinks, linkedin: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
            <Input
              placeholder="GITHUB_URL"
              value={socialLinks.github}
              onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
          </div>
          <Button 
            onClick={handleSocialLinksUpdate}
            className="mt-3 bg-[#000066] hover:bg-[#000044] text-white text-tiny font-mono"
          >
            UPDATE_SOCIAL_LINKS
          </Button>
        </div>

        <div className="bg-white p-3 border border-[#999]">
          <div className="flex items-center gap-2 mb-3">
            <Video className="w-4 h-4 text-[#000066]" />
            <h3 className="text-tiny font-mono text-[#333333]">STREAMING_PLATFORM_LINKS</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              placeholder="TWITCH_URL"
              value={streamingLinks.twitch}
              onChange={(e) => setStreamingLinks({ ...streamingLinks, twitch: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
            <Input
              placeholder="YOUTUBE_URL"
              value={streamingLinks.youtube}
              onChange={(e) => setStreamingLinks({ ...streamingLinks, youtube: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
            <Input
              placeholder="TIKTOK_URL"
              value={streamingLinks.tiktok}
              onChange={(e) => setStreamingLinks({ ...streamingLinks, tiktok: e.target.value })}
              className="text-tiny font-mono bg-[#f3f3f3] border-[#999]"
            />
          </div>
          <Button 
            onClick={handleStreamingLinksUpdate}
            className="mt-3 bg-[#000066] hover:bg-[#000044] text-white text-tiny font-mono"
          >
            UPDATE_STREAMING_LINKS
          </Button>
        </div>
      </div>

      {achievements && achievements.length > 0 && (
        <div className="bg-[#f3f3f3] p-4 border border-[#000066] shadow-sm">
          <h3 className="text-tiny font-mono text-[#333333] mb-3">RECENT_ACHIEVEMENTS</h3>
          <div className="space-y-2">
            {achievements.map((achievement) => (
              <div 
                key={achievement.id} 
                className="flex items-center gap-3 p-3 bg-white border border-[#999] hover:border-[#000066] transition-colors"
              >
                <Award className="w-4 h-4 text-[#000066]" />
                <div>
                  <p className="text-tiny font-mono text-[#333333]">{achievement.achievement_type}</p>
                  <p className="text-tiny font-mono text-[#555555]">
                    {new Date(achievement.earned_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};