
import React from 'react';
import { TooltipProvider as RadixTooltipProvider } from '@radix-ui/react-tooltip';

interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
  disableHoverableContent?: boolean;
}

export const TooltipProvider: React.FC<TooltipProviderProps> = ({
  children,
  delayDuration = 300,
  skipDelayDuration = 300,
  disableHoverableContent = false
}) => {
  return (
    <RadixTooltipProvider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      disableHoverableContent={disableHoverableContent}
    >
      {children}
    </RadixTooltipProvider>
  );
};
