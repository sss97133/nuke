/**
 * Contractor Profile Card
 * Displays contractor work history, specializations, and portfolio metrics
 * Respects privacy settings - shows hours/jobs but hides finances unless authorized
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface ContractorStats {
  total_jobs: number;
  shops_worked_for: number;
  vehicles_worked_on: number;
  total_labor_hours: number;
  public_revenue: number;
  total_revenue_all: number;
  average_hourly_rate: number;
  specializations: string[];
  first_job_date: string;
  most_recent_job_date: string;
}

interface WorkContribution {
  id: string;
  organization_id: string;
  work_description: string;
  work_category: string;
  work_date: string;
  labor_hours: number;
  hourly_rate: number;
  total_value: number;
  vehicle_name?: string;
  show_financial_details: boolean;
  businesses?: {
    business_name: string;
  };
}

interface ContractorProfileCardProps {
  userId: string;
  isOwnProfile?: boolean;
}

export default function ContractorProfileCard({ userId, isOwnProfile }: ContractorProfileCardProps) {
  const [stats, setStats] = useState<ContractorStats | null>(null);
  const [recentWork, setRecentWork] = useState<WorkContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  
  useEffect(() => {
    loadContractorData();
  }, [userId]);
  
  const loadContractorData = async () => {
    try {
      setLoading(true);
      
      // Load aggregated stats
      const { data: statsData } = await supabase
        .from('contractor_profile_stats')
        .select('*')
        .eq('contractor_user_id', userId)
        .single();
      
      setStats(statsData);
      
      // Load recent work contributions (public only, unless viewing own profile)
      let query = supabase
        .from('contractor_work_contributions')
        .select(`
          *,
          businesses:organization_id (
            business_name
          )
        `)
        .eq('contractor_user_id', userId)
        .order('work_date', { ascending: false })
        .limit(10);
      
      // If viewing own profile, show all contributions (including private)
      if (!isOwnProfile) {
        query = query.eq('is_public', true);
      }
      
      const { data: workData } = await query;
      setRecentWork(workData || []);
      
    } catch (error) {
      console.error('Error loading contractor data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return (
      <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Loading contractor profile...
        </div>
      </div>
    );
  }
  
  if (!stats || stats.total_jobs === 0) {
    return null; // Not a contractor or no work logged
  }
  
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-header" style={{ 
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '11pt', fontWeight: 700 }}>Contractor Profile</span>
        <span style={{
          background: 'rgba(255,255,255,0.2)',
          padding: '2px 8px',
          borderRadius: '2px',
          fontSize: '7pt',
          fontWeight: 600
        }}>
          PROFESSIONAL
        </span>
      </div>
      
      <div className="card-body">
        {/* Stats Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
          marginBottom: '20px',
          padding: '16px',
          background: 'var(--surface)',
          borderRadius: '4px',
          border: '1px solid var(--border)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--accent)' }}>
              {stats.total_labor_hours?.toFixed(1) || 0}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Labor Hours
            </div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--accent)' }}>
              {stats.total_jobs}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Jobs Completed
            </div>
          </div>
          
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: 'var(--accent)' }}>
              {stats.shops_worked_for}
            </div>
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Shops
            </div>
          </div>
        </div>
        
        {/* Specializations */}
        {stats.specializations && stats.specializations.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Specializations
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {stats.specializations.map(spec => (
                <span
                  key={spec}
                  style={{
                    fontSize: '7pt',
                    padding: '4px 10px',
                    background: 'var(--accent-dim)',
                    color: 'var(--accent)',
                    borderRadius: '2px',
                    border: '1px solid var(--accent)',
                    fontWeight: 600,
                    textTransform: 'capitalize'
                  }}
                >
                  {spec.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Financial Info (Own Profile Only) */}
        {isOwnProfile && stats.total_revenue_all > 0 && (
          <div style={{
            padding: '12px',
            background: '#ecfdf5',
            border: '2px solid #10b981',
            borderRadius: '4px',
            marginBottom: '16px'
          }}>
            <div style={{ fontSize: '8pt', color: '#047857', fontWeight: 700, marginBottom: '4px' }}>
              YOUR EARNINGS (PRIVATE)
            </div>
            <div style={{ fontSize: '14pt', fontWeight: 700, color: '#059669' }}>
              ${stats.total_revenue_all.toLocaleString()}
            </div>
            <div style={{ fontSize: '7pt', color: '#047857', marginTop: '4px' }}>
              Avg Rate: ${stats.average_hourly_rate?.toFixed(0)}/hr · {stats.total_labor_hours?.toFixed(1)}h logged
            </div>
          </div>
        )}
        
        {/* Recent Work */}
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px'
          }}>
            <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Recent Work
            </div>
            {recentWork.length > 5 && (
              <button
                onClick={() => setShowAll(!showAll)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '7pt',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {showAll ? 'Show Less' : 'Show All'}
              </button>
            )}
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(showAll ? recentWork : recentWork.slice(0, 5)).map(work => (
              <div
                key={work.id}
                style={{
                  padding: '12px',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  background: 'var(--white)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9pt', fontWeight: 600, marginBottom: '2px' }}>
                      {work.work_description}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                      {work.businesses?.business_name}
                      {work.vehicle_name && ` · ${work.vehicle_name}`}
                      {' · '}
                      {new Date(work.work_date).toLocaleDateString()}
                    </div>
                  </div>
                  
                  <div style={{ textAlign: 'right' }}>
                    {work.labor_hours > 0 && (
                      <div style={{ fontSize: '9pt', fontWeight: 700, color: 'var(--accent)' }}>
                        {work.labor_hours}h
                      </div>
                    )}
                    {(isOwnProfile || work.show_financial_details) && work.total_value > 0 && (
                      <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
                        ${work.total_value.toLocaleString()}
                      </div>
                    )}
                  </div>
                </div>
                
                <div style={{
                  fontSize: '7pt',
                  padding: '2px 6px',
                  background: 'var(--surface)',
                  borderRadius: '2px',
                  display: 'inline-block',
                  textTransform: 'capitalize'
                }}>
                  {work.work_category.replace(/_/g, ' ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

