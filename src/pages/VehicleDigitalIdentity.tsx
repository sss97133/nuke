import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/ui/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Clock, Check, AlertTriangle, Info, User, Wrench, DollarSign, FileText, Shield } from 'lucide-react';
import VehicleTimeline from '@/components/VehicleTimeline';

// Import types from your existing codebase
import type { TimelineEvent } from '@/components/VehicleTimeline';
import type { Database } from '@/integrations/supabase/types';

// Define types based on what's actually available in the database
type Vehicle = Database['public']['Tables']['vehicles']['Row'];

// Extended types for related data
type OwnerData = {
  id: string;
  full_name?: string;
  owned_since?: string;
  owned_until?: string;
  location?: string;
  verified?: boolean;
};

type ServiceData = {
  id: string;
  service_date?: string;
  service_type?: string;
  provider_id?: string;
  provider_name?: string;
  description?: string;
  verification_status?: 'verified' | 'pending' | 'unverified';
};

type DocumentData = {
  id: string;
  document_type?: string;
  title?: string;
  created_at?: string;
  verified?: boolean;
};

type VerificationData = {
  id: string;
  verification_date?: string;
  status?: string;
  confidence_score?: number;
  verified_by?: string;
};

type MarketData = {
  id: string;
  source?: string;
  date?: string;
  value?: number;
  current_value?: number;
  condition?: string;
  source_url?: string;
  updated_at?: string;
};

type VehicleWithRelations = Vehicle & {
  owners: OwnerData[];
  documents: DocumentData[];
  services: ServiceData[];
  verification: VerificationData[];
  market_data: MarketData[];
};

