import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';

const DatabaseDiagnostic: React.FC = () => {
  const [results, setResults] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const runDiagnostics = async () => {
    setLoading(true);
    const diagnostics: any = {};

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        diagnostics.error = 'No authenticated user';
        setResults(diagnostics);
        setLoading(false);
        return;
      }

      diagnostics.userId = user.id;

      // Check table existence and data
      const queries = [
        { name: 'vehicle_timeline_events', query: supabase.from('vehicle_timeline_events').select('*').eq('user_id', user.id).limit(5) },
        { name: 'timeline_events', query: supabase.from('vehicle_timeline_events').select('*').eq('user_id', user.id).limit(5) },
        { name: 'vehicle_images', query: supabase.from('vehicle_images').select('*').eq('user_id', user.id).limit(5) },
        { name: 'user_contributions', query: supabase.from('user_contributions').select('*').eq('user_id', user.id).limit(5) },
        { name: 'profiles', query: supabase.from('profiles').select('*').eq('id', user.id).single() }
      ];

      for (const { name, query } of queries) {
        try {
          const result = await query;
          diagnostics[name] = {
            count: Array.isArray(result.data) ? result.data.length : (result.data ? 1 : 0),
            data: result.data,
            error: result.error?.message || null
          };
        } catch (error: any) {
          diagnostics[name] = {
            count: 0,
            data: null,
            error: error.message
          };
        }
      }

      // Check for any timeline events at all
      try {
        const { count: vehicleTimelineCount } = await supabase
          .from('vehicle_timeline_events')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);
        
        const { count: timelineCount } = await supabase
          .from('vehicle_timeline_events')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id);

        diagnostics.counts = {
          vehicle_timeline_events: vehicleTimelineCount,
          timeline_events: timelineCount
        };
      } catch (error: any) {
        diagnostics.counts = { error: error.message };
      }

    } catch (error: any) {
      diagnostics.error = error.message;
    }

    setResults(diagnostics);
    setLoading(false);
  };

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="text font-bold">Database Diagnostic</h3>
      </div>
      <div className="card-body">
        <button 
          onClick={runDiagnostics} 
          disabled={loading}
          className="button button-primary text-small"
        >
          {loading ? 'Running...' : 'Run Diagnostics'}
        </button>
        
        {Object.keys(results).length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <pre className="text-small" style={{ 
              background: 'var(--grey-100)', 
              padding: 'var(--space-2)', 
              borderRadius: '4px',
              overflow: 'auto',
              maxHeight: '400px'
            }}>
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseDiagnostic;
