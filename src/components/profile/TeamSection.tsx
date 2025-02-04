import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TeamMemberCard } from './TeamMemberCard';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export const TeamSection = () => {
  const { toast } = useToast();
  
  const { data: teamMembers, isLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select(`
          *,
          profiles:profile_id (
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

  if (isLoading) {
    return <div>Loading team members...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Team Members</h2>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teamMembers?.map((member) => (
          <TeamMemberCard
            key={member.id}
            memberType={member.member_type}
            department={member.department}
            position={member.position}
            startDate={member.start_date}
            status={member.status}
          />
        ))}
      </div>
    </div>
  );
};