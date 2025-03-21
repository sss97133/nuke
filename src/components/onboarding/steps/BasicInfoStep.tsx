
import React, { useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProfilePreview } from './ProfilePreview';

interface BasicInfoStepProps {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  avatarUrl: string;
  onUpdate: (field: string, value: string) => void;
}

export const BasicInfoStep = ({ firstName, lastName, username, email, avatarUrl, onUpdate }: BasicInfoStepProps) => {
  useEffect(() => {
    // Generate username when first or last name changes
    if (firstName || lastName) {
      const array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      const randomSuffix = (array[0] % 10000).toString().padStart(4, '0');
      const baseUsername = `${firstName.toLowerCase()}${lastName.toLowerCase()}${randomSuffix}`;
      const generatedUsername = baseUsername.replace(/[^a-z0-9]/g, '');
      onUpdate('username', generatedUsername);
    }
  }, [firstName, lastName, onUpdate]);

  return (
    <div className="space-y-4">
      <ProfilePreview
        firstName={firstName}
        lastName={lastName}
        username={username}
        email={email}
        avatarUrl={avatarUrl}
      />
      
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
        <Label htmlFor="username">Username (can be changed in settings)</Label>
        <Input
          id="username"
          placeholder="Username will be auto-generated"
          value={username}
          disabled
          className="bg-muted"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          disabled
          className="bg-muted"
        />
      </div>
    </div>
  );
};
