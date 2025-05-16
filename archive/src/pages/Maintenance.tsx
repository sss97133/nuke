
import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BulkEntryForm from "@/components/maintenance/BulkEntryForm";
import BulkEditForm from "@/components/maintenance/BulkEditForm";
import MaintenanceHeader from "@/components/maintenance/MaintenanceHeader";
import UpcomingTab from "@/components/maintenance/tabs/UpcomingTab";
import HistoryTab from "@/components/maintenance/tabs/HistoryTab";
import ScheduleTab from "@/components/maintenance/tabs/ScheduleTab";
import RecommendationsTab from "@/components/maintenance/tabs/RecommendationsTab";
import { MaintenanceItem, MaintenanceScheduleItem, MaintenanceRecommendation } from "@/components/maintenance/types";
import { useToast } from "@/components/ui/use-toast";

const Maintenance = () => {
  const [activeTab, setActiveTab] = useState("upcoming");
  const [maintenanceItems, setMaintenanceItems] = useState<MaintenanceItem[]>([
    {
      id: "1",
      title: "Oil Change",
      vehicle: "2018 Honda Civic",
      date: "Oct 15, 2023",
      status: "upcoming",
      interval: "Every 5,000 miles",
      mileage: "4,750 miles driven"
    },
    {
      id: "2",
      title: "Tire Rotation",
      vehicle: "2018 Honda Civic",
      date: "Oct 22, 2023",
      status: "upcoming",
      interval: "Every 5,000-7,000 miles",
      mileage: "4,750 miles driven"
    },
    {
      id: "3",
      title: "Brake Inspection",
      vehicle: "2020 Toyota RAV4",
      date: "Nov 5, 2023",
      status: "upcoming",
      interval: "Every 10,000 miles",
      mileage: "9,250 miles driven"
    }
  ]);

  const [completedItems, setCompletedItems] = useState<MaintenanceItem[]>([
    {
      id: "4",
      title: "Air Filter Replacement",
      vehicle: "2018 Honda Civic",
      date: "Aug 12, 2023",
      status: "completed",
      notes: "Replaced with K&N high-flow filter",
      cost: "$45.99"
    },
    {
      id: "5",
      title: "Oil Change",
      vehicle: "2020 Toyota RAV4",
      date: "Jul 23, 2023",
      status: "completed",
      notes: "Used synthetic 5W-30",
      cost: "$68.50"
    },
    {
      id: "6",
      title: "Tire Rotation",
      vehicle: "2018 Honda Civic",
      date: "Jul 5, 2023",
      status: "completed",
      notes: "All tires in good condition",
      cost: "$25.00"
    }
  ]);

  const [scheduleItems, setScheduleItems] = useState<MaintenanceScheduleItem[]>([
    {
      id: "7",
      title: "Oil Change",
      vehicle: "2018 Honda Civic",
      interval: "Every 5,000 miles or 6 months",
      lastCompleted: "Jul 15, 2023",
      nextDue: "Jan 15, 2024",
      description: "Regular oil changes help maintain engine performance and longevity."
    },
    {
      id: "8",
      title: "Brake Fluid Flush",
      vehicle: "2018 Honda Civic",
      interval: "Every 25,000 miles or 3 years",
      lastCompleted: "Jun 10, 2021",
      nextDue: "Jun 10, 2024",
      description: "Fresh brake fluid ensures proper brake system performance."
    },
    {
      id: "9",
      title: "Transmission Fluid",
      vehicle: "2020 Toyota RAV4",
      interval: "Every 60,000 miles",
      lastCompleted: "Never",
      nextDue: "At 60,000 miles",
      description: "Maintains smooth gear shifts and protects transmission components."
    }
  ]);

  const [recommendations, setRecommendations] = useState<MaintenanceRecommendation[]>([
    {
      id: "10",
      title: "Consider Brake Pad Replacement",
      vehicle: "2018 Honda Civic",
      reasoning: "Front brake pads at 30% remaining based on last inspection",
      priority: "medium",
      estimatedCost: "$180-$250"
    },
    {
      id: "11",
      title: "Coolant System Flush",
      vehicle: "2020 Toyota RAV4",
      reasoning: "Approaching 3-year interval for coolant replacement",
      priority: "low",
      estimatedCost: "$100-$150"
    },
    {
      id: "12",
      title: "Battery Replacement",
      vehicle: "2018 Honda Civic",
      reasoning: "Battery is 4 years old and showing reduced capacity",
      priority: "high",
      estimatedCost: "$150-$200"
    }
  ]);

  const [isBulkEntryOpen, setIsBulkEntryOpen] = useState(false);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const { toast } = useToast();

  const handleBulkEntry = (newItems: MaintenanceItem[]) => {
    if (activeTab === "upcoming") {
      setMaintenanceItems(prev => [
        ...prev,
        ...newItems.map(item => ({
          ...item,
          status: "upcoming" as "upcoming" | "completed" | "overdue"
        }))
      ]);
    } else if (activeTab === "history") {
      setCompletedItems(prev => [
        ...prev,
        ...newItems.map(item => ({
          ...item,
          status: "completed" as "upcoming" | "completed" | "overdue"
        }))
      ]);
    }

    toast({
      title: "Bulk Create Successful",
      description: `Created ${newItems.length} maintenance tasks`,
    });
  };

  const handleBulkEdit = (updatedItems: MaintenanceItem[]) => {
    if (activeTab === "upcoming") {
      setMaintenanceItems(updatedItems);
    } else if (activeTab === "history") {
      setCompletedItems(updatedItems);
    }
    
    toast({
      title: "Bulk Edit Successful",
      description: "Your changes have been saved",
    });
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container mx-auto py-6 max-w-5xl">
        <MaintenanceHeader 
          onBulkEntryOpen={() => setIsBulkEntryOpen(true)}
          onBulkEditOpen={() => setIsBulkEditOpen(true)}
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-6">
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="schedule">Maintenance Schedule</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === "upcoming" && (
          <UpcomingTab maintenanceItems={maintenanceItems} />
        )}

        {activeTab === "history" && (
          <HistoryTab completedItems={completedItems} />
        )}

        {activeTab === "schedule" && (
          <ScheduleTab scheduleItems={scheduleItems} />
        )}

        {activeTab === "recommendations" && (
          <RecommendationsTab recommendations={recommendations} />
        )}
      </div>

      <BulkEntryForm 
        isOpen={isBulkEntryOpen}
        onClose={() => setIsBulkEntryOpen(false)}
        onSubmit={handleBulkEntry}
      />

      <BulkEditForm 
        isOpen={isBulkEditOpen}
        onClose={() => setIsBulkEditOpen(false)}
        items={activeTab === "upcoming" ? maintenanceItems : completedItems}
        onUpdate={handleBulkEdit}
      />
    </ScrollArea>
  );
};

export default Maintenance;
