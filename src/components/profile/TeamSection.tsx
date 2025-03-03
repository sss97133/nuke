
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Users } from 'lucide-react';
import { CurrentUserCard } from './CurrentUserCard';
import { TeamSectionHeader } from './TeamSectionHeader';
import { TeamTabs } from './TeamTabs';
import { useTeamData } from './hooks/useTeamData';
import { getEmptyStateForType } from './utils/emptyStateUtils';

export const TeamSection = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const { 
    teamMembers,
    filteredMembers,
    memberTypeFilter, 
    setMemberTypeFilter,
    memberTypeCount,
    isLoading,
    error,
    formatMembersForDisplay
  } = useTeamData();
  
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

  const handleAddMember = () => {
    navigate('/team-members');
  };

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

  const formattedMembers = formatMembersForDisplay(filteredMembers);

  return (
    <div className="space-y-6">
      <CurrentUserCard />
      <TeamSectionHeader onAddMember={handleAddMember} />
      <TeamTabs 
        memberTypeFilter={memberTypeFilter}
        setMemberTypeFilter={setMemberTypeFilter}
        memberTypeCount={{...memberTypeCount, all: teamMembers?.length || 0}}
        filteredMembers={formattedMembers}
        getEmptyStateForType={(type) => getEmptyStateForType(type, handleAddMember)}
      />
    </div>
  );
};
