import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVehicle } from '@/providers/VehicleProvider';
import { Vehicle } from '@/types/vehicle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

interface DebugProps {
  path?: string;
}

// Debug page for vehicle-centric diagnostics
const Debug: React.FC<DebugProps> = ({ path }) => {
  const navigate = useNavigate();
  const {
    // Auth state
    user,
    session,
    loading: authLoading,
    signOut,
    isAnonymous,
    
    // Vehicle state
    vehicles,
    hasVehicles,
    loading: vehiclesLoading,
    ensureVehicleExists,
    addVehicle,
    deleteVehicle,
    verificationLevel,
    trustScore
  } = useVehicle();
  
  const [error, setError] = useState<string | null>(null);
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [creatingVehicle, setCreatingVehicle] = useState<boolean>(false);
  const [newVehicle, setNewVehicle] = useState<Partial<Vehicle>>({
    make: '',
    model: '',
    year: new Date().getFullYear()
  });

  // Function to ensure a vehicle exists for the user
  const handleEnsureVehicle = async () => {
    try {
      setCreatingVehicle(true);
      const vehicleId = await ensureVehicleExists();
      
      if (vehicleId) {
        toast({
          title: 'Vehicle Created',
          description: `Successfully created a default vehicle (ID: ${vehicleId.substring(0, 8)}...)`
        });
      } else {
        setVehicleError('Failed to create vehicle');
      }
    } catch (err: any) {
      setVehicleError(err.message);
    } finally {
      setCreatingVehicle(false);
    }
  };

  // Handle creating a new vehicle
  const handleCreateVehicle = async () => {
    if (!user) {
      setVehicleError('Must be logged in to create a vehicle');
      return;
    }
    
    if (!newVehicle.make || !newVehicle.model) {
      setVehicleError('Make and model are required');
      return;
    }
    
    try {
      setCreatingVehicle(true);
      
      const vehicle = await addVehicle(newVehicle);
      
      if (vehicle) {
        toast({
          title: 'Vehicle Added',
          description: `Successfully added ${vehicle.make} ${vehicle.model}`
        });
        
        // Reset form
        setNewVehicle({
          make: '',
          model: '',
          year: new Date().getFullYear()
        });
      } else {
        setVehicleError('Failed to add vehicle');
      }
    } catch (err: any) {
      setVehicleError(err.message);
    } finally {
      setCreatingVehicle(false);
    }
  };
  
  // Handle deleting a vehicle
  const handleDeleteVehicle = async (vehicleId: string) => {
    if (!user) {
      setVehicleError('Must be logged in to delete a vehicle');
      return;
    }
    
    if (!confirm('Are you sure you want to delete this vehicle?')) {
      return;
    }
    
    try {
      const success = await deleteVehicle(vehicleId);
      
      if (success) {
        toast({
          title: 'Vehicle Deleted',
          description: 'Vehicle has been removed from your account'
        });
      } else {
        setVehicleError('Failed to delete vehicle');
      }
    } catch (err: any) {
      setVehicleError(err.message);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-lg shadow-lg mt-10">
      <h1 className="text-2xl font-bold mb-6">Vehicle-Centric Debug Page</h1>
      {authLoading || vehiclesLoading ? (
        <div className="flex items-center justify-center p-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-700"></div>
          <p className="ml-2">Loading vehicle data...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Auth Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>Authentication Status</CardTitle>
              <CardDescription>
                {session ? 'Authenticated via Supabase' : 'Not authenticated'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                  {error}
                </div>
              )}
              
              {!session ? (
                <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded mb-4">
                  <p className="font-bold">Not logged in</p>
                  <p className="text-sm mt-1">You need to authenticate before accessing vehicle data</p>
                  <Button 
                    onClick={() => navigate('/login')}
                    className="mt-2"
                  >
                    Go to Login
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
                    <p><span className="font-bold">Email:</span> {session.user.email}</p>
                    <p><span className="font-bold">User ID:</span> <span className="font-mono text-xs">{session.user.id}</span></p>
                    <p>
                      <span className="font-bold">Account Type:</span> {isAnonymous ? 'Anonymous (Temporary)' : 'Registered'}
                    </p>
                    <p>
                      <span className="font-bold">Auth Provider:</span> {session.user.app_metadata.provider || 'email'}
                    </p>
                  </div>
                  
                  <div>
                    <h3 className="font-semibold mb-2">JWT Token</h3>
                    <div className="bg-gray-100 p-2 rounded overflow-auto max-h-32 text-xs font-mono">
                      {session?.access_token ? (
                        <>{session.access_token.substring(0, 20)}...{session.access_token.substring(session.access_token.length - 20)}</>
                      ) : (
                        <p className="text-gray-500">No access token</p>
                      )}
                    </div>
                  </div>
                  
                  <Button 
                    variant="destructive" 
                    onClick={signOut}
                  >
                    Sign Out
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Vehicle Data Card */}
          <Card>
            <CardHeader>
              <CardTitle>Vehicle Data</CardTitle>
              <CardDescription>
                {hasVehicles 
                  ? `You have ${vehicles.length} vehicle${vehicles.length > 1 ? 's' : ''}` 
                  : 'No vehicles found'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vehicleError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                  {vehicleError}
                </div>
              )}
              
              {hasVehicles ? (
                <div>
                  <div className="bg-blue-50 p-3 rounded mb-3">
                    <p><span className="font-bold">Trust Score:</span> {trustScore}/100</p>
                    <p><span className="font-bold">Verification Level:</span> {verificationLevel}</p>
                  </div>
                  
                  <div className="space-y-3 max-h-80 overflow-auto">
                    {vehicles.map(vehicle => (
                      <div key={vehicle.id} className="border border-gray-200 rounded p-3 bg-white">
                        <div className="flex justify-between">
                          <div>
                            <p className="font-bold">{vehicle.make} {vehicle.model} ({vehicle.year})</p>
                            <p className="text-xs text-gray-500 font-mono">ID: {vehicle.id}</p>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteVehicle(vehicle.id)}
                          >
                            Delete
                          </Button>
                        </div>
                        
                        {vehicle.trust_score !== undefined && (
                          <div className="mt-2">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-blue-600 h-2 rounded-full" 
                                style={{ width: `${vehicle.trust_score}%` }}
                              ></div>
                            </div>
                            <div className="flex justify-between text-xs mt-1">
                              <span>Trust: {vehicle.trust_score}%</span>
                              <span>Level: {vehicle.verification_level || 'unverified'}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : session ? (
                <div className="bg-yellow-50 border border-yellow-200 p-3 rounded">
                  <p>No vehicles found for your account. Add a vehicle to continue.</p>
                  <Button
                    onClick={handleEnsureVehicle}
                    disabled={creatingVehicle}
                    className="w-full mt-2"
                    variant="default"
                  >
                    {creatingVehicle ? 'Creating Default Vehicle...' : 'Create Default Vehicle'}
                  </Button>
                </div>
              ) : null}
              
              {session && (
                <div className="mt-6 border-t pt-4">
                  <h3 className="font-semibold mb-3">Add New Vehicle</h3>
                  <div className="space-y-3">
                    <div className="grid w-full items-center gap-1.5">
                      <Label htmlFor="make">Make</Label>
                      <Input
                        id="make"
                        value={newVehicle.make}
                        onChange={(e) => setNewVehicle({...newVehicle, make: e.target.value})}
                        placeholder="e.g. Toyota"
                      />
                    </div>
                    
                    <div className="grid w-full items-center gap-1.5">
                      <Label htmlFor="model">Model</Label>
                      <Input
                        id="model"
                        value={newVehicle.model}
                        onChange={(e) => setNewVehicle({...newVehicle, model: e.target.value})}
                        placeholder="e.g. Corolla"
                      />
                    </div>
                    
                    <div className="grid w-full items-center gap-1.5">
                      <Label htmlFor="year">Year</Label>
                      <Input
                        id="year"
                        type="number"
                        value={newVehicle.year}
                        onChange={(e) => setNewVehicle({...newVehicle, year: parseInt(e.target.value) || new Date().getFullYear()})}
                        min={1900}
                        max={new Date().getFullYear() + 1}
                      />
                    </div>
                    
                    <Button
                      onClick={handleCreateVehicle}
                      disabled={creatingVehicle || !newVehicle.make || !newVehicle.model}
                      className="w-full"
                    >
                      {creatingVehicle ? 'Adding Vehicle...' : 'Add Vehicle'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Navigation & Testing Card */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Navigation & Testing</CardTitle>
              <CardDescription>Test vehicle-centric authentication flows</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                <Button onClick={() => navigate('/')} variant="outline">Home</Button>
                <Button onClick={() => navigate('/login')} variant="outline">Login</Button>
                <Button onClick={() => navigate('/profile')} variant="outline">Profile</Button>
                <Button onClick={() => navigate('/emergency.html')} variant="outline">Emergency</Button>
              </div>
              
              {session && (
                <div className="mt-4 p-3 bg-gray-100 rounded text-sm">
                  <p className="font-semibold">Authentication Flow Status:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li className={`${session ? 'text-green-700' : 'text-red-700'}`}>
                      User authenticated: {session ? '✓' : '✗'}
                    </li>
                    <li className={hasVehicles ? 'text-green-700' : 'text-red-700'}>
                      Vehicle data available: {hasVehicles ? '✓' : '✗'}
                    </li>
                    <li className={trustScore > 0 ? 'text-green-700' : 'text-yellow-700'}>
                      Trust score calculated: {trustScore > 0 ? '✓' : '⚠️'}
                    </li>
                    <li className={isAnonymous ? 'text-yellow-700' : 'text-green-700'}>
                      Account type: {isAnonymous ? 'Anonymous (temporary)' : 'Registered user'}
                    </li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Debug;

// Provide an alias for backward compatibility
export const DebugFixed = Debug;
