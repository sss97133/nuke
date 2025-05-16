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
          'backdrop-blur-glass border border-glass transition-all',
          {
            'bg-glass-primary text-white hover:bg-glass-accent': variant === 'primary',
            'bg-glass-secondary text-white hover:bg-glass-primary': variant === 'secondary',
            'bg-glass-dark text-white hover:bg-opacity-90': variant === 'destructive',
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