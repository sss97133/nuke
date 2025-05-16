import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button-system';
import { Tooltip } from '@/components/ui/tooltip';

export interface FloatingActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label?: string;
  variant?: 'primary' | 'secondary' | 'accent' | 'destructive' | 'verified';
  size?: 'md' | 'lg' | 'xl';
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';
  showLabel?: boolean;
  tooltip?: string;
  className?: string;
  onClick?: () => void;
}

/**
 * Modern Floating Action Button
 * 
 * A replacement for the outdated fixed positioning button, designed with 
 * modern UI principles and vehicle-centric UX focus.
 */
export function FloatingActionButton({
  icon,
  label,
  variant = 'primary',
  size = 'lg',
  position = 'bottom-right',
  showLabel = false,
  tooltip,
  className,
  onClick,
  ...props
}: FloatingActionButtonProps) {
  const positionClasses = {
    'bottom-right': 'fixed bottom-6 right-6',
    'bottom-left': 'fixed bottom-6 left-6',
    'top-right': 'fixed top-6 right-6',
    'top-left': 'fixed top-6 left-6',
    'bottom-center': 'fixed bottom-6 left-1/2 -translate-x-1/2',
  };
  
  const sizeClasses = {
    'md': 'h-12 w-12',
    'lg': 'h-14 w-14',
    'xl': 'h-16 w-16',
  };

  // Render a simple FAB when no label is shown
  if (!showLabel) {
    return (
      <Tooltip content={tooltip || label}>
        <Button
          variant={variant}
          className={cn(
            positionClasses[position],
            sizeClasses[size],
            'rounded-full flex items-center justify-center shadow-lg z-50 transition-all duration-300 hover:scale-105 focus:scale-105 hover:shadow-xl',
            className
          )}
          onClick={onClick}
          aria-label={label}
          {...props}
        >
          {icon}
        </Button>
      </Tooltip>
    );
  }
  
  // Render an extended FAB with label
  return (
    <Button
      variant={variant}
      className={cn(
        positionClasses[position],
        'h-14 px-6 rounded-full flex items-center justify-center shadow-lg z-50 transition-all duration-300 hover:scale-105 focus:scale-105 hover:shadow-xl',
        className
      )}
      onClick={onClick}
      aria-label={label}
      {...props}
    >
      <span className="mr-2">{icon}</span>
      <span className="font-medium">{label}</span>
    </Button>
  );
}

/**
 * Vehicle Action FAB
 * 
 * A specialized floating action button specifically designed for vehicle-centric actions
 * based on the CEO's vision of treating vehicles as first-class digital entities.
 */
export function VehicleActionFAB({
  icon,
  label = 'Add Vehicle',
  variant = 'primary',
  onClick,
  className,
  ...props
}: Omit<FloatingActionButtonProps, 'showLabel'>) {
  return (
    <FloatingActionButton
      icon={icon}
      label={label}
      variant={variant}
      showLabel={true}
      tooltip="Vehicle Action"
      className={cn('group', className)}
      onClick={onClick}
      {...props}
    />
  );
}

/**
 * SpeedDial component for multiple floating actions
 */
export function SpeedDial({
  mainIcon,
  mainLabel = 'Actions',
  actions,
  position = 'bottom-right',
  variant = 'primary',
  className,
}: {
  mainIcon: React.ReactNode;
  mainLabel?: string;
  actions: Array<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    variant?: FloatingActionButtonProps['variant'];
  }>;
  position?: FloatingActionButtonProps['position'];
  variant?: FloatingActionButtonProps['variant'];
  className?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  
  const toggleOpen = () => setIsOpen(!isOpen);
  
  return (
    <div className={cn('fixed z-50', className)}>
      {/* Main button */}
      <FloatingActionButton
        icon={isOpen ? (
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : mainIcon}
        label={mainLabel}
        variant={variant}
        position={position}
        showLabel={false}
        onClick={toggleOpen}
        aria-expanded={isOpen}
        className={cn(
          'transition-transform duration-300',
          isOpen && 'rotate-45'
        )}
      />
      
      {/* Action buttons */}
      <div className={cn(
        'absolute bottom-20 right-0 flex flex-col-reverse items-end gap-3 transition-all duration-300',
        !isOpen && 'opacity-0 pointer-events-none translate-y-4',
        isOpen && 'opacity-100 pointer-events-auto'
      )}>
        {actions.map((action, index) => (
          <div
            key={index}
            className="flex items-center"
          >
            <div className={cn(
              'mr-3 rounded-lg bg-white dark:bg-neutral-800 px-3 py-2 shadow-md opacity-0 transition-opacity',
              isOpen && 'opacity-100'
            )}
              style={{ transitionDelay: `${index * 50}ms` }}
            >
              <span className="whitespace-nowrap text-sm font-medium">{action.label}</span>
            </div>
            <Button
              variant={action.variant || variant}
              size="icon"
              className={cn(
                'h-10 w-10 rounded-full shadow-md transition-all duration-300',
                'opacity-0 scale-90',
                isOpen && 'opacity-100 scale-100'
              )}
              style={{ transitionDelay: `${index * 50}ms` }}
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              aria-label={action.label}
            >
              {action.icon}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
