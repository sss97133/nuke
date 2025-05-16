
import React from 'react';
import { Users, Star } from 'lucide-react';

interface CertificationMetricsProps {
  viewers: number;
  skillScore: number;
}

export const CertificationMetrics: React.FC<CertificationMetricsProps> = ({
  viewers,
  skillScore,
}) => {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4" />
        {viewers} watching
      </div>
      <div className="flex items-center gap-2">
        <Star className="w-4 h-4" />
        Skill Score: {skillScore}
      </div>
    </div>
  );
};
