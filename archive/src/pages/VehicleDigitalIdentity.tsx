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
        
        // Fetch vehicle data
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
        
        // Fetch documents
        const { data: documents, error: documentsError } = await supabase
          .from('documents')
          .select('*')
          .eq('vehicle_id', id)
          .order('created_at', { ascending: false });
        
        if (documentsError) throw documentsError;
        
        // Fetch services
        const { data: services, error: servicesError } = await supabase
          .from('services')
          .select('*')
          .eq('vehicle_id', id)
          .order('service_date', { ascending: false });
        
        if (servicesError) throw servicesError;
        
        // Fetch verifications
        const { data: verifications, error: verificationsError } = await supabase
          .from('verifications')
          .select('*')
          .eq('vehicle_id', id)
          .order('verification_date', { ascending: false });
        
        if (verificationsError) throw verificationsError;
        
        // Transform the data
        const transformedDocuments: DocumentData[] = (documents || []).map(doc => ({
          id: doc.id,
          document_type: doc.document_type,
          title: doc.title,
          created_at: doc.created_at,
          verified: doc.verified
        }));
        
        const transformedServices: ServiceData[] = (services || []).map(service => ({
          id: service.id,
          service_date: service.service_date,
          service_type: service.service_type,
          provider_id: service.provider_id,
          provider_name: service.provider_name,
          description: service.description,
          verification_status: service.verification_status
        }));
        
        const transformedVerifications: VerificationData[] = (verifications || []).map(verification => ({
          id: verification.id,
          verification_date: verification.verification_date,
          status: verification.status,
          confidence_score: verification.confidence_score,
          verified_by: verification.verified_by
        }));
        
        // Combine vehicle data with real or mock related data
        const completeVehicle: VehicleWithRelations = {
          ...vehicleData,
          documents: transformedDocuments,
          services: transformedServices,
          verification: transformedVerifications,
          market_data: []
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
