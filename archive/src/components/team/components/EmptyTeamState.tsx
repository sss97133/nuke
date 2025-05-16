
import React from 'react';
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LucideIcon, Users, UserPlus } from 'lucide-react';

interface EmptyTeamStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  onAddMember: () => void;
  buttonText?: string;
}

export const EmptyTeamState: React.FC<EmptyTeamStateProps> = ({
  icon = <Users className="w-12 h-12 mb-4" />,
  title,
  description,
  onAddMember,
  buttonText = "Add Team Member"
}) => {
  return (
    <Card className="p-6">
      <div className="flex flex-col items-center justify-center text-muted-foreground py-8">
        {icon}
        <p>{title}</p>
        <p className="text-sm mt-2">{description}</p>
        <Button 
          variant="outline" 
          className="mt-4"
          onClick={onAddMember}
        >
          <UserPlus className="w-4 h-4 mr-2" />
          {buttonText}
        </Button>
      </div>
    </Card>
  );
};
