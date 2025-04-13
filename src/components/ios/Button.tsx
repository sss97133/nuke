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
          'font-sf-pro rounded-ios transition-colors',
          {
            'bg-ios-blue text-white hover:bg-opacity-90': variant === 'primary',
            'bg-ios-gray-6 text-ios-gray-1 hover:bg-opacity-90': variant === 'secondary',
            'bg-ios-red text-white hover:bg-opacity-90': variant === 'destructive',
            'px-4 py-2 text-sm': size === 'small',
            'px-6 py-3 text-base': size === 'medium',
            'px-8 py-4 text-lg': size === 'large',
          },
          className
        )}
        {...props}
      />
    );
  }
); 