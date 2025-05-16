
import React from 'react';
import { Button } from "@/components/ui/button";
import { MaintenanceRecommendation as MaintenanceRecommendationType } from "@/components/maintenance/types";

const MaintenanceRecommendation: React.FC<MaintenanceRecommendationType> = ({ 
  title, 
  vehicle, 
  reasoning, 
  priority, 
  estimatedCost 
}) => {
  const getPriorityBadge = () => {
    switch (priority) {
      case "high":
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">High Priority</span>;
      case "medium":
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300">Medium Priority</span>;
      case "low":
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Low Priority</span>;
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{vehicle}</p>
        </div>
        <div>
          {getPriorityBadge()}
        </div>
      </div>
      
      <div className="mt-3 space-y-2">
        <p className="text-sm text-muted-foreground">{reasoning}</p>
        <p className="text-sm font-medium">Estimated cost: {estimatedCost}</p>
        <div className="flex space-x-2 mt-2">
          <Button size="sm" variant="outline">Schedule</Button>
          <Button size="sm" variant="outline">Remind Later</Button>
        </div>
      </div>
    </div>
  );
};

export default MaintenanceRecommendation;
