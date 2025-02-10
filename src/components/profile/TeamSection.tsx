
import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TeamMemberCard } from './TeamMemberCard';
import { Button } from '@/components/ui/button';
import { Plus, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

export const TeamSection = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Authentication required",
          description: "Please log in to view team members",
          variant: "destructive",
        });
        navigate('/login');
      }
    };
    
    checkAuth();
  }, [navigate, toast]);

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      return profile;
    },
  });

  const { data: teamMembers, isLoading, error } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          *,
          profile:profile_id (
            username,
            full_name,
            avatar_url
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        toast({
          title: 'Error fetching team members',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }

      return data;
    },
  });

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center text-muted-foreground">
          <Users className="w-6 h-6 mr-2" />
          Error loading team members
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center text-muted-foreground">
          <Users className="w-6 h-6 mr-2 animate-pulse" />
          Loading team members...
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {currentUser && (
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
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Team Members</h2>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </div>

      {teamMembers && teamMembers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teamMembers.map((member) => (
            <TeamMemberCard
              key={member.id}
              memberType={member.member_type}
              department={member.department}
              position={member.position}
              startDate={member.start_date}
              status={member.status}
              profile={member.profile}
            />
          ))}
        </div>
      ) : (
        <Card className="p-6">
          <div className="flex flex-col items-center justify-center text-muted-foreground">
            <Users className="w-12 h-12 mb-4" />
            <p>No team members found</p>
          </div>
        </Card>
      )}
    </div>
  );
};
