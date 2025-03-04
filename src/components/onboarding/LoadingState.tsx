
import React from 'react';

export const OnboardingLoadingState: React.FC = () => {
  return (
    <div className="container max-w-4xl mx-auto p-6 min-h-[80vh] flex flex-col items-center justify-center">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Setting up your experience</h1>
        <p className="text-muted-foreground">Just a moment while we load your information...</p>
      </div>
      <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
    </div>
  );
};
