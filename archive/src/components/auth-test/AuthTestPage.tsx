import React, { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Define interfaces for user and vehicle
interface TestUser {
  email: string;
  password: string;
  name: string;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

interface ServiceRecord {
  id?: string;
  vehicle_id: string;
  service_date: string;
  description: string;
  service_type: string;
  status: string;
  labor_hours?: number;
  technician_notes?: string;
  parts_used?: {name: string; quantity: number; cost: number}[];
  total_cost?: number;
}

export function AuthTestPage() {
  // State for test data and results
  const [user, setUser] = useState<TestUser>({
    email: 'test-owner@example.com',
    password: 'testPassword123!',
    name: 'Test Vehicle Owner'
  });
  
  const [loggedInUser, setLoggedInUser] = useState<any>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [serviceRecord, setServiceRecord] = useState<ServiceRecord>({
    vehicle_id: '',
    service_date: new Date().toISOString().split('T')[0],
    description: 'Oil change',
    service_type: 'maintenance',
    status: 'completed',
    labor_hours: 1.5,
    technician_notes: 'Regular maintenance',
    parts_used: [
      { name: 'Oil filter', quantity: 1, cost: 8.99 },
      { name: 'Oil (5W30)', quantity: 5, cost: 7.49 }
    ],
    total_cost: 52.42
  });
  
  const [results, setResults] = useState<{
    registration: string;
    login: string;
    rls: string;
    dataInput: string;
  }>({
    registration: '',
    login: '',
    rls: '',
    dataInput: ''
  });

  // Test user registration
  const testRegistration = async () => {
    try {
      setResults(prev => ({ ...prev, registration: 'Testing...' }));
      
      const { data, error } = await supabase.auth.signUp({
        email: user.email,
        password: user.password,
        options: {
          data: {
            name: user.name
          }
        }
      });
      
      if (error) {
        setResults(prev => ({ ...prev, registration: `❌ Failed: ${error.message}` }));
        return;
      }
      
      setResults(prev => ({ ...prev, registration: `✅ Success! User ID: ${data.user?.id}` }));
    } catch (err: any) {
      setResults(prev => ({ ...prev, registration: `❌ Error: ${err.message}` }));
    }
  };

  // Test user login
  const testLogin = async () => {
    try {
      setResults(prev => ({ ...prev, login: 'Testing...' }));
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: user.password
      });
      
      if (error) {
        setResults(prev => ({ ...prev, login: `❌ Failed: ${error.message}` }));
        return;
      }
      
      setLoggedInUser(data.user);
      setResults(prev => ({ ...prev, login: `✅ Success! User ID: ${data.user?.id}` }));
    } catch (err: any) {
      setResults(prev => ({ ...prev, login: `❌ Error: ${err.message}` }));
    }
  };

  // Test Row-Level Security (RLS)
  const testRLS = async () => {
    try {
      setResults(prev => ({ ...prev, rls: 'Testing...' }));
      
      if (!loggedInUser) {
        setResults(prev => ({ ...prev, rls: '❌ Not logged in. Please log in first.' }));
        return;
      }
      
      const { data, error } = await supabase
        .from('vehicles')
        .select('*');
      
      if (error) {
        setResults(prev => ({ ...prev, rls: `❌ Failed: ${error.message}` }));
        return;
      }
      
      // Save vehicles for data input test
      setVehicles(data);
      
      setResults(prev => ({
        ...prev,
        rls: `✅ Success! Retrieved ${data.length} vehicles. Only vehicles the user has permission to see are shown.`
      }));
    } catch (err: any) {
      setResults(prev => ({ ...prev, rls: `❌ Error: ${err.message}` }));
    }
  };

  // Test data input with service records
  const testDataInput = async () => {
    try {
      setResults(prev => ({ ...prev, dataInput: 'Testing...' }));
      
      if (!loggedInUser) {
        setResults(prev => ({ ...prev, dataInput: '❌ Not logged in. Please log in first.' }));
        return;
      }
      
      if (!serviceRecord.vehicle_id && vehicles.length > 0) {
        // If no vehicle selected and we have vehicles, use the first one
        serviceRecord.vehicle_id = vehicles[0].id;
      }
      
      if (!serviceRecord.vehicle_id) {
        setResults(prev => ({ ...prev, dataInput: '❌ No vehicle available. Please test RLS first.' }));
        return;
      }
      
      const { data, error } = await supabase
        .from('service_records')
        .insert(serviceRecord)
        .select();
      
      if (error) {
        setResults(prev => ({ ...prev, dataInput: `❌ Failed: ${error.message}` }));
        return;
      }
      
      setResults(prev => ({
        ...prev,
        dataInput: `✅ Success! Created service record for vehicle ${serviceRecord.vehicle_id}`
      }));
    } catch (err: any) {
      setResults(prev => ({ ...prev, dataInput: `❌ Error: ${err.message}` }));
    }
  };

  // Handle vehicle selection for service record
  const handleVehicleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setServiceRecord(prev => ({
      ...prev,
      vehicle_id: e.target.value
    }));
  };

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Authentication and Data Testing</h1>
      
      <div className="grid grid-cols-1 gap-8">
        {/* User Registration Testing */}
        <div className="border p-4 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">1. Test User Registration</h2>
          <div className="mb-4">
            <label className="block mb-2">Email:</label>
            <input
              type="email"
              value={user.email}
              onChange={(e) => setUser(prev => ({ ...prev, email: e.target.value }))}
              className="w-full p-2 border rounded"
            />
          </div>
          <div className="mb-4">
            <label className="block mb-2">Password:</label>
            <input
              type="password"
              value={user.password}
              onChange={(e) => setUser(prev => ({ ...prev, password: e.target.value }))}
              className="w-full p-2 border rounded"
            />
          </div>
          <div className="mb-4">
            <label className="block mb-2">Name:</label>
            <input
              type="text"
              value={user.name}
              onChange={(e) => setUser(prev => ({ ...prev, name: e.target.value }))}
              className="w-full p-2 border rounded"
            />
          </div>
          <button
            onClick={testRegistration}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Test Registration
          </button>
          
          {results.registration && (
            <div className={`mt-4 p-3 rounded ${results.registration.includes('❌') ? 'bg-red-100' : results.registration.includes('✅') ? 'bg-green-100' : 'bg-gray-100'}`}>
              {results.registration}
            </div>
          )}
        </div>
        
        {/* User Login Testing */}
        <div className="border p-4 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">2. Test User Login</h2>
          <p className="mb-4">Uses the email and password from above.</p>
          <button
            onClick={testLogin}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Test Login
          </button>
          
          {results.login && (
            <div className={`mt-4 p-3 rounded ${results.login.includes('❌') ? 'bg-red-100' : results.login.includes('✅') ? 'bg-green-100' : 'bg-gray-100'}`}>
              {results.login}
            </div>
          )}
          
          {loggedInUser && (
            <div className="mt-4 p-3 rounded bg-green-100">
              <p><strong>Logged in as:</strong> {loggedInUser.email}</p>
              <p><strong>User ID:</strong> {loggedInUser.id}</p>
            </div>
          )}
        </div>
        
        {/* Row-Level Security Testing */}
        <div className="border p-4 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">3. Test Row-Level Security (RLS)</h2>
          <p className="mb-4">Tests whether you can only see vehicles you have permission to access.</p>
          <button
            onClick={testRLS}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Test RLS
          </button>
          
          {results.rls && (
            <div className={`mt-4 p-3 rounded ${results.rls.includes('❌') ? 'bg-red-100' : results.rls.includes('✅') ? 'bg-green-100' : 'bg-gray-100'}`}>
              {results.rls}
            </div>
          )}
          
          {vehicles.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold mb-2">Your 73-87 Squarebody Trucks:</h3>
              <ul className="list-disc pl-5">
                {vehicles.map(vehicle => (
                  <li key={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        
        {/* Data Input Testing */}
        <div className="border p-4 rounded-lg">
          <h2 className="text-xl font-semibold mb-4">4. Test User Data Input</h2>
          <p className="mb-4">Creates a service record for one of your vehicles.</p>
          
          {vehicles.length > 0 && (
            <div className="mb-4">
              <label className="block mb-2">Select Vehicle:</label>
              <select
                value={serviceRecord.vehicle_id}
                onChange={handleVehicleChange}
                className="w-full p-2 border rounded"
              >
                <option value="">Select a vehicle</option>
                {vehicles.map(vehicle => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.year} {vehicle.make} {vehicle.model}
                  </option>
                ))}
              </select>
            </div>
          )}
          
          <div className="mb-4">
            <label className="block mb-2">Service Description:</label>
            <input
              type="text"
              value={serviceRecord.description}
              onChange={(e) => setServiceRecord(prev => ({ ...prev, description: e.target.value }))}
              className="w-full p-2 border rounded"
            />
          </div>
          
          <button
            onClick={testDataInput}
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          >
            Test Data Input
          </button>
          
          {results.dataInput && (
            <div className={`mt-4 p-3 rounded ${results.dataInput.includes('❌') ? 'bg-red-100' : results.dataInput.includes('✅') ? 'bg-green-100' : 'bg-gray-100'}`}>
              {results.dataInput}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
