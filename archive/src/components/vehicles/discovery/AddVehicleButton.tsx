
import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PlusCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

interface AddVehicleButtonProps {
  className?: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const AddVehicleButton: React.FC<AddVehicleButtonProps> = ({
  className,
  variant = 'default',
  size = 'default'
}) => {
  const { session } = useAuth();
  
  // If user is not authenticated, redirect to login
  const href = session ? '/add-vehicle' : '/login?redirect=/add-vehicle';
  
  return (
    <Button 
      variant={variant} 
      size={size} 
      className={className}
      asChild
    >
      <Link to={href}>
        <PlusCircle className="mr-2 h-4 w-4" />
        Add Vehicle
      </Link>
    </Button>
  );
};

export default AddVehicleButton;
