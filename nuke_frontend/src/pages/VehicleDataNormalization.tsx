import React, { useState, useEffect } from 'react';
import type { VehicleDataNormalizationService } from '../services/vehicleDataNormalizationService';
import type { NormalizationStats } from '../services/vehicleDataNormalizationService';
import AppLayout from '../components/layout/AppLayout';

interface VehicleReview {
  vehicle: any;
  normalizationResult: any;
}

const VehicleDataNormalization: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [normalizing, setNormalizing] = useState(false);
  const [vehiclesForReview, setVehiclesForReview] = useState<VehicleReview[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [normalizationProgress, setNormalizationProgress] = useState<NormalizationStats | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const [statsData, reviewVehicles] = await Promise.all([
        VehicleDataNormalizationService.getNormalizationStats(),
        VehicleDataNormalizationService.getVehiclesRequiringReview()
      ]);
      
      setStats(statsData);
      setVehiclesForReview(reviewVehicles);
    } catch (error) {
      console.error('Error loading normalization stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const runNormalization = async (dryRun: boolean = false) => {
    try {
      setNormalizing(true);
      setNormalizationProgress(null);

      const result = await VehicleDataNormalizationService.normalizeAllVehicles(
        dryRun,
        (progress) => {
          setNormalizationProgress({ ...progress });
        }
      );

      alert(`Normalization ${dryRun ? 'analysis' : 'complete'}!\n\nProcessed: ${result.processed}\nNormalized: ${result.normalized}\nFailed: ${result.failed}\nNeeds Review: ${result.requiresReview}`);
      
      // Reload stats
      await loadStats();
    } catch (error) {
      console.error('Error running normalization:', error);
      alert('Error running normalization. Check console for details.');
    } finally {
      setNormalizing(false);
      setNormalizationProgress(null);
    }
  };

  const approveNormalization = async (vehicleId: string, make: string, model: string) => {
    try {
      const success = await VehicleDataNormalizationService.approveNormalization(vehicleId, make, model);
      if (success) {
        // Remove from review list
        setVehiclesForReview(prev => prev.filter(v => v.vehicle.id !== vehicleId));
        await loadStats();
      } else {
        alert('Failed to approve normalization');
      }
    } catch (error) {
      console.error('Error approving normalization:', error);
      alert('Error approving normalization');
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p>Loading normalization data...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Vehicle Data Normalization</h1>
            <p className="mt-2 text-gray-600">
              Standardize vehicle make and model names across your database to ensure consistency and better organization.
            </p>
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">T</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Vehicles</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats?.total || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">✓</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Normalized</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats?.normalized || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">?</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Needs Review</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats?.needsReview || 0}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white overflow-hidden shadow rounded-lg">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-gray-500 rounded-md flex items-center justify-center">
                      <span className="text-white text-sm font-bold">%</span>
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Completion</dt>
                      <dd className="text-lg font-medium text-gray-900">{stats?.percentage || 0}%</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          {stats && (
            <div className="mb-8 bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Normalization Progress</h3>
              <div className="w-full bg-gray-200 rounded-full h-2.5 mb-4">
                <div 
                  className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${stats.percentage}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>{stats.normalized} of {stats.total} vehicles normalized</span>
                <span>{stats.percentage}% complete</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mb-8 bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Actions</h3>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={() => runNormalization(true)}
                disabled={normalizing}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
              >
                {normalizing ? 'Analyzing...' : 'Analyze Data (Dry Run)'}
              </button>
              
              <button
                onClick={() => runNormalization(false)}
                disabled={normalizing}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
              >
                {normalizing ? 'Normalizing...' : 'Run Normalization'}
              </button>

              <button
                onClick={() => setShowReviewModal(true)}
                disabled={vehiclesForReview.length === 0}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
              >
                Review Vehicles ({vehiclesForReview.length})
              </button>

              <button
                onClick={loadStats}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
              >
                Refresh Stats
              </button>
            </div>
          </div>

          {/* Progress Display */}
          {normalizationProgress && (
            <div className="mb-8 bg-white shadow rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Processing Progress</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Processed:</span>
                  <span>{normalizationProgress.processed} / {normalizationProgress.totalVehicles}</span>
                </div>
                <div className="flex justify-between">
                  <span>Normalized:</span>
                  <span className="text-green-600">{normalizationProgress.normalized}</span>
                </div>
                <div className="flex justify-between">
                  <span>Failed:</span>
                  <span className="text-red-600">{normalizationProgress.failed}</span>
                </div>
              </div>
            </div>
          )}

          {/* Review Modal */}
          {showReviewModal && (
            <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
              <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
                <div className="mt-3">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-900">Vehicles Requiring Manual Review</h3>
                    <button
                      onClick={() => setShowReviewModal(false)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <span className="sr-only">Close</span>
                      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="max-h-96 overflow-y-auto">
                    {vehiclesForReview.map((item, index) => (
                      <div key={item.vehicle.id} className="border-b border-gray-200 py-4">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h4 className="font-medium text-gray-900">
                              {item.vehicle.year} {item.vehicle.make} {item.vehicle.model}
                            </h4>
                            <p className="text-sm text-gray-600 mt-1">
                              Original: "{item.normalizationResult.originalMake}" "{item.normalizationResult.originalModel}"
                            </p>
                            
                            {item.normalizationResult.suggestions && item.normalizationResult.suggestions.length > 0 && (
                              <div className="mt-2">
                                <p className="text-sm font-medium text-gray-700">Suggestions:</p>
                                <div className="mt-1 space-y-1">
                                  {item.normalizationResult.suggestions.map((suggestion: any, idx: number) => (
                                    <div key={idx} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                                      <span className="text-sm">
                                        {suggestion.make} {suggestion.model}
                                      </span>
                                      <button
                                        onClick={() => approveNormalization(item.vehicle.id, suggestion.make, suggestion.model)}
                                        className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded"
                                      >
                                        Approve
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {vehiclesForReview.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      No vehicles require manual review at this time.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default VehicleDataNormalization;
