
import React from 'react';
import { Check } from 'lucide-react';

interface OnboardingStepIconProps {
  icon: React.ElementType;
  completed: boolean;
  active: boolean;
}

export const OnboardingStepIcon: React.FC<OnboardingStepIconProps> = ({ 
  icon: Icon, 
  completed, 
  active 
}) => (
  <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
    completed ? 'bg-primary text-primary-foreground' : 
    active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
  }`}>
    {completed ? <Check className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
  </div>
);
