
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Wrench, Clock, Calendar, FileText, Plus, Car, Settings } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ServiceManagement } from "@/components/service/ServiceManagement";
import { ServiceTicketForm } from "@/components/service/ServiceTicketForm";

const Service = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreateTicket = () => {
    setShowCreateForm(true);
    setActiveTab("tickets"); // Automatically switch to tickets tab when creating
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)] p-4">
      <div className="container mx-auto py-4 md:py-6 max-w-5xl">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 md:mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">Service Management</h1>
          <Button 
            className="w-full sm:w-auto flex gap-1 justify-center"
            onClick={handleCreateTicket}
          >
            <Plus className="h-4 w-4" />
            Create Service Ticket
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-4 md:mb-6">
          <TabsList className="w-full grid grid-cols-2 md:grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tickets">Tickets</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === "overview" && (
          <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            <ServiceCard 
              title="Active Tickets"
              description="Manage current service tickets" 
              icon={<Wrench className="h-5 w-5" />}
              count={12}
              action={() => setActiveTab("tickets")}
            />
            <ServiceCard 
              title="Service History"
              description="View past service records" 
              icon={<Clock className="h-5 w-5" />}
              count={48}
              link="/service-history"
            />
            <ServiceCard 
              title="Scheduled Services"
              description="Upcoming maintenance work" 
              icon={<Calendar className="h-5 w-5" />}
              count={5}
              action={() => setActiveTab("schedule")}
            />
            <ServiceCard 
              title="Maintenance Plans"
              description="Preventive maintenance schedules" 
              icon={<Settings className="h-5 w-5" />}
              count={8}
            />
            <ServiceCard 
              title="Vehicle Diagnostics"
              description="Vehicle health monitoring" 
              icon={<Car className="h-5 w-5" />}
              count={3}
              link="/diagnostics"
            />
            <ServiceCard 
              title="Service Reports"
              description="Analysis and documentation" 
              icon={<FileText className="h-5 w-5" />}
              count={15}
              action={() => setActiveTab("reports")}
            />
          </div>
        )}

        {activeTab === "tickets" && (
          <Card>
            <CardHeader>
              <CardTitle>Active Service Tickets</CardTitle>
              <CardDescription>Manage and track open service work</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Active tickets will be displayed here. Coming soon.</p>
            </CardContent>
          </Card>
        )}

        {activeTab === "schedule" && (
          <Card>
            <CardHeader>
              <CardTitle>Service Schedule</CardTitle>
              <CardDescription>Upcoming service appointments and maintenance</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Service scheduling will be displayed here. Coming soon.</p>
            </CardContent>
          </Card>
        )}

        {activeTab === "reports" && (
          <Card>
            <CardHeader>
              <CardTitle>Service Reports</CardTitle>
              <CardDescription>Analyze service performance and history</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Service reports will be displayed here. Coming soon.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
};

interface ServiceCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  action?: () => void;
  link?: string;
}

const ServiceCard = ({ title, description, icon, count, action, link }: ServiceCardProps) => {
  const content = (
    <Card className="h-full hover:bg-accent/10 transition-colors cursor-pointer">
      <CardContent className="pt-6">
        <div className="flex justify-between items-start mb-4">
          <div className="bg-primary/10 p-2 rounded-lg">
            {icon}
          </div>
          <div className="bg-primary text-primary-foreground text-xl font-semibold h-8 w-8 rounded-full flex items-center justify-center">
            {count}
          </div>
        </div>
        <h3 className="font-semibold text-lg mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );

  if (link) {
    return <Link to={link}>{content}</Link>;
  }

  return <div onClick={action}>{content}</div>;
};

export default Service;
