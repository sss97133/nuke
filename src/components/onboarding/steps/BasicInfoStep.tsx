
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BasicInfoStepProps {
  firstName: string;
  lastName: string;
  username: string;
  onUpdate: (field: string, value: string) => void;
}

export const BasicInfoStep = ({ firstName, lastName, username, onUpdate }: BasicInfoStepProps) => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name</Label>
        <Input
          id="firstName"
          placeholder="Enter your first name"
          value={firstName}
          onChange={(e) => onUpdate('firstName', e.target.value)}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name</Label>
        <Input
          id="lastName"
          placeholder="Enter your last name"
          value={lastName}
          onChange={(e) => onUpdate('lastName', e.target.value)}
        />
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          placeholder="Choose a username"
          value={username}
          onChange={(e) => onUpdate('username', e.target.value)}
        />
      </div>
    </div>
  );
};

