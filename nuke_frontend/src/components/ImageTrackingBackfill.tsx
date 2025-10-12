import React, { useState } from 'react';
import type { ImageTrackingService } from '../services/imageTrackingService';

interface BackfillStats {
  totalImages: number;
  imagesWithTimeline: number;
  imagesWithoutTimeline: number;
  coveragePercentage: number;
}

interface BackfillResult {
  processed: number;
  errors: number;
}

const ImageTrackingBackfill: React.FC = () => {
  const [stats, setStats] = useState<BackfillStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isRunningBackfill, setIsRunningBackfill] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [isValidatingContributions, setIsValidatingContributions] = useState(false);

  const loadStats = async () => {
    setIsLoadingStats(true);
    try {
      const trackingStats = await ImageTrackingService.getTrackingStats();
      setStats(trackingStats);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const runBackfill = async () => {
    setIsRunningBackfill(true);
    setBackfillResult(null);
    try {
      const result = await ImageTrackingService.backfillImageTracking();
      setBackfillResult(result);
      // Refresh stats after backfill
      await loadStats();
    } catch (error) {
      console.error('Error running backfill:', error);
    } finally {
      setIsRunningBackfill(false);
    }
  };

  const validateContributions = async () => {
    setIsValidatingContributions(true);
    try {
      await ImageTrackingService.validateUserContributions();
      // Refresh stats after validation
      await loadStats();
    } catch (error) {
      console.error('Error validating contributions:', error);
    } finally {
      setIsValidatingContributions(false);
    }
  };

  return (
    <div className="card">
      <div className="card-body">
        <h3 className="text font-bold mb-4">Image Tracking & Timeline Backfill</h3>
        
        <div className="space-y-4">
          {/* Stats Section */}
          <div className="section">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text font-medium">Current Coverage</h4>
              <button 
                onClick={loadStats}
                disabled={isLoadingStats}
                className="button button-secondary text-sm"
              >
                {isLoadingStats ? 'Loading...' : 'Refresh Stats'}
              </button>
            </div>
            
            {stats && (
              <div className="bg-gray-50 p-3 rounded">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">Total Images</div>
                    <div className="text-2xl font-bold">{stats.totalImages.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="font-medium">Coverage</div>
                    <div className="text-2xl font-bold text-green-600">{stats.coveragePercentage}%</div>
                  </div>
                  <div>
                    <div className="font-medium">With Timeline</div>
                    <div className="text-lg text-green-600">{stats.imagesWithTimeline.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="font-medium">Missing Timeline</div>
                    <div className="text-lg text-red-600">{stats.imagesWithoutTimeline.toLocaleString()}</div>
                  </div>
                </div>
                
                {/* Progress bar */}
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${stats.coveragePercentage}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {stats.imagesWithTimeline} of {stats.totalImages} images have timeline events
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Backfill Section */}
          <div className="section">
            <h4 className="text font-medium mb-2">Backfill Timeline Events</h4>
            <p className="text-sm text-gray-600 mb-3">
              Creates timeline events and user contributions for existing images that don't have them.
              This process runs in batches and may take several minutes for large datasets.
            </p>
            
            <button 
              onClick={runBackfill}
              disabled={isRunningBackfill || (stats?.imagesWithoutTimeline === 0)}
              className="button button-primary"
            >
              {isRunningBackfill ? 'Running Backfill...' : 'Run Backfill Process'}
            </button>
            
            {stats?.imagesWithoutTimeline === 0 && (
              <div className="text-sm text-green-600 mt-2">
                ✅ All images have timeline events - no backfill needed
              </div>
            )}
            
            {backfillResult && (
              <div className="mt-3 p-3 bg-blue-50 rounded">
                <div className="text-sm">
                  <div className="font-medium text-blue-800">Backfill Complete</div>
                  <div className="text-blue-700">
                    ✅ Processed: {backfillResult.processed} images<br/>
                    {backfillResult.errors > 0 && (
                      <span className="text-red-600">❌ Errors: {backfillResult.errors}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Validation Section */}
          <div className="section">
            <h4 className="text font-medium mb-2">Validate User Contributions</h4>
            <p className="text-sm text-gray-600 mb-3">
              Validates and fixes user contribution counts in profile stats to match actual image counts.
            </p>
            
            <button 
              onClick={validateContributions}
              disabled={isValidatingContributions}
              className="button button-secondary"
            >
              {isValidatingContributions ? 'Validating...' : 'Validate Contributions'}
            </button>
          </div>

          {/* Warning */}
          <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
            <div className="text-sm text-yellow-800">
              <div className="font-medium">⚠️ Important Notes</div>
              <ul className="mt-1 space-y-1 text-xs">
                <li>• Backfill process creates timeline events for ALL existing images</li>
                <li>• This will update user contribution counts and may trigger achievements</li>
                <li>• Process runs in batches to avoid overwhelming the database</li>
                <li>• Safe to run multiple times - won't create duplicate events</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageTrackingBackfill;
