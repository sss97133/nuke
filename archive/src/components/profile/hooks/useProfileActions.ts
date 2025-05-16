
import type { Database } from '../types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SocialLinks, StreamingLinks, toJson } from '@/types/profile';

export const useProfileActions = (refetch: () => void) => {
  const { toast } = useToast();

  const handleSocialLinksUpdate = async (socialLinks: SocialLinks) => {
    const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
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

  const handleStreamingLinksUpdate = async (streamingLinks: StreamingLinks) => {
    const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
    if (!user) return;

    const { error } = await supabase
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

  return {
    handleSocialLinksUpdate,
    handleStreamingLinksUpdate
  };
};
