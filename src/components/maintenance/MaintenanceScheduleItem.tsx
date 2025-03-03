
import React from 'react';
import { MaintenanceScheduleItem as MaintenanceScheduleItemType } from "@/components/maintenance/types";

const MaintenanceScheduleItem: React.FC<MaintenanceScheduleItemType> = ({ 
  title, 
  vehicle, 
  interval, 
  lastCompleted, 
  nextDue, 
  description 
}) => {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{vehicle}</p>
        </div>
      </div>
      
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <p className="text-xs font-medium">Interval</p>
          <p className="text-sm">{interval}</p>
        </div>
        <div>
          <p className="text-xs font-medium">Last Completed</p>
          <p className="text-sm">{lastCompleted}</p>
        </div>
        <div>
          <p className="text-xs font-medium">Next Due</p>
          <p className="text-sm">{nextDue}</p>
        </div>
      </div>
      
      <p className="mt-3 text-sm text-muted-foreground">{description}</p>
    </div>
  );
};

export default MaintenanceScheduleItem;
