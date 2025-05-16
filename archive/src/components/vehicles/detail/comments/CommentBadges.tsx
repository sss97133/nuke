
import React from 'react';
import { Badge } from "@/components/ui/badge";
import { UserCheck, Star, Lock } from "lucide-react";

export const VerificationBadge = ({ level }: { level: 'none' | 'basic' | 'expert' | 'owner' }) => {
  if (level === 'none') return null;
  
  const colors: Record<string, string> = {
    basic: 'bg-blue-500',
    expert: 'bg-purple-500',
    owner: 'bg-green-500'
  };
  
  const titles: Record<string, string> = {
    basic: 'Verified User',
    expert: 'Verified Expert',
    owner: 'Vehicle Owner'
  };
  
  return (
    <Badge variant="outline" className={`ml-2 ${colors[level]} text-white`}>
      <UserCheck className="h-3 w-3 mr-1" />
      {titles[level]}
    </Badge>
  );
};

export const InfluencerBadge = () => (
  <Badge variant="outline" className="ml-2 bg-yellow-500 text-white">
    <Star className="h-3 w-3 mr-1" />
    Influencer
  </Badge>
);

export const PrivateBadge = () => (
  <Badge variant="outline" className="ml-2 bg-gray-700 text-white">
    <Lock className="h-3 w-3 mr-1" />
    Private
  </Badge>
);
