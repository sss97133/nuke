
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import MaintenanceScheduleItem from "../MaintenanceScheduleItem";
import { MaintenanceScheduleItem as MaintenanceScheduleItemType } from "@/components/maintenance/types";

interface ScheduleTabProps {
  scheduleItems: MaintenanceScheduleItemType[];
}

const ScheduleTab: React.FC<ScheduleTabProps> = ({ scheduleItems }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance Schedule</CardTitle>
        <CardDescription>Recommended maintenance intervals</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {scheduleItems.map((item) => (
            <MaintenanceScheduleItem key={item.id} {...item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default ScheduleTab;
