import React from 'react';
import { cn } from '@/lib/utils';
import { FloatingActionButton } from './floating-action-button';
import { tokens } from '@/styles/design-tokens';

/**
 * Modern Action Button
 * 
 * A direct replacement for outdated UI elements with classes like:
 * "fixed bottom-4 right-4 p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg"
 * 
 * This component implements modern design principles and provides better accessibility,
 * animations, and visual hierarchy while maintaining the vehicle-centric design philosophy.
 */
export function ModernActionButton({
  icon,
  label,
  onClick,
  className,
  ...props
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  [key: string]: any;
}) {
  return (
    <FloatingActionButton
      icon={icon}
      label={label}
      variant="primary"
      position="bottom-right" 
      showLabel={false}
      tooltip={label}
      className={cn(
        "animate-fade-in motion-reduce:animate-none hover:bg-primary-600 active:bg-primary-700",
        className
      )}
      onClick={onClick}
      {...props}
    />
  );
}

/**
 * Usage example for replacing old buttons:
 * 
 * Before:
 * <button 
 *   className="fixed bottom-4 right-4 p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg"
 *   onClick={handleClick}
 * >
 *   <svg>...</svg>
 * </button>
 * 
 * After:
 * <ModernActionButton
 *   icon={<svg>...</svg>}
 *   label="Add Vehicle"
 *   onClick={handleClick}
 * />
 */
