
import React from 'react';
import { FileText } from 'lucide-react';
import { Card, CardContent } from "@/components/ui/card";
import { CertificationHeader } from './card/CertificationHeader';
import { CertificationProgress } from './card/CertificationProgress';
import { CertificationActions } from './card/CertificationActions';
import { CertificationMetrics } from './card/CertificationMetrics';

interface CertificationCardProps {
  name: string;
  description: string;
  issuingAuthority: string;
  status: 'pending' | 'in_progress' | 'completed' | 'expired';
  progress?: number;
  expiresAt?: string;
  isGhostMode?: boolean;
  skillScore?: number;
  forks?: number;
  contributors?: number;
}

export const CertificationCard = ({
  name,
  description,
  issuingAuthority,
  status,
  progress = 0,
  expiresAt,
  isGhostMode = false,
  skillScore = 0,
  forks = 0,
  contributors = 0,
}: CertificationCardProps) => {
  const [likes, setLikes] = React.useState(Math.floor(Math.random() * 100));
  const [viewers] = React.useState(Math.floor(Math.random() * 50));

  const handleLike = () => {
    setLikes(prev => prev + 1);
    toast({
      title: "Skill Appreciated!",
      description: "Your support helps motivate skilled professionals.",
    });
  };

  return (
    <Card className="w-full hover:shadow-lg transition-shadow">
      <CertificationHeader
        name={name}
        issuingAuthority={issuingAuthority}
        status={status}
        isGhostMode={isGhostMode}
      />
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isGhostMode 
              ? "This professional prefers to remain anonymous while sharing their expertise." 
              : description}
          </p>
          
          {status === 'in_progress' && progress && (
            <CertificationProgress progress={progress} />
          )}
          
          {!isGhostMode && (
            <>
              <CertificationActions
                likes={likes}
                forks={forks}
                contributors={contributors}
                onLike={handleLike}
              />
              
              <CertificationMetrics
                viewers={viewers}
                skillScore={skillScore}
              />
            </>
          )}
          
          {expiresAt && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="w-4 h-4" />
              <span>Expires: {new Date(expiresAt).toLocaleDateString()}</span>
            </div>
          )}
          
          <div className="flex items-center gap-2 mt-4">
            <span className={`px-2 py-1 text-xs rounded-full ${
              status === 'completed' ? 'bg-green-100 text-green-800' :
              status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
              status === 'expired' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
            </span>
            {status === 'completed' && (
              <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">
                +100 Points
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
