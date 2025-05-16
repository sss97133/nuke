
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import MaintenanceItem from "../MaintenanceItem";
import { MaintenanceItem as MaintenanceItemType } from "@/components/maintenance/types";

interface HistoryTabProps {
  completedItems: MaintenanceItemType[];
}

const HistoryTab: React.FC<HistoryTabProps> = ({ completedItems }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance History</CardTitle>
        <CardDescription>Record of completed maintenance tasks</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {completedItems.map((item) => (
            <MaintenanceItem key={item.id} {...item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default HistoryTab;
