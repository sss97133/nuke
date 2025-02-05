import React from 'react';
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CalendarDays, Briefcase, Building2 } from 'lucide-react';

interface Profile {
  username?: string;
  full_name?: string;
  avatar_url?: string;
}

interface TeamMemberCardProps {
  memberType: string;
  department?: string;
  position?: string;
  startDate: string;
  status: string;
  profile?: Profile;
}

export const TeamMemberCard = ({
  memberType,
  department,
  position,
  startDate,
  status,
  profile
}: TeamMemberCardProps) => {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center space-x-4">
          <Avatar>
            <AvatarImage src={profile?.avatar_url} />
            <AvatarFallback>{profile?.username?.slice(0, 2).toUpperCase() || 'TM'}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <h3 className="text-lg font-semibold">{profile?.full_name || 'Team Member'}</h3>
            <p className="text-sm text-muted-foreground">{position || 'Position Not Set'}</p>
          </div>
          <Badge 
            variant={status === 'active' ? 'default' : 'secondary'}
            className="capitalize"
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Briefcase className="w-4 h-4" />
            <span className="capitalize">{memberType}</span>
          </div>
          
          {department && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="w-4 h-4" />
              <span>{department}</span>
            </div>
          )}
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="w-4 h-4" />
            <span>Started: {new Date(startDate).toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};