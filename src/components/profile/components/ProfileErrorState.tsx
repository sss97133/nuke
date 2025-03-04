
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ProfileErrorStateProps {
  error: string;
  onRetry: () => void;
}

export const ProfileErrorState: React.FC<ProfileErrorStateProps> = ({ 
  error, 
  onRetry 
}) => {
  return (
    <Card className="w-full border-destructive/20 bg-destructive/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          Error Loading Profile
        </CardTitle>
        <CardDescription>
          {error || "There was a problem loading your profile data"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-6">
          <p className="text-center text-muted-foreground mb-4">
            This could be due to a network issue or server problem. Please try again.
          </p>
          <Button 
            onClick={onRetry} 
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Loading Profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
