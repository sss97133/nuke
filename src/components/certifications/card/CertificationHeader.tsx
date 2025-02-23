
import React from 'react';
import { BadgeCheck, Eye, EyeOff, Trophy, Clock, TrendingUp } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface CertificationHeaderProps {
  name: string;
  issuingAuthority: string;
  status: 'pending' | 'in_progress' | 'completed' | 'expired';
  isGhostMode: boolean;
}

export const CertificationHeader: React.FC<CertificationHeaderProps> = ({
  name,
  issuingAuthority,
  status,
  isGhostMode,
}) => {
  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg font-semibold">
            {isGhostMode ? `Anonymous_${Math.floor(Math.random() * 1000)}` : name}
          </CardTitle>
          {status === 'completed' && (
            <Badge variant="default" className="bg-green-500">
              Verified
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isGhostMode ? (
            <EyeOff className="w-4 h-4 text-muted-foreground" />
          ) : (
            <Eye className="w-4 h-4 text-muted-foreground" />
          )}
          {status === 'completed' && (
            <>
              <BadgeCheck className="w-6 h-6 text-green-500" />
              <Trophy className="w-6 h-6 text-yellow-500" />
            </>
          )}
          {status === 'in_progress' && (
            <>
              <Clock className="w-6 h-6 text-blue-500 animate-pulse" />
              <TrendingUp className="w-6 h-6 text-blue-500" />
            </>
          )}
        </div>
      </div>
      <CardDescription className="flex items-center gap-2">
        <Star className="w-4 h-4 text-yellow-500" />
        {isGhostMode ? "Verified Professional" : issuingAuthority}
      </CardDescription>
    </CardHeader>
  );
};
