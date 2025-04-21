
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Wrench, Clock, Calendar, FileText, Plus, Car, Settings, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { getSupabaseClient } from "@/integrations/supabase/client";


const Service = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  // Load vehicles from Supabase
  useEffect(() => {
    async function loadVehicles() {
      setLoadingVehicles(true);
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLoadingVehicles(false);
        return;
      }
      
      const { data, error } = await supabase.from('vehicles').select('*');
      
      if (error) {
        console.error('Error loading vehicles:', error);
        toast({
          title: 'Error',
          description: 'Failed to load vehicles',
          variant: 'destructive'
        });
      } else {
        setVehicles(data || []);
      }
      
      setLoadingVehicles(false);
    }
    
    loadVehicles();
  }, []);
  
  // Load service tickets
  useEffect(() => {
    if (activeTab === 'tickets' && !showCreateForm) {
      loadServiceTickets();
    }
  }, [activeTab, showCreateForm]);
  
  async function loadServiceTickets() {
    setLoadingTickets(true);
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoadingTickets(false);
      return;
    }
    
    const { data, error } = await supabase
      .from('service_tickets')
      .select('*, vehicles(*)')
      .order('created_at', { ascending: false })
      .limit(6);
    
    if (error) {
      console.error('Error loading tickets:', error);
    } else {
      setTickets(data || []);
    }
    
    setLoadingTickets(false);
  }

  const handleCreateTicket = () => {
    setShowCreateForm(true);
    setActiveTab("tickets"); // Automatically switch to tickets tab when creating
  };
  
  const handleCancel = () => {
    setShowCreateForm(false);
    setSelectedVehicle('');
    setServiceType('');
    setDescription('');
  };
  
  const handleSubmitTicket = async () => {
    // Validate inputs
    if (!selectedVehicle) {
      toast({
        title: 'Missing Information',
        description: 'Please select a vehicle',
        variant: 'destructive'
      });
      return;
    }
    
    if (!serviceType) {
      toast({
        title: 'Missing Information',
        description: 'Please select a service type',
        variant: 'destructive'
      });
      return;
    }
    
    if (!description.trim()) {
      toast({
        title: 'Missing Information',
        description: 'Please provide a description',
        variant: 'destructive'
      });
      return;
    }
    
    setSubmitting(true);
    
    const supabase = getSupabaseClient();
    if (!supabase) {
      setSubmitting(false);
      toast({
        title: 'Error',
        description: 'Could not connect to database',
        variant: 'destructive'
      });
      return;
    }
    
    // Save to Supabase
    const { error } = await supabase.from('service_tickets').insert({
      vehicle_id: selectedVehicle,
      service_type: serviceType,
      description: description,
      status: 'pending',
      created_at: new Date().toISOString()
    });
    
    setSubmitting(false);
    
    if (error) {
      console.error('Error saving ticket:', error);
      toast({
        title: 'Error',
        description: 'Failed to create service ticket',
        variant: 'destructive'
      });
    } else {
      toast({
        title: 'Success',
        description: 'Service ticket created successfully'
      });
      
      // Reset form and load tickets
      setShowCreateForm(false);
      setSelectedVehicle('');
      setServiceType('');
      setDescription('');
      loadServiceTickets();
    }
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
                      {loadingVehicles ? (
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          <span className="ml-2 text-sm text-muted-foreground">Loading vehicles...</span>
                        </div>
                      ) : vehicles.length > 0 ? (
                        <select 
                          id="vehicle" 
                          className="w-full p-2 border rounded mt-1"
                          value={selectedVehicle}
                          onChange={(e) => setSelectedVehicle(e.target.value)}
                        >
                          <option value="">Select a vehicle</option>
                          {vehicles.map(vehicle => (
                            <option key={vehicle.id} value={vehicle.id}>
                              {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.vin ? `(${vehicle.vin})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="border rounded p-3 bg-muted/20 text-center mt-1">
                          <p className="text-sm text-muted-foreground mb-2">No vehicles found</p>
                          <Link to="/vehicles/add" className="text-sm text-primary hover:underline">
                            Add your first vehicle
                          </Link>
                        </div>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="serviceType">Service Type</Label>
                      <select 
                        id="serviceType" 
                        className="w-full p-2 border rounded mt-1"
                        value={serviceType}
                        onChange={(e) => setServiceType(e.target.value)}
                      >
                        <option value="">Select type</option>
                        <option value="maintenance">Regular Maintenance</option>
                        <option value="repair">Repair</option>
                        <option value="inspection">Inspection</option>
                        <option value="upgrade">Upgrade/Modification</option>
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label htmlFor="description">Description</Label>
                      <textarea 
                        id="description" 
                        className="w-full p-2 border rounded mt-1 min-h-[100px]"
                        placeholder="Describe the service needed..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      ></textarea>
                    </div>
                  </div>
                  
                  <div className="flex justify-between pt-4 border-t mt-6">
                    <Button variant="outline" onClick={handleCancel} disabled={submitting}>
                      Cancel
                    </Button>
                    <Button onClick={handleSubmitTicket} disabled={submitting}>
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        'Submit Ticket'
                      )}
                    </Button>
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
                  
                  {loadingTickets ? (
                    <div className="flex justify-center items-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <span className="ml-3 text-muted-foreground">Loading service tickets...</span>
                    </div>
                  ) : tickets.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      {tickets.map(ticket => (
                        <div key={ticket.id} className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-medium">Ticket #{ticket.id.toString().substring(0, 4)}</div>
                            <div className="px-2 py-1 text-xs rounded bg-amber-100 text-amber-800">
                              {ticket.status === 'completed' ? 'Completed' : 
                               ticket.status === 'in_progress' ? 'In Progress' : 'Pending'}
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground mb-3">
                            Created: {new Date(ticket.created_at).toLocaleDateString()}
                          </div>
                          <div className="text-sm mb-2 font-medium">
                            Vehicle: {ticket.vehicles?.make} {ticket.vehicles?.model} ({ticket.vehicles?.year})
                          </div>
                          <p className="text-sm mb-4 line-clamp-2">{ticket.description}</p>
                          <div className="flex justify-between items-center pt-2 border-t">
                            <Button variant="outline" size="sm">View Details</Button>
                            <Button variant="ghost" size="sm">Update Status</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="border rounded-lg p-8 text-center bg-muted/10">
                      <Car className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <h3 className="text-lg font-medium mb-2">No Service Tickets</h3>
                      <p className="text-muted-foreground mb-6">You haven't created any service tickets yet.</p>
                      <Button onClick={() => setShowCreateForm(true)}>
                        <Plus className="h-4 w-4 mr-2" /> Create Your First Ticket
                      </Button>
                    </div>
                  )}
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
