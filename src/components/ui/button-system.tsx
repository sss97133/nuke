import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { tokens } from '@/styles/design-tokens';
import { LucideIcon } from 'lucide-react';

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 shadow-md",
        secondary: "bg-secondary-500 text-white hover:bg-secondary-600 active:bg-secondary-700 shadow-md",
        accent: "bg-accent-500 text-white hover:bg-accent-600 active:bg-accent-700 shadow-md",
        outline: "border border-neutral-300 bg-transparent hover:bg-neutral-100 active:bg-neutral-200 text-neutral-800 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800",
        ghost: "bg-transparent hover:bg-neutral-100 active:bg-neutral-200 text-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-800",
        link: "bg-transparent text-primary-500 hover:text-primary-600 active:text-primary-700 underline-offset-4 hover:underline p-0 h-auto",
        destructive: "bg-status-error text-white hover:bg-red-600 active:bg-red-700 shadow-md",
        verified: "bg-status-verified text-white hover:bg-green-600 active:bg-green-700 shadow-md",
        blockchain: "bg-status-blockchain text-white hover:bg-orange-600 active:bg-orange-700 shadow-md",
      },
      size: {
        xs: "h-7 px-2 text-xs",
        sm: "h-9 px-3 text-sm",
        md: "h-10 px-4",
        lg: "h-11 px-6 text-lg",
        xl: "h-12 px-8 text-xl",
        "2xl": "h-14 px-10 text-2xl",
        icon: "h-10 w-10 p-2",
      },
      shape: {
        default: "rounded-md",
        rounded: "rounded-full",
        square: "rounded-none",
        pill: "rounded-full px-6",
      },
      position: {
        default: "",
        // Add vehicle-centric positioning options
        timeline: "absolute right-0 -translate-y-1/2", // For timeline action buttons
        vehicleCard: "absolute bottom-3 right-3", // For vehicle card actions
        floatingAction: "fixed bottom-6 right-6 rounded-full shadow-lg z-[1500]", // Modernized floating action button
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      shape: "default",
      position: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  tooltip?: string;
  // This adds vehicle-specific context to the button, 
  // reflecting the vehicle-centric design philosophy
  vehicleContext?: {
    vehicleId?: string;
    verificationLevel?: keyof typeof tokens.verificationLevels;
    historyEvent?: boolean;
  };
}

/**
 * Modern button component with vehicle-centric design options
 * 
 * This button system is designed to work within the vehicle-centric UI,
 * with special considerations for timeline events, verification levels,
 * and vehicle-specific contexts.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    className, 
    variant, 
    size, 
    shape,
    position,
    icon, 
    iconPosition = 'left',
    loading = false, 
    tooltip,
    vehicleContext,
    children, 
    ...props 
  }, ref) => {
    // Determine if we should apply verification styling based on vehicle context
    const getVerificationVariant = () => {
      if (!vehicleContext?.verificationLevel) return variant;
      
      switch (vehicleContext.verificationLevel) {
        case 'BLOCKCHAIN':
          return 'blockchain';
        case 'PTZ_VERIFIED':
        case 'PROFESSIONAL':
          return 'verified';
        default:
          return variant;
      }
    };

    // Apply verification styling if needed
    const finalVariant = vehicleContext?.verificationLevel 
      ? getVerificationVariant() 
      : variant;

    return (
      <button
        className={cn(buttonVariants({ 
          variant: finalVariant, 
          size, 
          shape,
          position,
          className 
        }))}
        ref={ref}
        title={tooltip}
        disabled={loading || props.disabled}
        {...props}
      >
        {loading && (
          <span className="mr-2 inline-block animate-spin">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </span>
        )}

        {icon && iconPosition === 'left' && !loading && (
          <span className="mr-2">{icon}</span>
        )}
        
        {children}
        
        {icon && iconPosition === 'right' && (
          <span className="ml-2">{icon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

/**
 * Modern floating action button specifically designed for vehicle-centric actions
 * 
 * This FAB has been modernized from the original "fixed bottom-4 right-4 p-2..." style
 * to follow best practices for mobile and desktop interfaces.
 */
const VehicleActionButton = React.forwardRef<HTMLButtonElement, ButtonProps & { icon: React.ReactNode }>(
  ({ 
    className, 
    icon,
    children, 
    ...props
  }, ref) => {
    return (
      <Button
        ref={ref}
        position="floatingAction"
        size={props.size || 'lg'}
        shape="rounded"
        className={cn("flex items-center gap-2 px-4", className)}
        icon={icon}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

VehicleActionButton.displayName = "VehicleActionButton";

export { Button, VehicleActionButton, buttonVariants };
