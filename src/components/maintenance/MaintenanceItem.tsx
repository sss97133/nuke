
import React from 'react';
import { Clock, Settings, FileText } from "lucide-react";
import { MaintenanceItem as MaintenanceItemType } from "@/components/maintenance/types";

const MaintenanceItem: React.FC<MaintenanceItemType> = ({ 
  title, 
  vehicle, 
  date, 
  status, 
  interval, 
  mileage, 
  notes, 
  cost 
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case "upcoming":
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">Upcoming</span>;
      case "completed":
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">Completed</span>;
      case "overdue":
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">Overdue</span>;
    }
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{vehicle}</p>
        </div>
        <div className="flex flex-col items-end">
          {getStatusBadge()}
          <span className="text-sm text-muted-foreground mt-1">{date}</span>
        </div>
      </div>
      
      <div className="mt-3 space-y-1">
        {interval && <p className="text-xs flex items-center"><Clock className="h-3 w-3 mr-1" /> {interval}</p>}
        {mileage && <p className="text-xs flex items-center"><Settings className="h-3 w-3 mr-1" /> {mileage}</p>}
        {notes && <p className="text-xs flex items-center"><FileText className="h-3 w-3 mr-1" /> {notes}</p>}
        {cost && <p className="text-xs font-medium flex items-center">Cost: {cost}</p>}
      </div>
    </div>
  );
};

export default MaintenanceItem;
