/**
 * SIMPLER PROCESSING MONITOR
 * Lightweight version for quick monitoring
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ProcessingMonitor() {
  const [stats, setStats] = useState({
    total: 0,
    processed: 0,
    processing: false
  });

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 3000);
    return () => clearInterval(interval);
  }, []);

  async function loadStats() {
    const { data } = await supabase
      .from('vehicle_images')
      .select('ai_scan_metadata');

    const total = data?.length || 0;
    const processed = data?.filter(
      img => img.ai_scan_metadata?.tier_1_analysis
    ).length || 0;

    setStats({
      total,
      processed,
      processing: processed < total
    });
  }

  const percent = stats.total > 0 ? (stats.processed / stats.total) * 100 : 0;

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 border-2 border-blue-600 rounded-lg p-4 shadow-2xl w-80">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Image Processing</div>
        {stats.processing && (
          <div className="flex items-center space-x-2">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-xs text-green-400">Processing...</span>
          </div>
        )}
      </div>

      <div className="mb-2">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Progress</span>
          <span>{stats.processed.toLocaleString()} / {stats.total.toLocaleString()}</span>
        </div>
        <div className="bg-gray-800 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="text-xs text-center mt-1 text-gray-500">
          {percent.toFixed(1)}% complete
        </div>
      </div>

      {stats.processing && (
        <div className="text-xs text-center text-gray-400 mt-2">
          Auto-updating every 3s
        </div>
      )}

      {!stats.processing && stats.processed > 0 && (
        <div className="text-xs text-center text-green-400 mt-2">
          ✓ Processing complete!
        </div>
      )}
    </div>
  );
}

