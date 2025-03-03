
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { UserPlus, Users, Building2, Wrench, UserCog } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TeamMemberGrid } from '@/components/team/components/TeamMemberGrid';
import { EmptyTeamState } from '@/components/team/components/EmptyTeamState';
import { TeamMemberDisplayProps } from '@/components/team/components/TeamMemberDisplay';

export const TeamSection = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [memberTypeFilter, setMemberTypeFilter] = useState('all');
  
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

  const filteredMembers = React.useMemo(() => {
    if (!teamMembers) return [];
    if (memberTypeFilter === 'all') return teamMembers;
    return teamMembers.filter(member => member.member_type === memberTypeFilter);
  }, [teamMembers, memberTypeFilter]);

  const memberTypeCount = React.useMemo(() => {
    if (!teamMembers) return {};
    return teamMembers.reduce((acc, member) => {
      acc[member.member_type] = (acc[member.member_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [teamMembers]);

  const handleAddMember = () => {
    navigate('/team-members');
  };

  // Convert to the format expected by TeamMemberDisplay
  const formatMembersForDisplay = (members: any[]): TeamMemberDisplayProps[] => {
    return members.map(member => ({
      memberType: member.member_type,
      department: member.department,
      position: member.position,
      startDate: member.start_date,
      status: member.status,
      profile: member.profile
    }));
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

  const getEmptyStateForType = (type: string) => {
    switch (type) {
      case 'technician':
        return (
          <EmptyTeamState
            icon={<Wrench className="w-12 h-12 mb-4" />}
            title="No technicians added yet"
            description="Add technicians who work on your vehicles"
            onAddMember={handleAddMember}
            buttonText="Add Technician"
          />
        );
      case 'garage':
        return (
          <EmptyTeamState
            icon={<Building2 className="w-12 h-12 mb-4" />}
            title="No garages added yet"
            description="Connect with service centers and repair shops"
            onAddMember={handleAddMember}
            buttonText="Add Garage"
          />
        );
      case 'consultant':
        return (
          <EmptyTeamState
            icon={<UserCog className="w-12 h-12 mb-4" />}
            title="No consultants added yet"
            description="Add specialized advisors for your vehicle projects"
            onAddMember={handleAddMember}
            buttonText="Add Consultant"
          />
        );
      default:
        return (
          <EmptyTeamState
            title="No team members found"
            description="Add team members to collaborate on your vehicle projects"
            onAddMember={handleAddMember}
          />
        );
    }
  };

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
        <Button onClick={handleAddMember}>
          <UserPlus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </div>

      <Tabs defaultValue="all" onValueChange={setMemberTypeFilter}>
        <TabsList>
          <TabsTrigger value="all">
            All ({teamMembers?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="technician">
            Technicians ({memberTypeCount['technician'] || 0})
          </TabsTrigger>
          <TabsTrigger value="garage">
            Garages ({memberTypeCount['garage'] || 0})
          </TabsTrigger>
          <TabsTrigger value="consultant">
            Consultants ({memberTypeCount['consultant'] || 0})
          </TabsTrigger>
          <TabsTrigger value="other">
            Other ({memberTypeCount['other'] || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <TeamMemberGrid 
            members={formatMembersForDisplay(filteredMembers)}
            emptyState={getEmptyStateForType('all')}
          />
        </TabsContent>
        
        <TabsContent value="technician">
          <TeamMemberGrid 
            members={formatMembersForDisplay(filteredMembers)}
            emptyState={getEmptyStateForType('technician')}
          />
        </TabsContent>
        
        <TabsContent value="garage">
          <TeamMemberGrid 
            members={formatMembersForDisplay(filteredMembers)}
            emptyState={getEmptyStateForType('garage')}
          />
        </TabsContent>
        
        <TabsContent value="consultant">
          <TeamMemberGrid 
            members={formatMembersForDisplay(filteredMembers)}
            emptyState={getEmptyStateForType('consultant')}
          />
        </TabsContent>
        
        <TabsContent value="other">
          <TeamMemberGrid 
            members={formatMembersForDisplay(filteredMembers)}
            emptyState={getEmptyStateForType('other')}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
