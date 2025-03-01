
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';

interface ProfileErrorStateProps {
  error: Error | unknown;
  onRetry: () => void;
}

export const ProfileErrorState = ({ error, onRetry }: ProfileErrorStateProps) => {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error loading profile</AlertTitle>
      <AlertDescription>
        {error instanceof Error ? error.message : "An unknown error occurred"}
        <button 
          onClick={onRetry} 
          className="ml-2 text-sm underline hover:text-foreground/70"
        >
          Try again
        </button>
      </AlertDescription>
    </Alert>
  );
};
