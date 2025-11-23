/**
 * ADMIN ANALYTICS - Real-time database monitoring
 * Shows actual current operations, costs, table populations
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface AnalyticsData {
  processing: {
    anglesSet: number;
    totalImages: number;
    percentComplete: number;
    estimatedCost: number;
    processing: boolean;
  };
  tables: {
    name: string;
    rows: number;
    recentActivity: number; // Rows added in last hour
  }[];
  recentImages: {
    id: string;
    angle: string;
    category: string;
    timestamp: string;
  }[];
}

export default function AdminAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadAnalytics();
    const interval = setInterval(() => {
      loadAnalytics();
    }, 3000); // Update every 3 seconds
    
    return () => clearInterval(interval);
  }, []);

  async function loadAnalytics() {
    try {
      // Get image processing status
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id, angle, category, created_at');

      const totalImages = images?.length || 0;
      const anglesSet = images?.filter(img => img.angle).length || 0;
      const percentComplete = totalImages > 0 ? (anglesSet / totalImages) * 100 : 0;
      
      // Check if processing - look at updated_at which changes when angle is set
      const { data: recentUpdates } = await supabase
        .from('vehicle_images')
        .select('updated_at')
        .not('angle', 'is', null)
        .gte('updated_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
        .limit(1);
      
      const isProcessing = recentUpdates && recentUpdates.length > 0;

      // Get table populations with actual queries
      const tableCounts = await Promise.all([
        supabase.from('body_panel_damage_map').select('*', { count: 'exact', head: true }),
        supabase.from('dealer_pdi_checklist').select('*', { count: 'exact', head: true }),
        supabase.from('defect_inventory').select('*', { count: 'exact', head: true }),
        supabase.from('part_identifications').select('*', { count: 'exact', head: true }),
        supabase.from('damage_catalog').select('*', { count: 'exact', head: true }),
        supabase.from('modification_registry').select('*', { count: 'exact', head: true }),
        supabase.from('image_question_answers').select('*', { count: 'exact', head: true }),
      ]);

      const tables = [
        { name: 'body_panel_damage_map', rows: tableCounts[0].count || 0, recentActivity: 0 },
        { name: 'dealer_pdi_checklist', rows: tableCounts[1].count || 0, recentActivity: 0 },
        { name: 'defect_inventory', rows: tableCounts[2].count || 0, recentActivity: 0 },
        { name: 'part_identifications', rows: tableCounts[3].count || 0, recentActivity: 0 },
        { name: 'damage_catalog', rows: tableCounts[4].count || 0, recentActivity: 0 },
        { name: 'modification_registry', rows: tableCounts[5].count || 0, recentActivity: 0 },
        { name: 'image_question_answers', rows: tableCounts[6].count || 0, recentActivity: 0 },
      ];

      // Get recent images with angles
      const recentImages = images
        ?.filter(img => img.angle)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
        .map(img => ({
          id: img.id,
          angle: img.angle || 'unknown',
          category: img.category || 'unknown',
          timestamp: img.created_at
        })) || [];

      setData({
        processing: {
          anglesSet,
          totalImages,
          percentComplete,
          estimatedCost: anglesSet * 0.00008,
          processing: isProcessing
        },
        tables,
        recentImages
      });
      
      setLastUpdate(new Date());
      setLoading(false);
    } catch (error) {
      console.error('Error loading analytics:', error);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px] bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto mb-2"></div>
          <p className="text-8pt text-gray-600 uppercase tracking-wide">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 bg-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-8pt font-bold uppercase tracking-wide text-gray-900">Real-Time Analytics</h2>
        <div className="text-8pt text-gray-500 uppercase tracking-wide">
          Updated: {lastUpdate.toLocaleTimeString()}
        </div>
      </div>

      {/* Current Operations */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border-2 border-gray-200 rounded p-3">
          <div className="text-8pt text-gray-500 uppercase tracking-wide mb-1">Processing Status</div>
          <div className={`text-8pt font-bold ${data.processing.processing ? 'text-green-600' : 'text-gray-400'}`}>
            {data.processing.processing ? 'ACTIVE' : 'IDLE'}
          </div>
        </div>

        <div className="bg-white border-2 border-blue-200 rounded p-3">
          <div className="text-8pt text-gray-500 uppercase tracking-wide mb-1">Angles Set</div>
          <div className="text-8pt font-bold text-gray-900">
            {data.processing.anglesSet.toLocaleString()} / {data.processing.totalImages.toLocaleString()}
          </div>
          <div className="text-8pt text-gray-500 mt-1">
            {data.processing.percentComplete.toFixed(1)}%
          </div>
        </div>

        <div className="bg-white border-2 border-yellow-200 rounded p-3">
          <div className="text-8pt text-gray-500 uppercase tracking-wide mb-1">API Cost</div>
          <div className="text-8pt font-bold text-yellow-700">
            ${data.processing.estimatedCost.toFixed(4)}
          </div>
          <div className="text-8pt text-gray-500 mt-1">
            Claude Haiku
          </div>
        </div>

        <div className="bg-white border-2 border-purple-200 rounded p-3">
          <div className="text-8pt text-gray-500 uppercase tracking-wide mb-1">Tables Ready</div>
          <div className="text-8pt font-bold text-purple-700">
            {data.tables.filter(t => t.rows === 0).length} / {data.tables.length}
          </div>
          <div className="text-8pt text-gray-500 mt-1">
            Waiting for data
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white border-2 border-gray-200 rounded p-4 mb-4">
        <div className="flex justify-between text-8pt mb-2">
          <span className="text-gray-700 uppercase tracking-wide">Angle Detection Progress</span>
          <span className="font-mono text-gray-900">{data.processing.anglesSet} / {data.processing.totalImages}</span>
        </div>
        <div className="bg-gray-100 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${data.processing.percentComplete}%` }}
          />
        </div>
        <div className="flex justify-between text-8pt text-gray-500 mt-1">
          <span>{data.processing.percentComplete.toFixed(1)}% complete</span>
          <span>ETA: {Math.ceil((data.processing.totalImages - data.processing.anglesSet) / 30)} min</span>
        </div>
      </div>

      {/* Professional Tables Population */}
      <div className="bg-white border-2 border-gray-200 rounded p-4 mb-4">
        <h3 className="text-8pt font-bold uppercase tracking-wide mb-3 text-gray-900">Professional Appraisal Tables</h3>
        <div className="space-y-2">
          {data.tables.map((table) => {
            const isEmpty = table.rows === 0;
            
            return (
              <div key={table.name} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div className="flex-1">
                  <div className="text-8pt font-mono text-gray-700">{table.name}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className={`text-8pt font-bold ${isEmpty ? 'text-gray-400' : 'text-green-600'}`}>
                    {table.rows.toLocaleString()} rows
                  </div>
                  <div className={`text-8pt uppercase tracking-wide px-2 py-0.5 rounded ${
                    isEmpty ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700 border border-green-200'
                  }`}>
                    {isEmpty ? 'READY' : 'ACTIVE'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white border-2 border-gray-200 rounded p-4">
        <h3 className="text-8pt font-bold uppercase tracking-wide mb-3 text-gray-900">Recent Activity</h3>
        <div className="space-y-1">
          {data.recentImages.slice(0, 8).map((img, idx) => {
            const timeAgo = Math.floor((Date.now() - new Date(img.timestamp).getTime()) / 1000);
            const timeDisplay = timeAgo < 60 ? `${timeAgo}s ago` :
                               timeAgo < 3600 ? `${Math.floor(timeAgo / 60)}m ago` :
                               `${Math.floor(timeAgo / 3600)}h ago`;
            
            return (
              <div key={idx} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-8pt font-mono text-gray-500">{img.id.substring(0, 8)}</span>
                  <span className="text-8pt text-blue-600 uppercase tracking-wide font-semibold">{img.angle}</span>
                  <span className="text-8pt text-gray-600">{img.category}</span>
                </div>
                <span className="text-8pt text-gray-500">{timeDisplay}</span>
              </div>
            );
          })}
        </div>
        
        {data.recentImages.length === 0 && (
          <p className="text-8pt text-gray-500 text-center py-4">No recent activity</p>
        )}
      </div>

      {/* Auto-refresh indicator */}
      <div className="mt-3 text-center">
        <span className="text-8pt text-gray-500 uppercase tracking-wide">
          Auto-refresh: 3s {data.processing.processing && <span className="text-green-600">● Processing</span>}
        </span>
      </div>
    </div>
  );
}

