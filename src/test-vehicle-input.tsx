import { useState, useEffect } from 'react';
import { testSupabase as supabase, testConnection } from './test-supabase-client';
import './App.css';

/**
 * Simple test component for adding a vehicle to Supabase
 */
export default function TestVehicleInput() {
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [newVehicleId, setNewVehicleId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [formData, setFormData] = useState({
    make: '',
    model: '',
    year: 2023,
    vin: '',
    notes: '',
    source: 'manual-entry',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'year' ? parseInt(value) || 2023 : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Since we're in a testing environment, we'll bypass the auth check
      // and use a test user ID for our local development
      const testUserId = '00000000-0000-0000-0000-000000000000';

      // Insert new vehicle
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          ...formData,
          user_id: testUserId,
          status: 'active',
          public_vehicle: false,
          // Let added timestamp be set by default value
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      setNewVehicleId(data.id);
      setSuccess(true);
      
      // Reset form
      setFormData({
        make: '',
        model: '',
        year: 2023,
        vin: '',
        notes: '',
        source: 'manual-entry',
      });
    } catch (err: any) {
      console.error('Error adding vehicle:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchVehicle = async () => {
    if (!newVehicleId) return;
    
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', newVehicleId)
        .single();
        
      if (error) throw error;
      
      console.log('Retrieved vehicle with added timestamp:', data);
    } catch (err) {
      console.error('Error fetching vehicle:', err);
    }
  };

  useEffect(() => {
    // Test connection on component mount
    const checkConnection = async () => {
      setConnectionStatus('checking');
      const result = await testConnection();
      if (result.success) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('error');
        setError(`Database connection error: ${result.error ? (typeof result.error === 'object' && 'message' in result.error ? result.error.message : JSON.stringify(result.error)) : 'Unknown error'}`);
      }
    };
    
    checkConnection();
  }, []);
  
  useEffect(() => {
    if (success && newVehicleId) {
      fetchVehicle();
    }
  }, [success, newVehicleId]);

  return (
    <div className="container py-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">Test Vehicle Input</h1>
      
      {connectionStatus === 'checking' && (
        <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded mb-4">
          <p>Checking connection to Supabase...</p>
        </div>
      )}
      
      {connectionStatus === 'connected' && (
        <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded mb-4">
          <p>Successfully connected to Supabase!</p>
        </div>
      )}
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p>{error}</p>
        </div>
      )}
      
      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          <p>Vehicle added successfully! ID: {newVehicleId}</p>
          <p className="text-sm">Check console for full details including the new 'added' timestamp</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className={`space-y-4 ${connectionStatus !== 'connected' ? 'opacity-50 pointer-events-none' : ''}`}>
        <div>
          <label className="block text-sm font-medium text-gray-700">Make</label>
          <input
            type="text"
            name="make"
            value={formData.make}
            onChange={handleChange}
            required
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Model</label>
          <input
            type="text"
            name="model"
            value={formData.model}
            onChange={handleChange}
            required
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Year</label>
          <input
            type="number"
            name="year"
            value={formData.year}
            onChange={handleChange}
            required
            min="1900"
            max="2030"
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">VIN (Optional)</label>
          <input
            type="text"
            name="vin"
            value={formData.vin}
            onChange={handleChange}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
            rows={3}
          ></textarea>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Source</label>
          <select
            name="source"
            value={formData.source}
            onChange={handleChange}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
          >
            <option value="manual-entry">Manual Entry</option>
            <option value="import">Import</option>
            <option value="craigslist">Craigslist</option>
          </select>
        </div>
        
        <button
          type="submit"
          disabled={loading || connectionStatus !== 'connected'}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {loading ? 'Adding...' : 'Add Vehicle'}
        </button>
      </form>
      
      <div className="mt-8 text-sm text-gray-600">
        <p>This test form demonstrates:</p>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>Adding a new vehicle to the Supabase database</li>
          <li>Automatically setting the new 'added' timestamp column</li>
          <li>Reading back the record to verify it was saved correctly</li>
        </ul>
      </div>
    </div>
  );
}
