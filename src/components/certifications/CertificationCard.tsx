import React from 'react';
import { BadgeCheck, Clock, FileText, Star, Trophy, TrendingUp, Users, Heart, GitFork, GitPullRequest, Eye, EyeOff } from 'lucide-react';
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

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
  const { toast } = useToast();
  const [likes, setLikes] = React.useState(Math.floor(Math.random() * 100));
  const [viewers, setViewers] = React.useState(Math.floor(Math.random() * 50));

  const handleSponsor = () => {
    toast({
      title: "Sponsorship Request",
      description: "Thank you for your interest! Sponsorship feature coming soon.",
    });
  };

  const handleFork = () => {
    toast({
      title: "Fork Certification",
      description: "Creating a new branch of this certification path...",
    });
  };

  const handleContribute = () => {
    toast({
      title: "Contribute",
      description: "Opening contribution guidelines...",
    });
  };

  const handleLike = () => {
    setLikes(prev => prev + 1);
    toast({
      title: "Skill Appreciated!",
      description: "Your support helps motivate skilled professionals.",
    });
  };

  return (
    <Card className="w-full hover:shadow-lg transition-shadow">
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
      <CardContent>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isGhostMode ? "This professional prefers to remain anonymous while sharing their expertise." : description}
          </p>
          
          {status === 'in_progress' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center mt-1">
                Keep going! You're making great progress
              </p>
            </div>
          )}
          
          {!isGhostMode && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={handleLike}
                  >
                    <Heart className="w-4 h-4" />
                    {likes}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={handleFork}
                  >
                    <GitFork className="w-4 h-4" />
                    {forks}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={handleContribute}
                  >
                    <GitPullRequest className="w-4 h-4" />
                    {contributors}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSponsor}
                >
                  Sponsor
                </Button>
              </div>
              
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