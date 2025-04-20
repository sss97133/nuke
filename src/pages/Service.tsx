
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Wrench, Clock, Calendar, FileText, Plus, Car, Settings } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";


const Service = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreateTicket = () => {
    setShowCreateForm(true);
    setActiveTab("tickets"); // Automatically switch to tickets tab when creating
  };
  
  const handleCancel = () => {
    setShowCreateForm(false);
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
              <CardTitle>{showCreateForm ? "Create Service Ticket" : "Active Service Tickets"}</CardTitle>
              <CardDescription>
                {showCreateForm 
                  ? "Document new maintenance or service work"
                  : "Manage and track open service work"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {showCreateForm ? (
                <div className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <Label htmlFor="vehicle">Vehicle</Label>
                      <select id="vehicle" className="w-full p-2 border rounded mt-1">
                        <option value="">Select a vehicle</option>
                        <option value="1">Tesla Model 3 (2021)</option>
                        <option value="2">Ford F-150 (2019)</option>
                        <option value="3">Toyota Camry (2020)</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="serviceType">Service Type</Label>
                      <select id="serviceType" className="w-full p-2 border rounded mt-1">
                        <option value="">Select type</option>
                        <option value="maintenance">Regular Maintenance</option>
                        <option value="repair">Repair</option>
                        <option value="inspection">Inspection</option>
                        <option value="upgrade">Upgrade/Modification</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="description">Description</Label>
                      <textarea id="description" className="w-full p-2 border rounded mt-1 min-h-[100px]"
                        placeholder="Describe the service needed..."></textarea>
                    </div>
                  </div>
                  
                  <div className="flex justify-between pt-4 border-t mt-6">
                    <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                    <Button onClick={() => {
                      toast({
                        title: "Service Ticket Created",
                        description: "Your service ticket has been submitted successfully."
                      });
                      setShowCreateForm(false);
                    }}>Submit Ticket</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <Button 
                    onClick={() => setShowCreateForm(true)}
                    className="mb-4"
                  >
                    <Plus className="h-4 w-4 mr-2" /> New Ticket
                  </Button>
                  
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Placeholder for actual ticket data */}
                    {[1, 2, 3].map(ticket => (
                      <div key={ticket} className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                          <div className="font-medium">Ticket #{ticket.toString().padStart(4, '0')}</div>
                          <div className="px-2 py-1 text-xs rounded bg-amber-100 text-amber-800">In Progress</div>
                        </div>
                        <div className="text-sm text-muted-foreground mb-3">Last updated: {new Date().toLocaleDateString()}</div>
                        <div className="text-sm mb-4">Vehicle: {['Tesla Model 3', 'Ford F-150', 'Toyota Camry'][ticket-1]}</div>
                        <div className="flex justify-between items-center pt-2 border-t">
                          <Button variant="outline" size="sm">View Details</Button>
                          <Button variant="ghost" size="sm">Update Status</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
