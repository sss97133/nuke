import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Calendar, Wrench, FileText, Plus, Clock, CheckCircle, AlertCircle, Settings, Edit, FilePlus } from "lucide-react";
import { Link } from "react-router-dom";
import BulkEntryForm from "@/components/maintenance/BulkEntryForm";
import BulkEditForm from "@/components/maintenance/BulkEditForm";
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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">Maintenance Management</h1>
            <p className="text-muted-foreground mt-1">
              Schedule and track routine vehicle maintenance
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex gap-1" onClick={() => setIsBulkEntryOpen(true)}>
              <FilePlus className="h-4 w-4" />
              Bulk Create
            </Button>
            <Button variant="outline" className="flex gap-1" onClick={() => setIsBulkEditOpen(true)}>
              <Edit className="h-4 w-4" />
              Bulk Edit
            </Button>
            <Button className="flex gap-1">
              <Plus className="h-4 w-4" />
              Schedule Maintenance
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-6">
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="schedule">Maintenance Schedule</TabsTrigger>
            <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === "upcoming" && (
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
                      <MaintenanceItemComponent key={item.id} {...item} />
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
        )}

        {activeTab === "history" && (
          <Card>
            <CardHeader>
              <CardTitle>Maintenance History</CardTitle>
              <CardDescription>Record of completed maintenance tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {completedItems.map((item) => (
                  <MaintenanceItemComponent key={item.id} {...item} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "schedule" && (
          <Card>
            <CardHeader>
              <CardTitle>Maintenance Schedule</CardTitle>
              <CardDescription>Recommended maintenance intervals</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {scheduleItems.map((item) => (
                  <MaintenanceScheduleItemComponent key={item.id} {...item} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "recommendations" && (
          <Card>
            <CardHeader>
              <CardTitle>Maintenance Recommendations</CardTitle>
              <CardDescription>Personalized recommendations based on your vehicles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recommendations.map((item) => (
                  <MaintenanceRecommendationComponent key={item.id} {...item} />
                ))}
              </div>
            </CardContent>
          </Card>
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

const MaintenanceItemComponent = ({ title, vehicle, date, status, interval, mileage, notes, cost }: MaintenanceItem) => {
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

interface MaintenanceStatProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

interface MaintenanceStatsCardProps {
  title: string;
  description: string;
  stats: MaintenanceStatProps[];
}

const MaintenanceStatsCard = ({ title, description, stats }: MaintenanceStatsCardProps) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="flex flex-col items-center justify-center p-3 border rounded-lg">
              <div className="mb-1">{stat.icon}</div>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-xs text-muted-foreground text-center">{stat.label}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

const MaintenanceScheduleItemComponent = ({ title, vehicle, interval, lastCompleted, nextDue, description }: MaintenanceScheduleItem) => {
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

const MaintenanceRecommendationComponent = ({ title, vehicle, reasoning, priority, estimatedCost }: MaintenanceRecommendation) => {
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

export default Maintenance;
