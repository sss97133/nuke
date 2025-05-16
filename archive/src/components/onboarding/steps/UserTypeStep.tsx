
import React from 'react';
import { Card } from '@/components/ui/card';
import { UserRound, Briefcase } from 'lucide-react';

interface UserTypeStepProps {
  userType: string;
  onUpdate: (type: 'viewer' | 'professional') => void;
}

export const UserTypeStep = ({ userType, onUpdate }: UserTypeStepProps) => {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2 mb-6">
        <h3 className="text-lg font-semibold">How will you use the platform?</h3>
        <p className="text-muted-foreground">
          Choose the option that best describes you. Don't worry, you can always change this later.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card
          className={`p-6 cursor-pointer hover:border-primary transition-colors ${
            userType === 'viewer' ? 'border-primary' : ''
          }`}
          onClick={() => onUpdate('viewer')}
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <UserRound className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Personal User</h3>
              <p className="text-sm text-muted-foreground">
                I want to browse content, follow projects, and connect with automotive professionals
              </p>
              <ul className="text-sm text-left space-y-2 mt-4">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Browse automotive content
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Follow interesting projects
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Connect with professionals
                </li>
              </ul>
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
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Briefcase className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-lg">Professional</h3>
              <p className="text-sm text-muted-foreground">
                I represent a business or offer professional automotive services
              </p>
              <ul className="text-sm text-left space-y-2 mt-4">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Showcase your services
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Connect with customers
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Access business tools
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full" />
                  Manage team members
                </li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
