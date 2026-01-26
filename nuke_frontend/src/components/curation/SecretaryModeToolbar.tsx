/**
 * Secretary Mode Toolbar
 * 
 * Appears on all pages with pending items
 * Quick stats + rapid navigation to items needing attention
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { FiCheckCircle, FiAlertCircle, FiClock, FiZap } from 'react-icons/fi';

interface SecretaryModeToolbarProps {
  userId: string;
}

interface PendingStats {
  aiDetectionsNeedingReview: number;
  duplicatesNeedingMerge: number;
  missingVINs: number;
  unlinkedReceipts: number;
  totalPending: number;
}

const SecretaryModeToolbar: React.FC<SecretaryModeToolbarProps> = ({ userId }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<PendingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  const loadStats = async () => {
    try {
      // AI detections needing validation
      const { count: aiCount } = await supabase
        .from('ai_component_detections')
        .select('id', { count: 'exact', head: true })
        .is('user_validated', null)
        .in('vehicle_id', 
          supabase.from('vehicles').select('id').eq('user_id', userId)
        );

      // Merge proposals
      const { count: mergeCount } = await supabase
        .from('vehicle_merge_proposals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'proposed')
        .or(`primary_vehicle_id.in.(select id from vehicles where user_id='${userId}'),duplicate_vehicle_id.in.(select id from vehicles where user_id='${userId}')`);

      // Missing VINs
      const { count: vinCount } = await supabase
        .from('vehicles')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .or('vin.is.null,vin.eq.');

      // Unlinked receipts
      const { count: receiptCount } = await supabase
        .from('vehicle_documents')
        .select('id', { count: 'exact', head: true })
        .eq('uploaded_by', userId)
        .eq('document_type', 'receipt')
        .is('linked_to_tag_id', null);

      const total = (aiCount || 0) + (mergeCount || 0) + (vinCount || 0) + (receiptCount || 0);

      setStats({
        aiDetectionsNeedingReview: aiCount || 0,
        duplicatesNeedingMerge: mergeCount || 0,
        missingVINs: vinCount || 0,
        unlinkedReceipts: receiptCount || 0,
        totalPending: total
      });
    } catch (error) {
      console.error('Failed to load secretary mode stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !stats || stats.totalPending === 0) {
    return null; // Don't show if nothing pending
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg shadow-2xl p-4 max-w-md">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FiZap className="w-5 h-5" />
            <span className="font-bold">Secretary Mode</span>
          </div>
          <div className="text-2xl font-bold">{stats.totalPending}</div>
        </div>

        <div className="space-y-2 text-sm">
          {stats.aiDetectionsNeedingReview > 0 && (
            <button
              onClick={() => navigate('/curation-queue')}
              className="w-full flex items-center justify-between p-2 bg-white/20 rounded hover:bg-white/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FiAlertCircle className="w-4 h-4" />
                AI Detections Need Review
              </span>
              <span className="font-bold">{stats.aiDetectionsNeedingReview}</span>
            </button>
          )}

          {stats.duplicatesNeedingMerge > 0 && (
            <button
              onClick={() => navigate('/vehicles?filter=duplicates')}
              className="w-full flex items-center justify-between p-2 bg-white/20 rounded hover:bg-white/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FiAlertCircle className="w-4 h-4" />
                Duplicates to Merge
              </span>
              <span className="font-bold">{stats.duplicatesNeedingMerge}</span>
            </button>
          )}

          {stats.missingVINs > 0 && (
            <button
              onClick={() => navigate('/vehicles?filter=missing-vin')}
              className="w-full flex items-center justify-between p-2 bg-white/20 rounded hover:bg-white/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FiClock className="w-4 h-4" />
                Missing VINs
              </span>
              <span className="font-bold">{stats.missingVINs}</span>
            </button>
          )}

          {stats.unlinkedReceipts > 0 && (
            <button
              onClick={() => navigate('/receipts/unlinked')}
              className="w-full flex items-center justify-between p-2 bg-white/20 rounded hover:bg-white/30 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FiClock className="w-4 h-4" />
                Receipts to Link
              </span>
              <span className="font-bold">{stats.unlinkedReceipts}</span>
            </button>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-white/30 flex items-center justify-between text-xs">
          <span>Your job: Validate AI's work ✓✗</span>
          <button
            onClick={() => navigate('/curation-queue')}
            className="px-3 py-1 bg-white text-orange-600 rounded font-semibold hover:bg-gray-100"
          >
            Start Review →
          </button>
        </div>
      </div>
    </div>
  );
};

export default SecretaryModeToolbar;

