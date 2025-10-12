import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import ImageTrackingBackfill from '../components/ImageTrackingBackfill';

const DataDiagnostic: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [localVehicles, setLocalVehicles] = useState<any[]>([]);
  const [supabaseVehicles, setSupabaseVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkEverything();
  }, []);

  const checkEverything = async () => {
    setLoading(true);
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
    
    // Check localStorage
    const localData = JSON.parse(localStorage.getItem('anonymousVehicles') || '[]');
    setLocalVehicles(localData);
    
    // Check Supabase (if authenticated)
    if (session) {
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', session.user.id);
        
        if (!error) {
          setSupabaseVehicles(data || []);
        }
      } catch (error) {
        console.error('Error loading Supabase vehicles:', error);
      }
    }
    
    setLoading(false);
  };

  const clearLocalStorage = () => {
    localStorage.removeItem('anonymousVehicles');
    setLocalVehicles([]);
    alert('localStorage cleared');
  };

  const forceLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google'
    });
    if (error) console.error('Login error:', error);
  };

  if (loading) {
    return <div className="p-8">Loading diagnostic...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Data Pipeline Diagnostic</h1>
        
        {/* Authentication Status */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-bold mb-4">Authentication Status</h2>
          {session ? (
            <div className="text-green-600">
              <p><strong>LOGGED IN</strong></p>
              <p>User ID: {session.user.id}</p>
              <p>Email: {session.user.email}</p>
            </div>
          ) : (
            <div className="text-red-600">
              <p><strong>NOT LOGGED IN</strong></p>
              <button 
                onClick={forceLogin}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded"
              >
                Login with Google
              </button>
            </div>
          )}
        </div>

        {/* localStorage Data */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">📱 localStorage Data (Port {window.location.port})</h2>
            <button 
              onClick={clearLocalStorage}
              className="px-4 py-2 bg-red-600 text-white rounded text-sm"
            >
              Clear localStorage
            </button>
          </div>
          <p className="text-gray-600 mb-4">Vehicles stored in your browser (port-specific)</p>
          {localVehicles.length > 0 ? (
            <div>
              <p className="font-bold text-green-600">{localVehicles.length} vehicles found</p>
              <ul className="mt-2 space-y-1">
                {localVehicles.map((vehicle, index) => (
                  <li key={index} className="text-sm bg-gray-100 p-2 rounded">
                    {vehicle.year} {vehicle.make} {vehicle.model} (ID: {vehicle.id?.slice(0, 8)}...)
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-gray-500">No vehicles in localStorage</p>
          )}
        </div>

        {/* Supabase Data */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-bold mb-4">☁️ Supabase Database</h2>
          <p className="text-gray-600 mb-4">Vehicles stored in the cloud (shared across all ports)</p>
          {session ? (
            supabaseVehicles.length > 0 ? (
              <div>
                <p className="font-bold text-green-600">{supabaseVehicles.length} vehicles found</p>
                <ul className="mt-2 space-y-1">
                  {supabaseVehicles.map((vehicle, index) => (
                    <li key={index} className="text-sm bg-blue-100 p-2 rounded">
                      {vehicle.year} {vehicle.make} {vehicle.model} (ID: {vehicle.id?.slice(0, 8)}...)
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-gray-500">No vehicles in Supabase database</p>
            )
          ) : (
            <p className="text-yellow-600">Login required to check Supabase data</p>
          )}
        </div>

        {/* Image Tracking Backfill */}
        {session && (
          <div className="mb-6">
            <ImageTrackingBackfill />
          </div>
        )}

        {/* Summary */}
        <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-lg">
          <h2 className="text-xl font-bold mb-4">Summary</h2>
          <ul className="space-y-2">
            <li>Authentication: {session ? 'LOGGED IN' : 'NOT LOGGED IN'}</li>
            <li>localStorage vehicles: {localVehicles.length}</li>
            <li>Supabase vehicles: {session ? supabaseVehicles.length : 'Unknown (login required)'}</li>
            <li>Current port: {window.location.port}</li>
          </ul>
          
          {localVehicles.length > 0 && session && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
              <p className="font-bold text-blue-800">Recommendation:</p>
              <p className="text-blue-700">You have vehicles in localStorage. Go to /local-vehicles and click "Sync Local to Cloud" to consolidate everything.</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-4">
          <button 
            onClick={checkEverything}
            className="px-6 py-2 bg-green-600 text-white rounded"
          >
            Refresh Diagnostic
          </button>
          <a 
            href="/local-vehicles"
            className="px-6 py-2 bg-blue-600 text-white rounded"
          >
            Go to Vehicle List
          </a>
        </div>
      </div>
    </div>
  );
};

export default DataDiagnostic;
