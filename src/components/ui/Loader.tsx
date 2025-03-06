import React from 'react';
import { cn } from '@/utils/cn';

type LoaderSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
type LoaderVariant = 'primary' | 'secondary' | 'ghost' | 'light';

interface LoaderProps {
  /** Controls the size of the loader */
  size?: LoaderSize;
  /** Controls the visual style of the loader */
  variant?: LoaderVariant;
  /** Optional text to display beneath the loader */
  text?: string;
  /** Whether to center the loader in its container */
  centered?: boolean;
  /** Whether to take up full width of the container */
  fullWidth?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Loader component displays a loading spinner with optional text.
 * It can be customized with different sizes, variants, and positioning.
 * 
 * @example
 * ```tsx
 * // Basic usage
 * <Loader />
 * 
 * // With text and custom size
 * <Loader size="lg" text="Loading data..." />
 * 
 * // Centered in container with custom variant
 * <Loader centered variant="secondary" />
 * ```
 */
export function Loader({
  size = 'md',
  variant = 'primary',
  text,
  centered = false,
  fullWidth = false,
  className,
}: LoaderProps) {
  // Maps size to CSS classes
  const sizeClasses = {
    xs: 'h-4 w-4 border-2',
    sm: 'h-6 w-6 border-2',
    md: 'h-8 w-8 border-2',
    lg: 'h-12 w-12 border-3',
    xl: 'h-16 w-16 border-4',
  };

  // Maps variant to CSS classes
  const variantClasses = {
    primary: 'border-primary/30 border-t-primary',
    secondary: 'border-secondary/30 border-t-secondary',
    ghost: 'border-gray-300/30 border-t-gray-300',
    light: 'border-white/30 border-t-white',
  };

  // Text size based on loader size
  const textSizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    md: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
  };

  return (
    <div 
      className={cn(
        'flex flex-col items-center',
        centered && 'justify-center w-full h-full',
        fullWidth && 'w-full',
        className
      )}
    >
      <div
        className={cn(
          'animate-spin rounded-full border-solid',
          sizeClasses[size],
          variantClasses[variant]
        )}
      />
      
      {text && (
        <span 
          className={cn(
            'mt-2 text-gray-600 dark:text-gray-300',
            textSizeClasses[size]
          )}
        >
          {text}
        </span>
      )}
    </div>
  );
}

/**
 * PageLoader component displays a centered loader with optional text.
 * It takes up the full viewport and is ideal for page transitions.
 */
export function PageLoader({ text, variant = 'primary' }: { text?: string; variant?: LoaderVariant }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-50">
      <Loader size="xl" text={text} variant={variant} />
    </div>
  );
}

/**
 * ButtonLoader component displays a small loader inside buttons.
 */
export function ButtonLoader({ className }: { className?: string }) {
  return <Loader size="xs" className={className} />;
}

export default Loader;
