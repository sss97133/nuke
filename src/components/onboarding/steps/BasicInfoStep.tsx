import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BasicInfoStepProps {
  fullName: string;
  username: string;
  onUpdate: (field: string, value: string) => void;
}

export const BasicInfoStep = ({ fullName, username, onUpdate }: BasicInfoStepProps) => {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full Name</Label>
        <Input
          id="fullName"
          placeholder="Enter your full name"
          value={fullName}
          onChange={(e) => onUpdate('fullName', e.target.value)}
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