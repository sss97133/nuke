import React from 'react';
import { Card } from '@/components/ui/card';
import { UserRound, Wrench } from 'lucide-react';

interface UserTypeStepProps {
  userType: string;
  onUpdate: (type: 'viewer' | 'professional') => void;
}

export const UserTypeStep = ({ userType, onUpdate }: UserTypeStepProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        className={`p-6 cursor-pointer hover:border-primary transition-colors ${
          userType === 'viewer' ? 'border-primary' : ''
        }`}
        onClick={() => onUpdate('viewer')}
      >
        <div className="flex flex-col items-center space-y-4">
          <UserRound className="h-12 w-12" />
          <div className="text-center">
            <h3 className="font-semibold">Viewer</h3>
            <p className="text-sm text-muted-foreground">
              Watch streams and interact with content
            </p>
          </div>
        </div>
      </Card>

      <Card
        className={`p-6 cursor-pointer hover:border-primary transition-colors ${
          userType === 'professional' ? 'border-primary' : ''
        }`}
        onClick={() => onUpdate('professional')}
      >
        <div className="flex flex-col items-center space-y-4">
          <Wrench className="h-12 w-12" />
          <div className="text-center">
            <h3 className="font-semibold">Professional</h3>
            <p className="text-sm text-muted-foreground">
              Create content and offer services
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};