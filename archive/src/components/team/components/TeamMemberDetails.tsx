
import React from 'react';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CalendarDays, 
  Briefcase, 
  Building2, 
  Mail, 
  Phone,
  Clock,
  X
} from 'lucide-react';
import { TeamMemberDisplayProps } from './TeamMemberDisplay';

interface TeamMemberDetailsProps {
  member: TeamMemberDisplayProps | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TeamMemberDetails: React.FC<TeamMemberDetailsProps> = ({
  member,
  open,
  onOpenChange
}) => {
  if (!member) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex justify-between items-center">
            <DialogTitle>Team Member Details</DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <DialogDescription>
            Complete profile information
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-6">
          {/* Header with avatar and basic info */}
          <div className="flex items-start space-x-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={member.profile?.avatar_url} />
              <AvatarFallback>{member.profile?.username?.slice(0, 2).toUpperCase() || 'TM'}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">{member.profile?.full_name || 'Team Member'}</h3>
              <p className="text-sm text-muted-foreground">{member.position || 'Position Not Set'}</p>
              <div className="mt-2">
                <Badge 
                  variant={member.status === 'active' ? 'default' : 'secondary'}
                  className="capitalize"
                >
                  {member.status}
                </Badge>
              </div>
            </div>
          </div>

          {/* Contact information */}
          <div className="p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-3">Contact Information</h4>
            {member.profile?.email && (
              <div className="flex items-center gap-2 mb-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <a href={`mailto:${member.profile.email}`} className="text-sm hover:underline">
                  {member.profile.email}
                </a>
              </div>
            )}
            {member.profile?.phone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <a href={`tel:${member.profile.phone}`} className="text-sm hover:underline">
                  {member.profile.phone}
                </a>
              </div>
            )}
          </div>

          {/* Professional information */}
          <div className="space-y-3">
            <h4 className="font-medium">Professional Information</h4>
            
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              <span className="capitalize text-sm">{member.memberType}</span>
            </div>
            
            {member.department && (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{member.department}</span>
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">Started: {new Date(member.startDate).toLocaleDateString()}</span>
            </div>

            {member.joinedDate && (
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">Joined team: {new Date(member.joinedDate).toLocaleDateString()}</span>
              </div>
            )}
          </div>

          {/* Skills and expertise */}
          {member.skills && member.skills.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Skills & Expertise</h4>
              <div className="flex flex-wrap gap-2">
                {member.skills.map((skill, index) => (
                  <Badge key={index} variant="outline">{skill}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Bio or additional notes */}
          {member.bio && (
            <div>
              <h4 className="font-medium mb-2">About</h4>
              <p className="text-sm text-muted-foreground">{member.bio}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
