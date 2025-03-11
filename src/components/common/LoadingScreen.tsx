import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
  fullScreen?: boolean;
  className?: string;
}

/**
 * Enhanced LoadingScreen component with additional options for flexibility
 * - fullScreen: Controls whether to take up the full viewport height
 * - className: Additional CSS classes
 * - message: Optional loading message text
 */
export const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  message = 'Loading...',
  fullScreen = true,
  className = ''
}) => {
  return (
    <div 
      className={`
        flex items-center justify-center 
        ${fullScreen ? 'h-screen' : 'h-full min-h-[200px]'} 
        ${className}
      `}
    >
      <div className="flex flex-col items-center p-4 animate-fade-in">
        <div className="relative">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <div className="absolute inset-0 blur-sm bg-primary/10 rounded-full animate-pulse"></div>
        </div>
        
        {message && (
          <p className="mt-4 text-foreground/80 animate-pulse font-medium">
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * Inline loading spinner for use within components
 */
export const InlineLoader: React.FC<{ size?: number; className?: string }> = ({ 
  size = 16, 
  className = '' 
}) => (
  <Loader2 
    className={`animate-spin text-primary inline-block ${className}`} 
    style={{ width: size, height: size }} 
  />
);

export default LoadingScreen;
