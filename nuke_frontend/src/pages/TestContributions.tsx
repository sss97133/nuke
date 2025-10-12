import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import ContributionTimeline from '../components/profile/ContributionTimeline';
import type { UserContribution } from '../types/profile';

/**
 * Test page to debug contribution heatmap display
 * Temporary page to isolate the heatmap component
 */
const TestContributions: React.FC = () => {
  const [contributions, setContributions] = useState<UserContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadContributions();
  }, []);

  const loadContributions = async () => {
    try {
      setLoading(true);
      console.log('🔍 TestContributions: Loading contribution data...');

      const userId = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // skylar williams

      const { data, error } = await supabase
        .from('user_contributions')
        .select('*')
        .eq('user_id', userId)
        .order('contribution_date', { ascending: false });

      if (error) {
        console.error('TestContributions: Error loading contributions:', error);
        setError(error.message);
        return;
      }

      console.log('TestContributions: Raw data from database:', {
        recordCount: data?.length || 0,
        totalContributions: data?.reduce((sum, c) => sum + c.contribution_count, 0) || 0,
        sampleDates: data?.slice(0, 5).map(c => c.contribution_date) || []
      });

      setContributions(data || []);
      setError(null);
    } catch (err: any) {
      console.error('TestContributions: Exception:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="main">
          <div className="card">
            <div className="card-body">
              <h1>Testing Contributions</h1>
              <p>Loading contribution data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="main">
          <div className="card">
            <div className="card-body">
              <h1>Testing Contributions</h1>
              <div className="alert alert-danger">
                <h5>Error Loading Contributions</h5>
                <p>{error}</p>
                <button className="button button-primary" onClick={loadContributions}>
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="main">
        <div className="card">
          <div className="card-body">
            <h1>Testing Contributions</h1>
            
            <div style={{ marginBottom: 16 }}>
              <h3>Debug Info</h3>
              <p><strong>Total Records:</strong> {contributions.length}</p>
              <p><strong>Total Contributions:</strong> {contributions.reduce((sum, c) => sum + c.contribution_count, 0)}</p>
              <p><strong>Date Range:</strong> {contributions.length > 0 ? `${contributions[contributions.length - 1]?.contribution_date} to ${contributions[0]?.contribution_date}` : 'None'}</p>
            </div>

            {contributions.length > 0 ? (
              <div>
                <h3>Contribution Heatmap</h3>
                <ContributionTimeline
                  contributions={contributions}
                />
                
                <div style={{ marginTop: 16 }}>
                  <h4>Recent Contributions</h4>
                  <div style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    {contributions.slice(0, 10).map((contrib, i) => (
                      <div key={i}>
                        {contrib.contribution_date}: {contrib.contribution_type} ({contrib.contribution_count})
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <h3>No Contributions Found</h3>
                <p>The contribution data appears to be empty.</p>
                <button className="button button-primary" onClick={loadContributions}>
                  Reload Data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TestContributions;
