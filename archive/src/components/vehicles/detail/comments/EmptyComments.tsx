
import React from 'react';
import { MessageSquare } from 'lucide-react';

const EmptyComments: React.FC = () => {
  return (
    <div className="text-center py-10">
      <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-2">No Comments Yet</h3>
      <p className="text-muted-foreground mb-4">
        Be the first to comment on this vehicle.
      </p>
    </div>
  );
};

export default EmptyComments;