const VehicleDigitalIdentity = () => {
  const { id } = useParams<{ id: string }>();
  const [vehicle, setVehicle] = useState<VehicleWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Format VIN with proper spacing for official display
  const formatVin = (vin: string) => {
    return vin ? vin.replace(/(.{3})/g, '$1 ').trim() : 'N/A';
  };

  // Calculate confidence score based on data completeness
  const calculateConfidenceScore = (vehicle: VehicleWithRelations) => {
    if (!vehicle) return 0;
    
    let score = 0;
    // Basic data - 30% max
    if (vehicle.vin) score += 10;
    if (vehicle.make && vehicle.model) score += 10;
    if (vehicle.year) score += 10;
    
    // Documentation - 20% max
    score += Math.min(20, (vehicle.documents?.length || 0) * 5);
    
    // Verification - 20% max
    score += Math.min(20, (vehicle.verification?.length || 0) * 10);
    
    // Service history - 15% max
    score += Math.min(15, (vehicle.services?.length || 0) * 3);
    
    // Ownership history - 15% max
    score += Math.min(15, (vehicle.owners?.length || 0) * 5);
    
    return score;
  };

  // Function to render confidence score badge
  const renderConfidenceBadge = (score: number) => {
    if (score >= 80) {
      return <Badge className="bg-green-500 text-white">High Confidence ({score}%)</Badge>;
    } else if (score >= 50) {
      return <Badge className="bg-yellow-500 text-white">Medium Confidence ({score}%)</Badge>;
    } else {
      return <Badge className="bg-red-500 text-white">Low Confidence ({score}%)</Badge>;
    }
  };

  // Function to handle timeline event clicks
  const handleTimelineEventClick = (event: TimelineEvent) => {
    toast({
      title: "Event Selected",
      description: `${event.title} on ${new Date(event.eventDate).toLocaleDateString()}`,
    });
    
    // Here you would implement navigation to the specific event details
    console.log("Event clicked:", event);
  };

  useEffect(() => {
    const fetchVehicleData = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
        
        // Fetch vehicle basic data
        const { data: vehicleData, error: vehicleError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', id)
          .single();
        
        if (vehicleError) throw vehicleError;
        
        if (!vehicleData) {
          setError('Vehicle not found');
          return;
        }
        
        // Fetch related data using Promise.all for parallel requests
        // Simulate fetching related data from available tables or mock data when tables don't exist
        // This allows the UI to work even if some tables aren't in your schema yet
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('*')
          .limit(3); // Get some profiles to show as owners
          
        // Create mock data for relations that aren't in the database yet
        const mockOwners: OwnerData[] = (profilesData || []).map((profile, index) => ({
          id: profile.id,
          full_name: profile.full_name || `${profile.first_name || 'Owner'} ${profile.last_name || index + 1}`,
          owned_since: new Date(2020, index * 3, 15).toISOString(),
          owned_until: index === 0 ? undefined : new Date(2022, index * 3, 10).toISOString(),
          location: ['California', 'New York', 'Texas'][index % 3],
          verified: index % 2 === 0
        }));
        
        const mockDocuments: DocumentData[] = [
          { id: '1', document_type: 'Title', title: 'Vehicle Title', created_at: new Date(2020, 2, 15).toISOString(), verified: true },
          { id: '2', document_type: 'Service Record', title: 'Oil Change Documentation', created_at: new Date(2021, 5, 22).toISOString(), verified: true },
          { id: '3', document_type: 'Registration', title: 'Vehicle Registration', created_at: new Date(2022, 1, 10).toISOString(), verified: false }
        ];
        
        const mockServices: ServiceData[] = [
          { id: '1', service_date: new Date(2021, 3, 10).toISOString(), service_type: 'Oil Change', provider_id: '1', provider_name: 'Premium Auto Service', description: 'Regular oil change with filter replacement', verification_status: 'verified' },
          { id: '2', service_date: new Date(2021, 9, 22).toISOString(), service_type: 'Brake Service', provider_id: '2', provider_name: 'Midas Auto', description: 'Front brake pad replacement', verification_status: 'verified' },
          { id: '3', service_date: new Date(2022, 2, 5).toISOString(), service_type: 'Tire Rotation', provider_id: '1', provider_name: 'Premium Auto Service', description: 'Rotation and balancing of all four tires', verification_status: 'pending' }
        ];
        
        const mockVerifications: VerificationData[] = [
          { id: '1', verification_date: new Date(2021, 1, 15).toISOString(), status: 'Complete', confidence_score: 92, verified_by: 'PTZ Center #42' },
          { id: '2', verification_date: new Date(2022, 3, 8).toISOString(), status: 'Complete', confidence_score: 88, verified_by: 'PTZ Center #17' }
        ];
        
        const mockMarketData: MarketData[] = [
          { id: '1', source: 'BaT Auction', date: new Date(2021, 0, 20).toISOString(), value: 32500, current_value: 35800, condition: 'Excellent', source_url: 'https://bringatrailer.com', updated_at: new Date(2022, 3, 15).toISOString() },
          { id: '2', source: 'Hagerty Valuation', date: new Date(2021, 6, 15).toISOString(), value: 31000, current_value: 35800, condition: 'Good', source_url: 'https://hagerty.com', updated_at: new Date(2022, 3, 12).toISOString() },
          { id: '3', source: 'Recent Private Sale', date: new Date(2022, 1, 8).toISOString(), value: 33500, current_value: 35800, condition: 'Very Good', source_url: undefined, updated_at: new Date(2022, 3, 10).toISOString() }
        ];
        
        // Combine vehicle data with real or mock related data
        const completeVehicle: VehicleWithRelations = {
          ...vehicleData,
          owners: mockOwners,
          documents: mockDocuments,
          services: mockServices,
          verification: mockVerifications,
          market_data: mockMarketData
        };
        
        setVehicle(completeVehicle);
        
      } catch (err) {
        console.error('Error fetching vehicle data:', err);
        setError('Failed to load vehicle data');
        toast({
          title: "Error",
          description: "Failed to load vehicle data. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    
    fetchVehicleData();
  }, [id, toast]);

  if (loading) {
    return (
      <div className="container max-w-7xl py-6 space-y-6">
        <div className="flex items-center space-x-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-1/3" />
        </div>
        <Skeleton className="h-[25rem] w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="container max-w-7xl py-6">
        <Link to="/vehicles" className="inline-flex items-center mb-6 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Vehicles
        </Link>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
              <h2 className="text-xl font-semibold mb-2">Error Loading Vehicle</h2>
              <p className="text-muted-foreground">{error || 'Vehicle not found'}</p>
              <Button asChild className="mt-6">
                <Link to="/vehicles">Return to Vehicle List</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const confidenceScore = calculateConfidenceScore(vehicle);

  return (
    <div className="container max-w-7xl py-6">
      <Link to="/vehicles" className="inline-flex items-center mb-6 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Vehicles
      </Link>
      
      {/* Official Document Header */}
      <div className="mb-8 border border-black p-6 relative">
        <div className="absolute top-2 left-2 w-4 h-4 border-t border-l border-black"></div>
        <div className="absolute top-2 right-2 w-4 h-4 border-t border-r border-black"></div>
        <div className="absolute bottom-2 left-2 w-4 h-4 border-b border-l border-black"></div>
        <div className="absolute bottom-2 right-2 w-4 h-4 border-b border-r border-black"></div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1 md:col-span-2">
            <div className="text-xs text-muted-foreground font-mono">BUREAU OF VEHICLE DIGITAL IDENTITY</div>
            <h1 className="text-3xl font-semibold font-mono tracking-tight">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            <div className="font-mono">
              <span className="text-sm text-muted-foreground mr-2">VEHICLE IDENTIFICATION NUMBER:</span>
              <span className="font-medium">{formatVin(vehicle.vin)}</span>
            </div>
            <div className="font-mono mt-2">
              <span className="text-sm text-muted-foreground mr-2">REGISTRY DATE:</span>
              <span className="font-medium">{new Date(vehicle.created_at || Date.now()).toLocaleDateString()}</span>
              <span className="ml-4 text-sm text-muted-foreground mr-2">REGISTRY ID:</span>
              <span className="font-medium">{vehicle.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>
          
          <div className="border-l border-black pl-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground font-mono">DIGITAL IDENTITY CONFIDENCE</div>
              <div className="flex flex-col space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-mono">Trust Score:</span>
                  {renderConfidenceBadge(confidenceScore)}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${confidenceScore}%` }}></div>
                </div>
              </div>
            </div>
            
            <div className="border-t border-black mt-4 pt-4 text-xs font-mono">
              <div className="flex items-center">
                <Clock className="h-3 w-3 mr-1" />
                <span>Last Updated: {new Date(vehicle.updated_at || Date.now()).toLocaleString()}</span>
              </div>
              <div className="flex items-center mt-1">
                <Shield className="h-3 w-3 mr-1" />
                <span>Data Sources: {3 + (vehicle.owners?.length || 0)} verified sources</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Main Content Tabs */}
      <Tabs defaultValue="timeline" className="space-y-6">
        <TabsList className="grid grid-cols-5 md:w-auto w-full">
          <TabsTrigger value="timeline" className="font-mono">TIMELINE</TabsTrigger>
          <TabsTrigger value="owners" className="font-mono">OWNERSHIP</TabsTrigger>
          <TabsTrigger value="services" className="font-mono">MAINTENANCE</TabsTrigger>
          <TabsTrigger value="documents" className="font-mono">DOCUMENTS</TabsTrigger>
          <TabsTrigger value="market" className="font-mono">MARKET DATA</TabsTrigger>
        </TabsList>
        
        {/* Timeline Tab */}
        <TabsContent value="timeline" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center">
                <Clock className="mr-2 h-5 w-5" />
                VEHICLE LIFECYCLE TIMELINE
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[500px] border border-gray-200 rounded-md p-4">
                {/* Use your actual VehicleTimeline component here */}
                <VehicleTimeline
                  vehicleId={vehicle.id}
                  vin={vehicle.vin || ''}
                  make={vehicle.make || ''}
                  model={vehicle.model || ''}
                  year={vehicle.year || 0}
                  onEventClick={handleTimelineEventClick}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Ownership Tab */}
        <TabsContent value="owners" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center">
                <User className="mr-2 h-5 w-5" />
                OWNERSHIP RECORDS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-4 py-2 text-left">OWNER</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">PERIOD</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">LOCATION</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">VERIFICATION</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicle.owners && vehicle.owners.length > 0 ? (
                      vehicle.owners.map((owner, index) => (
                        <tr key={owner.id} className="hover:bg-gray-50">
                          <td className="border border-gray-300 px-4 py-2">
                            <Link to={`/profile/${owner.id}`} className="text-blue-600 hover:underline">
                              {owner.full_name || 'Unknown Owner'}
                            </Link>
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            {owner.owned_since ? new Date(owner.owned_since).toLocaleDateString() : 'Unknown'} - 
                            {owner.owned_until ? new Date(owner.owned_until).toLocaleDateString() : 'Present'}
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            {owner.location || 'Unknown'}
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            {owner.verified ? (
                              <Badge className="bg-green-500 text-white">Verified</Badge>
                            ) : (
                              <Badge variant="outline" className="text-yellow-600">Unverified</Badge>
                            )}
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            <Button variant="outline" size="sm">
                              View Details
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="border border-gray-300 px-4 py-6 text-center text-muted-foreground">
                          No ownership records available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Services Tab */}
        <TabsContent value="services" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center">
                <Wrench className="mr-2 h-5 w-5" />
                MAINTENANCE & SERVICE HISTORY
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-4 py-2 text-left">DATE</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">SERVICE TYPE</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">PROVIDER</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">DETAILS</th>
                      <th className="border border-gray-300 px-4 py-2 text-left">VERIFICATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicle.services && vehicle.services.length > 0 ? (
                      vehicle.services.map((service) => (
                        <tr key={service.id} className="hover:bg-gray-50">
                          <td className="border border-gray-300 px-4 py-2">
                            {service.service_date ? new Date(service.service_date).toLocaleDateString() : 'Unknown'}
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            {service.service_type || 'General Service'}
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            <Link to={`/professional/${service.provider_id}`} className="text-blue-600 hover:underline">
                              {service.provider_name || 'Unknown Provider'}
                            </Link>
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            {service.description || 'No details available'}
                          </td>
                          <td className="border border-gray-300 px-4 py-2">
                            {service.verification_status === 'verified' ? (
                              <Badge className="bg-green-500 text-white">Verified</Badge>
                            ) : service.verification_status === 'pending' ? (
                              <Badge variant="outline" className="text-yellow-600">Pending</Badge>
                            ) : (
                              <Badge variant="outline" className="text-red-600">Unverified</Badge>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="border border-gray-300 px-4 py-6 text-center text-muted-foreground">
                          No service records available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center">
                <FileText className="mr-2 h-5 w-5" />
                DOCUMENTATION ARCHIVE
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vehicle.documents && vehicle.documents.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {vehicle.documents.map((document) => (
                    <div key={document.id} className="border border-gray-200 rounded-md p-4 hover:bg-gray-50">
                      <div className="font-mono text-sm mb-2">{document.document_type || 'Document'}</div>
                      <div className="font-medium mb-1">{document.title || 'Untitled Document'}</div>
                      <div className="text-sm text-muted-foreground mb-3">
                        Added: {document.created_at ? new Date(document.created_at).toLocaleDateString() : 'Unknown'}
                      </div>
                      <div className="flex justify-between items-center">
                        <Badge variant={document.verified ? 'default' : 'outline'}>
                          {document.verified ? 'Verified' : 'Unverified'}
                        </Badge>
                        <Button variant="outline" size="sm">View</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center">
                  <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Documents Available</h3>
                  <p className="text-muted-foreground mb-6">This vehicle has no documented records in the system.</p>
                  <Button>Upload Document</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Market Data Tab */}
        <TabsContent value="market" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono flex items-center">
                <DollarSign className="mr-2 h-5 w-5" />
                MARKET VALUATION & ANALYSIS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="border border-gray-200 rounded-md p-4">
                  <div className="font-mono text-sm text-muted-foreground mb-1">CURRENT MARKET ESTIMATE</div>
                  <div className="text-3xl font-semibold font-mono">
                    ${vehicle.market_data?.[0]?.current_value?.toLocaleString() || 'Unknown'}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    Last updated: {vehicle.market_data?.[0]?.updated_at ? 
                      new Date(vehicle.market_data[0].updated_at).toLocaleDateString() : 'Never'}
                  </div>
                  <div className="flex items-center mt-4">
                    <Info className="h-4 w-4 mr-2 text-blue-500" />
                    <span className="text-sm">Based on {vehicle.market_data?.length || 0} market references</span>
                  </div>
                </div>
                
                <div className="border border-gray-200 rounded-md p-4">
                  <div className="font-mono text-sm text-muted-foreground mb-1">HISTORICAL VALUE</div>
                  <div className="h-40 flex items-center justify-center bg-gray-50">
                    <div className="text-muted-foreground text-center">
                      <span className="block">Historical value chart</span>
                      <span className="text-xs">Placeholder for chart component</span>
                    </div>
                  </div>
                </div>
                
                <div className="border border-gray-200 rounded-md p-4">
                  <div className="font-mono text-sm text-muted-foreground mb-1">MARKET INSIGHTS</div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start">
                      <Check className="h-4 w-4 mr-2 text-green-500 mt-0.5" />
                      <span>Similar models have appreciated 12% in the last year</span>
                    </li>
                    <li className="flex items-start">
                      <Check className="h-4 w-4 mr-2 text-green-500 mt-0.5" />
                      <span>Service history adds approximately 18% value premium</span>
                    </li>
                    <li className="flex items-start">
                      <Check className="h-4 w-4 mr-2 text-green-500 mt-0.5" />
                      <span>Current market shows strong demand for this model</span>
                    </li>
                  </ul>
                </div>
              </div>
              
              <div className="mt-6">
                <h3 className="font-mono text-sm text-muted-foreground mb-3">COMPARATIVE MARKET ANALYSIS</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse font-mono">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-4 py-2 text-left">SOURCE</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">DATE</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">VALUE</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">CONDITION</th>
                        <th className="border border-gray-300 px-4 py-2 text-left">LINK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicle.market_data && vehicle.market_data.length > 0 ? (
                        vehicle.market_data.map((data) => (
                          <tr key={data.id} className="hover:bg-gray-50">
                            <td className="border border-gray-300 px-4 py-2">
                              {data.source || 'Unknown Source'}
                            </td>
                            <td className="border border-gray-300 px-4 py-2">
                              {data.date ? new Date(data.date).toLocaleDateString() : 'Unknown'}
                            </td>
                            <td className="border border-gray-300 px-4 py-2">
                              ${data.value?.toLocaleString() || 'Unknown'}
                            </td>
                            <td className="border border-gray-300 px-4 py-2">
                              {data.condition || 'Unknown'}
                            </td>
                            <td className="border border-gray-300 px-4 py-2">
                              {data.source_url ? (
                                <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  View Source
                                </a>
                              ) : (
                                'No link available'
                              )}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="border border-gray-300 px-4 py-6 text-center text-muted-foreground">
                            No market data available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VehicleDigitalIdentity;
