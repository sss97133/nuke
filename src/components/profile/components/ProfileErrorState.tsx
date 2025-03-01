
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from 'lucide-react';

interface ProfileErrorStateProps {
  error: Error | unknown;
  onRetry: () => void;
}

export const ProfileErrorState = ({ error, onRetry }: ProfileErrorStateProps) => {
  const errorMessage = error instanceof Error 
    ? error.message 
    : "An unknown error occurred";
    
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error loading profile</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{errorMessage}</span>
        <button 
          onClick={onRetry} 
          className="self-start mt-2 text-sm underline hover:text-foreground/70"
        >
          Try again
        </button>
      </AlertDescription>
    </Alert>
  );
};
