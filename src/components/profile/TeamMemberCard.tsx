import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Briefcase, Building2 } from 'lucide-react';

interface TeamMemberCardProps {
  memberType: string;
  department?: string;
  position?: string;
  startDate: string;
  status: string;
}

export const TeamMemberCard = ({
  memberType,
  department,
  position,
  startDate,
  status
}: TeamMemberCardProps) => {
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold capitalize">{position || 'Team Member'}</CardTitle>
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