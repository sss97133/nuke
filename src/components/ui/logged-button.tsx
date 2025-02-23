
import React from "react";
import { Button as BaseButton, ButtonProps } from "@/components/ui/button";

interface LoggedButtonProps extends ButtonProps {
  logId?: string;
}

export const LoggedButton = React.forwardRef<HTMLButtonElement, LoggedButtonProps>(
  ({ onClick, logId, children, ...props }, ref) => {
    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      const buttonText = typeof children === 'string' ? children : logId || 'unnamed button';
      console.log(`[Button Click] ${buttonText}`);
      
      if (onClick) {
        onClick(event);
      }
    };

    return (
      <BaseButton
        ref={ref}
        onClick={handleClick}
        {...props}
      >
        {children}
      </BaseButton>
    );
  }
);

LoggedButton.displayName = "LoggedButton";

