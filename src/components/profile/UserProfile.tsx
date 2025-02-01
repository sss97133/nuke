import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { UserRound, Award, Star, Trophy, Link as LinkIcon, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export const UserProfile = () => {
  const { toast } = useToast();
  const [socialLinks, setSocialLinks] = useState({
    twitter: '',
    instagram: '',
    linkedin: '',
    github: ''
  });
  const [streamingLinks, setStreamingLinks] = useState({
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

      // Initialize state with existing values
      if (data.social_links) {
        setSocialLinks(data.social_links);
      }
      if (data.streaming_links) {
        setStreamingLinks(data.streaming_links);
      }
      
      return data;
    },
  });

  const { data: achievements } = useQuery({
    queryKey: ['achievements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*')
        .order('earned_at', { ascending: false });
      
      if (error) {
        toast({
          title: 'Error loading achievements',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data;
    },
  });

  const handleSocialLinksUpdate = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ social_links: socialLinks })
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
      .update({ streaming_links: streamingLinks })
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
    <div className="space-y-6 animate-fade-in">
      <div className="bg-sidebar p-6 rounded-lg shadow-lg border border-sidebar-border">
        <div className="flex items-center gap-6 mb-8">
          <div className="bg-sidebar-primary/10 p-4 rounded-full">
            <UserRound className="w-8 h-8 text-sidebar-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-sidebar-foreground">{profile?.full_name}</h2>
            <p className="text-sidebar-foreground/60">@{profile?.username}</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-sidebar-accent p-4 rounded-lg border border-sidebar-border">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="w-5 h-5 text-sidebar-primary" />
              <span className="font-medium text-sidebar-foreground">Role</span>
            </div>
            <p className="text-sidebar-foreground/80 capitalize">{profile?.user_type}</p>
          </div>
          
          <div className="bg-sidebar-accent p-4 rounded-lg border border-sidebar-border">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-5 h-5 text-sidebar-primary" />
              <span className="font-medium text-sidebar-foreground">Reputation</span>
            </div>
            <p className="text-sidebar-foreground/80">{profile?.reputation_score} points</p>
          </div>
          
          <div className="bg-sidebar-accent p-4 rounded-lg border border-sidebar-border">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-5 h-5 text-sidebar-primary" />
              <span className="font-medium text-sidebar-foreground">Achievements</span>
            </div>
            <p className="text-sidebar-foreground/80">{achievements?.length || 0} earned</p>
          </div>
        </div>

        {/* Social Media Links Section */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <LinkIcon className="w-5 h-5 text-sidebar-primary" />
            <h3 className="text-lg font-semibold text-sidebar-foreground">Social Media Links</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Twitter URL"
              value={socialLinks.twitter}
              onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
            <Input
              placeholder="Instagram URL"
              value={socialLinks.instagram}
              onChange={(e) => setSocialLinks({ ...socialLinks, instagram: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
            <Input
              placeholder="LinkedIn URL"
              value={socialLinks.linkedin}
              onChange={(e) => setSocialLinks({ ...socialLinks, linkedin: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
            <Input
              placeholder="GitHub URL"
              value={socialLinks.github}
              onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
          </div>
          <Button 
            onClick={handleSocialLinksUpdate}
            className="mt-4 bg-sidebar-primary hover:bg-sidebar-primary/90"
          >
            Update Social Links
          </Button>
        </div>

        {/* Streaming Platform Links Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Video className="w-5 h-5 text-sidebar-primary" />
            <h3 className="text-lg font-semibold text-sidebar-foreground">Streaming Platform Links</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              placeholder="Twitch URL"
              value={streamingLinks.twitch}
              onChange={(e) => setStreamingLinks({ ...streamingLinks, twitch: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
            <Input
              placeholder="YouTube URL"
              value={streamingLinks.youtube}
              onChange={(e) => setStreamingLinks({ ...streamingLinks, youtube: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
            <Input
              placeholder="TikTok URL"
              value={streamingLinks.tiktok}
              onChange={(e) => setStreamingLinks({ ...streamingLinks, tiktok: e.target.value })}
              className="bg-sidebar-accent border-sidebar-border"
            />
          </div>
          <Button 
            onClick={handleStreamingLinksUpdate}
            className="mt-4 bg-sidebar-primary hover:bg-sidebar-primary/90"
          >
            Update Streaming Links
          </Button>
        </div>
      </div>

      {achievements && achievements.length > 0 && (
        <div className="bg-sidebar p-6 rounded-lg shadow-lg border border-sidebar-border">
          <h3 className="text-lg font-semibold mb-4 text-sidebar-foreground">Recent Achievements</h3>
          <div className="space-y-3">
            {achievements.map((achievement) => (
              <div 
                key={achievement.id} 
                className="flex items-center gap-4 p-4 bg-sidebar-accent rounded-lg border border-sidebar-border hover:border-sidebar-primary/50 transition-colors"
              >
                <Award className="w-5 h-5 text-sidebar-primary" />
                <div>
                  <p className="font-medium text-sidebar-foreground">{achievement.achievement_type}</p>
                  <p className="text-sm text-sidebar-foreground/60">
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