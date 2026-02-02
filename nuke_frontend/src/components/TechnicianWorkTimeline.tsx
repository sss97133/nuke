import React, { useState, useEffect } from 'react';
import type { WorkSessionService } from '../services/workSessionService';
import type { WorkSession } from '../services/workSessionService';
import { supabase } from '../lib/supabase';

interface TechnicianWorkTimelineProps {
  userId?: string;
  vehicleId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

interface WorkSummary {
  totalHours: number;
  sessionCount: number;
  vehicleCount: number;
  sessions: WorkSession[];
}

interface VehicleInfo {
  id: string;
  make: string;
  model: string;
  year: number;
}

export const TechnicianWorkTimeline: React.FC<TechnicianWorkTimelineProps> = ({
  userId,
  vehicleId,
  dateRange
}) => {
  const [workSummary, setWorkSummary] = useState<WorkSummary | null>(null);
  const [vehicles, setVehicles] = useState<Map<string, VehicleInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'year' | 'custom'>('month');
  const [customRange, setCustomRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    setWorkSummary(null);
    setLoading(true);
  }, [userId, vehicleId, selectedPeriod, customRange]);

  const loadWorkData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const targetUserId = userId || user?.id;
      
      if (!targetUserId) return;

      // Calculate date range based on selected period
      let startDate: string;
      let endDate: string;

      if (dateRange) {
        startDate = dateRange.start;
        endDate = dateRange.end;
      } else {
        const now = new Date();
        endDate = now.toISOString().split('T')[0];
        
        switch (selectedPeriod) {
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            break;
          case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            break;
          case 'year':
            startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            break;
          case 'custom':
            startDate = customRange.start;
            endDate = customRange.end;
            break;
        }
      }

      // Load work summary - handle missing table gracefully
      let summary;
      try {
        summary = await WorkSessionService.getTechnicianWorkSummary(
          targetUserId,
          startDate,
          endDate
        );
      } catch (error: any) {
        if (error.message?.includes('does not exist')) {
          console.log('Work sessions table not yet created - showing empty state');
          summary = {
            sessionCount: 0,
            totalHours: 0,
            vehicleCount: 0,
            sessions: []
          };
        } else {
          throw error;
        }
      }

      // Filter by vehicle if specified
      if (vehicleId && summary) {
        summary.sessions = summary.sessions.filter((s: any) => s.vehicle_id === vehicleId);
        summary.sessionCount = summary.sessions.length;
        summary.totalHours = summary.sessions.reduce((sum: number, s: any) => sum + s.duration_minutes, 0) / 60;
        summary.vehicleCount = 1;
      }

      setWorkSummary(summary);

