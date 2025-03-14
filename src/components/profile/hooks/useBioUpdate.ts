
import type { Database } from '../types';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export const useBioUpdate = (userId: string) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();

  const updateBio = async (bio: string) => {
    try {
      setIsUpdating(true);
      const { error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('profiles')
        .update({ bio })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: 'Bio updated',
        description: 'Your profile bio has been updated successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error updating bio',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    isUpdating,
    updateBio
  };
};
