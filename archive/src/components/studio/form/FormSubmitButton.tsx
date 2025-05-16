
import React from 'react';
import { Button } from '@/components/ui/button';

interface FormSubmitButtonProps {
  // No props needed for a simple submit button
}

export const FormSubmitButton: React.FC<FormSubmitButtonProps> = () => {
  return (
    <div className="flex justify-end">
      <Button type="submit">
        Update Configuration
      </Button>
    </div>
  );
};