      // Load vehicle information
      const vehicleIds = [...new Set(summary.sessions.map(s => s.vehicle_id))];
      if (vehicleIds.length > 0) {
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('id, make, model, year')
          .in('id', vehicleIds);

        const vehicleMap = new Map();
        vehicleData?.forEach(v => vehicleMap.set(v.id, v));
        setVehicles(vehicleMap);
      }
    } catch (error) {
      console.error('Error loading work data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const groupSessionsByDate = (sessions: WorkSession[]) => {
    const groups = new Map<string, WorkSession[]>();
    sessions.forEach(session => {
      const date = session.session_date;
      if (!groups.has(date)) {
        groups.set(date, []);
      }
      groups.get(date)!.push(session);
    });
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  };

  const getSessionsByVehicle = (sessions: WorkSession[]) => {
    const groups = new Map<string, WorkSession[]>();
    sessions.forEach(session => {
      if (!groups.has(session.vehicle_id)) {
        groups.set(session.vehicle_id, []);
      }
      groups.get(session.vehicle_id)!.push(session);
    });
    return Array.from(groups.entries());
  };

  if (loading) {
    return <div className="flex justify-center p-8">Loading work timeline...</div>;
  }

  if (!workSummary) {
    return <div className="text-center p-8 text-gray-500 dark:text-gray-400 dark:text-gray-500">No work data found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-blue-600">{workSummary.totalHours}h</div>
          <div className="text-sm text-gray-600">Total Hours</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-green-600">{workSummary.sessionCount}</div>
          <div className="text-sm text-gray-600">Work Sessions</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-purple-600">{workSummary.vehicleCount}</div>
          <div className="text-sm text-gray-600">Vehicles Worked On</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-2xl font-bold text-orange-600">
            {workSummary.sessionCount > 0 ? Math.round(workSummary.totalHours / workSummary.sessionCount * 10) / 10 : 0}h
          </div>
          <div className="text-sm text-gray-600">Avg Session</div>
        </div>
      </div>

      {/* Period Selection */}
      {!dateRange && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex flex-wrap gap-2 mb-4">
            {(['week', 'month', 'year', 'custom'] as const).map(period => (
              <button
                key={period}
                onClick={() => setSelectedPeriod(period)}
                className={`px-3 py-1 rounded text-sm ${
                  selectedPeriod === period 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {period === 'custom' ? 'Custom Range' : `Last ${period}`}
              </button>
            ))}
          </div>
          
          {selectedPeriod === 'custom' && (
            <div className="flex gap-4">
              <input
                type="date"
                value={customRange.start}
                onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                className="border rounded px-3 py-1"
              />
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                className="border rounded px-3 py-1"
              />
            </div>
          )}
        </div>
      )}

      {/* Work Sessions Timeline */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold">Work Sessions Timeline</h3>
        </div>
        
        <div className="p-4">
          {vehicleId ? (
            // Single vehicle view - group by date
            <div className="space-y-4">
              {groupSessionsByDate(workSummary.sessions).map(([date, sessions]) => (
                <div key={date} className="border-l-4 border-blue-500 pl-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium">{new Date(date).toLocaleDateString()}</h4>
                    <div className="text-sm text-gray-600">
                      {sessions.length} session{sessions.length !== 1 ? 's' : ''} • {' '}
                      {formatDuration(sessions.reduce((sum, s) => sum + s.duration_minutes, 0))}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {sessions.map(session => (
                      <div key={session.id} className="bg-gray-50 rounded p-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-sm">
                              {new Date(session.start_time).toLocaleTimeString()} - {' '}
                              {new Date(session.end_time).toLocaleTimeString()}
                            </div>
                            {session.work_description && (
                              <div className="text-sm text-gray-600 mt-1">
                                {session.work_description}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium">{formatDuration(session.duration_minutes)}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500">
                              {Math.round(session.confidence_score * 100)}% confidence
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Multi-vehicle view - group by vehicle
            <div className="space-y-6">
              {getSessionsByVehicle(workSummary.sessions).map(([vehicleId, sessions]) => {
                const vehicle = vehicles.get(vehicleId);
                const totalMinutes = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
                
                return (
                  <div key={vehicleId} className="border rounded-lg p-4">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="font-medium">
                        {vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : 'Unknown Vehicle'}
                      </h4>
                      <div className="text-sm text-gray-600">
                        {sessions.length} session{sessions.length !== 1 ? 's' : ''} • {' '}
                        {formatDuration(totalMinutes)}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      {sessions.map(session => (
                        <div key={session.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-b-0">
                          <div>
                            <div className="text-sm font-medium">
                              {new Date(session.session_date).toLocaleDateString()}
                            </div>
                            <div className="text-xs text-gray-600">
                              {new Date(session.start_time).toLocaleTimeString()} - {' '}
                              {new Date(session.end_time).toLocaleTimeString()}
                            </div>
                            {session.work_description && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 dark:text-gray-500 mt-1">
                                {session.work_description}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-medium">{formatDuration(session.duration_minutes)}</div>
                            <div className="text-xs text-gray-400 dark:text-gray-500">
                              {Math.round(session.confidence_score * 100)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
