
import type { Database } from '../types';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TeamMemberDisplayProps } from '@/components/team/components/TeamMemberDisplay';

export const useTeamData = () => {
  const { toast } = useToast();
  const [memberTypeFilter, setMemberTypeFilter] = useState('all');

  const { data: teamMembers, isLoading, error, refetch } = useQuery({
    queryKey: ['team-members'],
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    queryFn: async () => {
      try {
        const { data, error } = await supabase
        .from('team_members')
          .select(`
            id,
            member_type,
            department,
            position,
            start_date,
            created_at,
            updated_at,
            profile:profiles (
              id,
              username,
              full_name,
              avatar_url,
              email
            )
          `)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Supabase error:', error);
          toast({
            title: 'Error fetching team members',
            description: error.message,
            variant: 'destructive',
          });
          throw error;
        }

        return data || [];
      } catch (err) {
        console.error('Query error:', err);
        toast({
          title: 'Error fetching team members',
          description: 'Please try again later',
          variant: 'destructive',
        });
        throw err;
      }
    },
  });

  const filteredMembers = useMemo(() => {
    if (!teamMembers) return [];
    if (memberTypeFilter === 'all') return teamMembers;
    return teamMembers.filter(member => member.member_type === memberTypeFilter);
  }, [teamMembers, memberTypeFilter]);

  const memberTypeCount = useMemo(() => {
    if (!teamMembers) return {};
    return teamMembers.reduce((acc, member) => {
      acc[member.member_type] = (acc[member.member_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [teamMembers]);

  // Convert to the format expected by TeamMemberDisplay
  const formatMembersForDisplay = (members: any[]): TeamMemberDisplayProps[] => {
    return members.map(member => ({
      memberType: member.member_type,
      department: member.department,
      position: member.position,
      startDate: member.start_date,
      status: member.status,
      profile: member.profile,
      // Add additional fields for detail view
      joinedDate: member.created_at,
      skills: member.skills || [],
      bio: member.bio
    }));
  };

  return {
    teamMembers,
    filteredMembers,
    memberTypeFilter,
    setMemberTypeFilter,
    memberTypeCount,
    isLoading,
    error,
    formatMembersForDisplay,
    refetch
  };
};
