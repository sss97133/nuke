import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrustIndicator } from '@/components/ui/trust-indicator';
import { VehicleDetailLayout } from '@/components/layout/vehicle-centric-layout';
import { VehicleTimeline } from '@/components/vehicle/vehicle-timeline';
import { VehicleRecommendations } from '@/components/vehicle/vehicle-grid';
import { trackInteraction } from '@/utils/adaptive-ui';
import { supabase } from '@/lib/supabase-client';
import { tokens } from '@/styles/design-tokens';
import { cn } from '@/lib/utils';

type VehicleData = {
  id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  imageUrl: string;
  trustScore: number;
  verificationLevel: keyof typeof tokens.verificationLevels;
  price?: number;
  mileage?: number;
  ownershipType: 'FULL' | 'FRACTIONAL';
  ownershipStatus: 'owned' | 'watching' | 'discovered';
  location?: string;
  description?: string;
  specifications?: Record<string, string | number>;
  fractions?: {
    available: number;
    total: number;
    pricePerFraction?: number;
  };
  events: Array<{
    id: string;
    type: string;
    date: string;
    title: string;
    description?: string;
    verificationLevel?: string;
    sourceType?: string;
    metadata?: Record<string, any>;
  }>;
  documents?: Array<{
    id: string;
    title: string;
    type: string;
    url: string;
    verified: boolean;
    uploadDate: string;
  }>;
};

/**
 * Vehicle Detail Page
 * 
 * This page showcases a comprehensive view of a vehicle's digital identity,
 * emphasizing its timeline, verification level, and trust mechanisms.
 * It serves as the focal point of the vehicle-centric architecture.
 */
const VehicleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState<VehicleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    const loadVehicleData = async () => {
      try {
        setLoading(true);
        
        // In a real implementation, this would fetch actual data from Supabase
        // For now, we'll use mock data
        
        // Track this page view
        trackInteraction({
          type: 'VEHICLE_DETAIL_VIEW',
          itemId: id || '',
          timestamp: new Date().toISOString(),
          metadata: {},
        });
        
        // Mock data for demonstration
        const mockVehicle: VehicleData = {
          id: id || '1',
          vin: 'JT2MA70L6G0139487',
          make: 'Toyota',
          model: 'Supra',
          year: 1998,
          imageUrl: '/images/placeholder-car.jpg',
          trustScore: 87,
          verificationLevel: 'PTZ_VERIFIED',
          price: 65000,
          mileage: 78500,
          ownershipType: 'FULL',
          ownershipStatus: 'discovered',
          location: 'San Francisco, CA',
          description: 'Well-maintained Toyota Supra with comprehensive service history and multiple PTZ verifications. This vehicle has been properly documented throughout its lifecycle.',
          specifications: {
            engine: '3.0L Twin-Turbo Inline-6',
            transmission: '6-Speed Manual',
            exteriorColor: 'Black',
            interiorColor: 'Tan Leather',
            drivetrain: 'RWD',
            fuelType: 'Gasoline',
          },
          events: [
            {
              id: '1',
              type: 'ownership',
              date: '2022-04-15',
              title: 'Ownership Transfer',
              description: 'Vehicle transferred to current owner',
              verificationLevel: 'BLOCKCHAIN',
              sourceType: 'DMV',
            },
            {
              id: '2',
              type: 'maintenance',
              date: '2022-02-10',
              title: 'Major Service',
              description: 'Timing belt replacement, water pump, full service',
              verificationLevel: 'PROFESSIONAL',
              sourceType: 'Service Provider',
            },
            {
              id: '3',
              type: 'documentation',
              date: '2021-11-05',
              title: 'PTZ Verification',
              description: 'Full vehicle inspection and documentation',
              verificationLevel: 'PTZ_VERIFIED',
              sourceType: 'PTZ Center',
            },
            {
              id: '4',
              type: 'market',
              date: '2021-10-22',
              title: 'Listed for Sale',
              description: 'Vehicle listed on major marketplace',
              verificationLevel: 'SINGLE_SOURCE',
              sourceType: 'Marketplace',
            },
            {
              id: '5',
              type: 'ownership',
              date: '2020-06-18',
              title: 'Previous Owner',
              description: 'Vehicle purchased by previous owner',
              verificationLevel: 'MULTI_SOURCE',
              sourceType: 'Private Records',
            },
          ],
          documents: [
            {
              id: '1',
              title: 'Title Certificate',
              type: 'legal',
              url: '/documents/title.pdf',
              verified: true,
              uploadDate: '2022-04-15',
            },
            {
              id: '2',
              title: 'Service Records',
              type: 'maintenance',
              url: '/documents/service.pdf',
              verified: true,
              uploadDate: '2022-02-10',
            },
            {
              id: '3',
              title: 'PTZ Inspection Report',
              type: 'verification',
              url: '/documents/ptz-report.pdf',
              verified: true,
              uploadDate: '2021-11-05',
            },
          ],
        };
        
        setVehicle(mockVehicle);
      } catch (err) {
        console.error('Error loading vehicle data:', err);
        setError(err instanceof Error ? err : new Error('Failed to load vehicle data'));
      } finally {
        setLoading(false);
      }
    };
    
    if (id) {
      loadVehicleData();
    } else {
      setError(new Error('Vehicle ID is required'));
      setLoading(false);
    }
  }, [id]);
  
  if (loading) {
    return (
      <VehicleDetailLayout
        vehicleName="Loading vehicle details..."
        vehicleImage="/images/placeholder-car.jpg"
      >
        <div className="mt-8 flex items-center justify-center">
          <div className="text-lg animate-pulse">Loading vehicle details...</div>
        </div>
      </VehicleDetailLayout>
    );
  }
  
  if (error || !vehicle) {
    return (
      <VehicleDetailLayout
        vehicleName="Vehicle Not Found"
        vehicleImage="/images/placeholder-not-found.jpg"
      >
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-red-500">Error Loading Vehicle</CardTitle>
            <CardDescription>
              We couldn't find the vehicle you're looking for.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-4">{error?.message || 'Vehicle data not available'}</p>
            <Button onClick={() => navigate('/dashboard')}>
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </VehicleDetailLayout>
    );
  }
  
  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  
  return (
    <VehicleDetailLayout
      vehicleName={vehicleName}
      vehicleImage={vehicle.imageUrl}
      trustScore={vehicle.trustScore}
      verificationLevel={vehicle.verificationLevel}
    >
      {/* Vehicle Details */}
      <div className="mb-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vehicle Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">VIN</span>
                <span className="font-mono text-sm">{vehicle.vin}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Year</span>
                <span>{vehicle.year}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Make</span>
                <span>{vehicle.make}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Model</span>
                <span>{vehicle.model}</span>
              </div>
              
              {vehicle.mileage && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Mileage</span>
                  <span>{vehicle.mileage.toLocaleString()} miles</span>
                </div>
              )}
              
              {vehicle.price && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                    {vehicle.ownershipType === 'FRACTIONAL' ? 'Total Value' : 'Price'}
                  </span>
                  <span className="font-bold">${vehicle.price.toLocaleString()}</span>
                </div>
              )}
              
              {vehicle.location && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Location</span>
                  <span>{vehicle.location}</span>
                </div>
              )}
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Ownership Type</span>
                <Badge variant={vehicle.ownershipType === 'FRACTIONAL' ? 'accent' : 'outline'}>
                  {vehicle.ownershipType === 'FRACTIONAL' ? 'Fractional Ownership' : 'Full Ownership'}
                </Badge>
              </div>
              
              <div className="mt-2 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                <h4 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-white">Trust Status</h4>
                <TrustIndicator score={vehicle.trustScore} size="lg" />
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  This vehicle has achieved a {vehicle.trustScore}% trust score based on verification levels
                  and documentation quality.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Specifications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {vehicle.specifications && Object.entries(vehicle.specifications).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                    {key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}
                  </span>
                  <span>{value}</span>
                </div>
              ))}
              
              {vehicle.description && (
                <div className="mt-2 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                  <h4 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-white">Description</h4>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400">
                    {vehicle.description}
                  </p>
                </div>
              )}
              
              {vehicle.ownershipType === 'FRACTIONAL' && vehicle.fractions && (
                <div className="mt-2 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                  <h4 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-white">Fractional Ownership</h4>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-neutral-600 dark:text-neutral-400">Available Fractions</span>
                    <span className="font-medium">{vehicle.fractions.available} / {vehicle.fractions.total}</span>
                  </div>
                  {vehicle.fractions.pricePerFraction && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-neutral-600 dark:text-neutral-400">Price Per Fraction</span>
                      <span className="font-medium">${vehicle.fractions.pricePerFraction.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Tabbed Content */}
      <Tabs defaultValue="timeline" className="mb-8">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
        </TabsList>
        
        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Timeline</CardTitle>
              <CardDescription>Complete chronological history of this vehicle</CardDescription>
            </CardHeader>
            <CardContent>
              <VehicleTimeline events={vehicle.events} />
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="documents" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Documents & Records</CardTitle>
              <CardDescription>Official documents and records associated with this vehicle</CardDescription>
            </CardHeader>
            <CardContent>
              {vehicle.documents && vehicle.documents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {vehicle.documents.map(doc => (
                    <div 
                      key={doc.id}
                      className="rounded-md border border-neutral-200 dark:border-neutral-800 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="font-medium">{doc.title}</h4>
                        {doc.verified && (
                          <Badge variant="success" className="text-xs">Verified</Badge>
                        )}
                      </div>
                      <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">
                        {new Date(doc.uploadDate).toLocaleDateString()}
                      </p>
                      <div className="mt-2">
                        <Button variant="ghost" size="sm" className="w-full" asChild>
                          <a href={doc.url} target="_blank" rel="noopener noreferrer">
                            <svg 
                              className="mr-1 h-4 w-4" 
                              xmlns="http://www.w3.org/2000/svg" 
                              fill="none" 
                              viewBox="0 0 24 24" 
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            View Document
                          </a>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-neutral-500 dark:text-neutral-400">No documents available for this vehicle</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="verification" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Verification History</CardTitle>
              <CardDescription>Trust and verification details for this vehicle</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Verification Level */}
                <div>
                  <h3 className="mb-2 text-lg font-medium">Current Verification Level</h3>
                  <div className={cn(
                    "flex items-center rounded-md p-4",
                    vehicle.verificationLevel === 'BLOCKCHAIN' && "bg-status-blockchain/10",
                    vehicle.verificationLevel === 'PTZ_VERIFIED' && "bg-status-verified/10",
                    vehicle.verificationLevel === 'PROFESSIONAL' && "bg-status-success/10",
                    vehicle.verificationLevel === 'MULTI_SOURCE' && "bg-secondary-500/10",
                    vehicle.verificationLevel === 'SINGLE_SOURCE' && "bg-neutral-200 dark:bg-neutral-800"
                  )}>
                    <div className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-full",
                      vehicle.verificationLevel === 'BLOCKCHAIN' && "bg-status-blockchain text-white",
                      vehicle.verificationLevel === 'PTZ_VERIFIED' && "bg-status-verified text-white",
                      vehicle.verificationLevel === 'PROFESSIONAL' && "bg-status-success text-white",
                      vehicle.verificationLevel === 'MULTI_SOURCE' && "bg-secondary-500 text-white",
                      vehicle.verificationLevel === 'SINGLE_SOURCE' && "bg-neutral-500 text-white"
                    )}>
                      <svg 
                        className="h-6 w-6" 
                        xmlns="http://www.w3.org/2000/svg" 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <h4 className="font-medium">
                        {vehicle.verificationLevel.replace(/_/g, ' ')}
                      </h4>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {vehicle.verificationLevel === 'BLOCKCHAIN' && "Highest level of verification with cryptographic proof on blockchain"}
                        {vehicle.verificationLevel === 'PTZ_VERIFIED' && "Physically verified at a Professional Trust Zone with complete documentation"}
                        {vehicle.verificationLevel === 'PROFESSIONAL' && "Verified by recognized professionals with supporting documentation"}
                        {vehicle.verificationLevel === 'MULTI_SOURCE' && "Information verified by multiple independent sources"}
                        {vehicle.verificationLevel === 'SINGLE_SOURCE' && "Information from a single source awaiting additional verification"}
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Verification Events */}
                <div>
                  <h3 className="mb-2 text-lg font-medium">Verification History</h3>
                  <div className="space-y-3">
                    {vehicle.events
                      .filter(event => event.verificationLevel)
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(event => (
                        <div 
                          key={event.id} 
                          className="rounded-md border border-neutral-200 dark:border-neutral-800 p-4"
                        >
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium">{event.title}</h4>
                            <Badge 
                              variant={
                                event.verificationLevel === 'BLOCKCHAIN' ? 'blockchain' :
                                event.verificationLevel === 'PTZ_VERIFIED' ? 'verified' :
                                event.verificationLevel === 'PROFESSIONAL' ? 'success' :
                                event.verificationLevel === 'MULTI_SOURCE' ? 'secondary' : 'outline'
                              }
                            >
                              {event.verificationLevel?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                            {new Date(event.date).toLocaleDateString()} • {event.sourceType}
                          </p>
                          {event.description && (
                            <p className="mt-2 text-sm">{event.description}</p>
                          )}
                        </div>
                      ))
                    }
                  </div>
                </div>
                
                {/* Trust Score Details */}
                <div>
                  <h3 className="mb-2 text-lg font-medium">Trust Score Breakdown</h3>
                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-4">
                    <div className="mb-4">
                      <TrustIndicator score={vehicle.trustScore} />
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium">Documentation</span>
                          <span className="text-sm">
                            {vehicle.documents ? vehicle.documents.length * 10 : 0}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
                          <div 
                            className="h-2 rounded-full bg-primary-500" 
                            style={{ width: `${vehicle.documents ? Math.min(vehicle.documents.length * 10, 100) : 0}%` }}
                          />
                        </div>
                      </div>
                      
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium">Verification Level</span>
                          <span className="text-sm">
                            {vehicle.verificationLevel === 'BLOCKCHAIN' ? '100%' :
                             vehicle.verificationLevel === 'PTZ_VERIFIED' ? '90%' :
                             vehicle.verificationLevel === 'PROFESSIONAL' ? '75%' :
                             vehicle.verificationLevel === 'MULTI_SOURCE' ? '60%' : '30%'}
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
                          <div 
                            className="h-2 rounded-full bg-primary-500" 
                            style={{ 
                              width: vehicle.verificationLevel === 'BLOCKCHAIN' ? '100%' :
                                    vehicle.verificationLevel === 'PTZ_VERIFIED' ? '90%' :
                                    vehicle.verificationLevel === 'PROFESSIONAL' ? '75%' :
                                    vehicle.verificationLevel === 'MULTI_SOURCE' ? '60%' : '30%'
                            }}
                          />
                        </div>
                      </div>
                      
                      <div>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium">Timeline Completeness</span>
                          <span className="text-sm">
                            {Math.min(vehicle.events.length * 5, 100)}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800">
                          <div 
                            className="h-2 rounded-full bg-primary-500" 
                            style={{ width: `${Math.min(vehicle.events.length * 5, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Actions */}
      <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Button 
          className="w-full"
          onClick={() => {
            trackInteraction({
              type: 'BUTTON_CLICK',
              itemId: `verify_${vehicle.id}`,
              timestamp: new Date().toISOString(),
              metadata: {
                vehicleId: vehicle.id,
                buttonType: 'verify',
              },
            });
            navigate(`/verify/${vehicle.id}`);
          }}
        >
          Verify This Vehicle
        </Button>
        
        <Button 
          variant="secondary"
          className="w-full"
          onClick={() => {
            trackInteraction({
              type: 'BUTTON_CLICK',
              itemId: `add_document_${vehicle.id}`,
              timestamp: new Date().toISOString(),
              metadata: {
                vehicleId: vehicle.id,
                buttonType: 'add_document',
              },
            });
            navigate(`/add-document/${vehicle.id}`);
          }}
        >
          Add Document
        </Button>
        
        <Button 
          variant="outline"
          className="w-full"
          onClick={() => {
            trackInteraction({
              type: 'BUTTON_CLICK',
              itemId: `share_${vehicle.id}`,
              timestamp: new Date().toISOString(),
              metadata: {
                vehicleId: vehicle.id,
                buttonType: 'share',
              },
            });
            // Open share dialog
            alert('Share functionality would open here');
          }}
        >
          Share Vehicle
        </Button>
        
        <Button 
          variant={vehicle.ownershipStatus === 'watching' ? 'destructive' : 'outline'}
          className="w-full"
          onClick={() => {
            trackInteraction({
              type: 'BUTTON_CLICK',
              itemId: `watch_${vehicle.id}`,
              timestamp: new Date().toISOString(),
              metadata: {
                vehicleId: vehicle.id,
                buttonType: vehicle.ownershipStatus === 'watching' ? 'unwatch' : 'watch',
              },
            });
            // Toggle watch status
            setVehicle(prev => prev ? {
              ...prev,
              ownershipStatus: prev.ownershipStatus === 'watching' ? 'discovered' : 'watching'
            } : null);
          }}
        >
          {vehicle.ownershipStatus === 'watching' ? 'Unwatch Vehicle' : 'Watch Vehicle'}
        </Button>
      </div>
      
      {/* Similar Vehicles */}
      <VehicleRecommendations currentVehicleId={vehicle.id} />
      
    </VehicleDetailLayout>
  );
};

export default VehicleDetail;
