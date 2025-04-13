import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive';
  size?: 'small' | 'medium' | 'large';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'medium', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'font-inter rounded-figma transition-colors',
          {
            'bg-figma-blue text-white hover:bg-opacity-90': variant === 'primary',
            'bg-figma-gray-200 text-figma-gray-900 hover:bg-opacity-90': variant === 'secondary',
            'bg-figma-red text-white hover:bg-opacity-90': variant === 'destructive',
            'px-3 py-1.5 text-sm': size === 'small',
            'px-4 py-2 text-base': size === 'medium',
            'px-6 py-3 text-lg': size === 'large',
          },
          className
        )}
        {...props}
      />
    );
  }
); 