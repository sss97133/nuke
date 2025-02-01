import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { UserRound, Award, Star, Trophy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export const UserProfile = () => {
  const { toast } = useToast();
  
  const { data: profile } = useQuery({
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