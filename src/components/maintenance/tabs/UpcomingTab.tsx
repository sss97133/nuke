
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, AlertCircle, Clock, Calendar } from "lucide-react";
import MaintenanceItem from "../MaintenanceItem";
import MaintenanceStatsCard from "../MaintenanceStatsCard";
import { MaintenanceItem as MaintenanceItemType } from "@/components/maintenance/types";

interface UpcomingTabProps {
  maintenanceItems: MaintenanceItemType[];
}

const UpcomingTab: React.FC<UpcomingTabProps> = ({ maintenanceItems }) => {
  return (
    <>
      <div className="mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Upcoming Maintenance Tasks</CardTitle>
            <CardDescription>
              Preventative maintenance tasks scheduled for your vehicles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {maintenanceItems.map((item) => (
                <MaintenanceItem key={item.id} {...item} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MaintenanceStatsCard
          title="Regular Maintenance"
          description="Current status across all vehicles"
          stats={[
            { label: "On Schedule", value: "7", icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
            { label: "Overdue", value: "2", icon: <AlertCircle className="h-4 w-4 text-red-500" /> },
            { label: "Upcoming", value: "5", icon: <Clock className="h-4 w-4 text-amber-500" /> },
          ]}
        />
        <MaintenanceStatsCard
          title="Maintenance Intervals"
          description="Scheduled maintenance by time period"
          stats={[
            { label: "This Week", value: "1", icon: <Calendar className="h-4 w-4 text-blue-500" /> },
            { label: "This Month", value: "4", icon: <Calendar className="h-4 w-4 text-blue-500" /> },
            { label: "Next 3 Months", value: "9", icon: <Calendar className="h-4 w-4 text-blue-500" /> },
          ]}
        />
      </div>
    </>
  );
};

export default UpcomingTab;
