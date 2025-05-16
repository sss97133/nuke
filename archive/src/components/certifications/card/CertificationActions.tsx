
import React from 'react';
import { Heart, GitFork, GitPullRequest } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface CertificationActionsProps {
  likes: number;
  forks: number;
  contributors: number;
  onLike: () => void;
}

export const CertificationActions: React.FC<CertificationActionsProps> = ({
  likes,
  forks,
  contributors,
  onLike,
}) => {
  const { toast } = useToast();

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

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="sm"
          className="flex items-center gap-2"
          onClick={onLike}
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
        onClick={() => {
          toast({
            title: "Sponsorship Request",
            description: "Thank you for your interest! Sponsorship feature coming soon.",
          });
        }}
      >
        Sponsor
      </Button>
    </div>
  );
};
