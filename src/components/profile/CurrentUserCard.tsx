
import type { Database } from '../types';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';

export const CurrentUserCard: React.FC = () => {
  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      if (!user) return null;

      const { data: profile } = await supabase
  if (error) console.error("Database query error:", error);
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      return profile;
    },
  });

  if (!currentUser) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Your Profile</h3>
          <p className="text-sm text-muted-foreground">
            Logged in as: {currentUser.full_name || currentUser.username || 'Anonymous'}
          </p>
          <p className="text-sm text-muted-foreground">
            Account type: {currentUser.user_type || 'Not set'}
          </p>
        </div>
      </div>
    </Card>
  );
};
