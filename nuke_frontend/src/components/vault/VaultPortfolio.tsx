/**
 * Vault Portfolio Component
 *
 * Displays user's stored vehicles across storage vaults.
 * Shows storage fees, vault details, and vehicle status.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';

export interface StorageVault {
  id: string;
  name: string;
  slug: string;
  facility_type: 'climate_controlled' | 'covered' | 'outdoor' | 'high_security' | 'museum_grade';
  security_level: number;
  city: string;
  state: string;
  country: string;
  capacity_vehicles: number;
  current_occupancy: number;
  base_monthly_rate_cents: number;
  features: string[];
  is_active: boolean;
  accepting_new_vehicles: boolean;
}

export interface VehicleStorage {
  id: string;
  vehicle_id: string;
  vault_id: string;
  offering_id: string | null;
  owner_id: string;
  storage_type: 'standard' | 'premium' | 'long_term' | 'consignment';
  bay_number: string | null;
  start_date: string;
  end_date: string | null;
  monthly_rate_cents: number;
  total_fees_billed_cents: number;
  total_fees_paid_cents: number;
  status: 'pending_intake' | 'active' | 'suspended' | 'pending_release' | 'released';
  mileage_at_intake: number | null;
  condition_notes: string | null;
  vault?: StorageVault;
  vehicle?: {
    id: string;
    year: number;
    make: string;
    model: string;
    vin: string;
  };
}

interface StorageSummary {
  total_vehicles: number;
  total_monthly_fees: number;
  outstanding_balance: number;
  vaults_used: number;
}

interface VaultPortfolioProps {
  userId: string;
  onAllocateVehicle?: () => void;
  onReleaseVehicle?: (storageId: string) => void;
}

const FACILITY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  climate_controlled: { label: 'Climate Controlled', color: 'text-blue-400' },
  covered: { label: 'Covered', color: 'text-gray-400' },
  outdoor: { label: 'Outdoor', color: 'text-yellow-400' },
  high_security: { label: 'High Security', color: 'text-red-400' },
  museum_grade: { label: 'Museum Grade', color: 'text-purple-400' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_intake: { label: 'Pending Intake', color: 'bg-yellow-900/50 text-yellow-400' },
  active: { label: 'Active', color: 'bg-green-900/50 text-green-400' },
  suspended: { label: 'Suspended', color: 'bg-red-900/50 text-red-400' },
  pending_release: { label: 'Pending Release', color: 'bg-blue-900/50 text-blue-400' },
  released: { label: 'Released', color: 'bg-gray-700 text-gray-400' },
};

export const VaultPortfolio: React.FC<VaultPortfolioProps> = ({
  userId,
  onAllocateVehicle,
  onReleaseVehicle,
}) => {
  const [storageRecords, setStorageRecords] = useState<VehicleStorage[]>([]);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [availableVaults, setAvailableVaults] = useState<StorageVault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVault, setSelectedVault] = useState<string | null>(null);

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch user's storage records with vehicle and vault details
      const { data: storage, error: storageError } = await supabase
        .from('vehicle_storage')
        .select(`
          *,
          vault:storage_vaults (
            id, name, slug, facility_type, security_level,
            city, state, features
          ),
          vehicle:vehicles (
            id, year, make, model, vin
          )
        `)
        .eq('owner_id', userId)
        .in('status', ['pending_intake', 'active', 'suspended', 'pending_release'])
        .order('created_at', { ascending: false });

      if (storageError) throw storageError;

      setStorageRecords(storage || []);

      // Calculate summary
      const records = storage || [];
      const summaryData: StorageSummary = {
        total_vehicles: records.length,
        total_monthly_fees: records.reduce((sum, r) => sum + r.monthly_rate_cents, 0),
        outstanding_balance: records.reduce(
          (sum, r) => sum + (r.total_fees_billed_cents - r.total_fees_paid_cents),
          0
        ),
        vaults_used: new Set(records.map((r) => r.vault_id)).size,
      };
      setSummary(summaryData);

      // Fetch available vaults
      const { data: vaults, error: vaultsError } = await supabase
        .from('storage_vaults')
        .select('*')
        .eq('is_active', true)
        .eq('accepting_new_vehicles', true)
        .order('name');

      if (vaultsError) throw vaultsError;

      setAvailableVaults(vaults || []);
    } catch (err) {
      console.error('Failed to fetch storage data:', err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReleaseRequest = async (storageId: string) => {
    if (!confirm('Request vehicle release? You will need to pay any outstanding fees.')) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc('release_vehicle_from_vault', {
        p_storage_id: storageId,
        p_user_id: userId,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error);
      }

      onReleaseVehicle?.(storageId);
      fetchData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const renderSecurityLevel = (level: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full ${
              i <= level ? 'bg-green-500' : 'bg-gray-700'
            }`}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-gray-950 rounded-xl p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-800 rounded w-1/3"></div>
          <div className="grid grid-cols-4 gap-4">
            <div className="h-20 bg-gray-800 rounded"></div>
            <div className="h-20 bg-gray-800 rounded"></div>
            <div className="h-20 bg-gray-800 rounded"></div>
            <div className="h-20 bg-gray-800 rounded"></div>
          </div>
          <div className="h-48 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase">Vehicles Stored</p>
            <p className="text-2xl font-bold text-white">{summary.total_vehicles}</p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase">Monthly Fees</p>
            <p className="text-2xl font-bold text-white">
              {formatCurrency(summary.total_monthly_fees)}
            </p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase">Outstanding</p>
            <p
              className={`text-2xl font-bold ${
                summary.outstanding_balance > 0 ? 'text-red-400' : 'text-green-400'
              }`}
            >
              {formatCurrency(summary.outstanding_balance)}
            </p>
          </div>
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase">Vaults Used</p>
            <p className="text-2xl font-bold text-white">{summary.vaults_used}</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Stored Vehicles */}
      <div className="bg-gray-950 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-6 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Stored Vehicles</h2>
          {onAllocateVehicle && (
            <button
              onClick={onAllocateVehicle}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Add Vehicle
            </button>
          )}
        </div>

        {storageRecords.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-400">No vehicles in storage</p>
            {onAllocateVehicle && (
              <button
                onClick={onAllocateVehicle}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Store Your First Vehicle
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {storageRecords.map((record) => {
              const vehicle = record.vehicle;
              const vault = record.vault;
              const statusInfo = STATUS_LABELS[record.status];
              const facilityInfo = vault
                ? FACILITY_TYPE_LABELS[vault.facility_type]
                : null;
              const outstanding =
                record.total_fees_billed_cents - record.total_fees_paid_cents;

              return (
                <div key={record.id} className="p-4 hover:bg-gray-900/50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    {/* Vehicle Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-white font-medium">
                          {vehicle
                            ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
                            : 'Unknown Vehicle'}
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </div>

                      {vehicle?.vin && (
                        <p className="text-xs text-gray-500 font-mono mt-1">
                          VIN: {vehicle.vin}
                        </p>
                      )}

                      {vault && (
                        <div className="mt-2 flex items-center gap-4 text-sm">
                          <span className="text-gray-300">{vault.name}</span>
                          <span className="text-gray-500">
                            {vault.city}, {vault.state}
                          </span>
                          {facilityInfo && (
                            <span className={facilityInfo.color}>
                              {facilityInfo.label}
                            </span>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500 text-xs">Security:</span>
                            {renderSecurityLevel(vault.security_level)}
                          </div>
                        </div>
                      )}

                      <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
                        <span>Since {formatDate(record.start_date)}</span>
                        <span className="capitalize">{record.storage_type}</span>
                        {record.bay_number && <span>Bay {record.bay_number}</span>}
                      </div>
                    </div>

                    {/* Fees & Actions */}
                    <div className="text-right">
                      <p className="text-lg font-medium text-white">
                        {formatCurrency(record.monthly_rate_cents)}
                        <span className="text-xs text-gray-400">/mo</span>
                      </p>

                      {outstanding > 0 && (
                        <p className="text-sm text-red-400 mt-1">
                          {formatCurrency(outstanding)} due
                        </p>
                      )}

                      {record.status === 'active' && (
                        <button
                          onClick={() => handleReleaseRequest(record.id)}
                          className="mt-2 text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          Request Release
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Available Vaults */}
      <div className="bg-gray-950 rounded-xl overflow-hidden">
        <div className="bg-gray-900 px-6 py-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Available Vaults</h2>
          <p className="text-sm text-gray-400 mt-1">
            Storage facilities accepting new vehicles
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
          {availableVaults.map((vault) => {
            const facilityInfo = FACILITY_TYPE_LABELS[vault.facility_type];
            const occupancyPct = Math.round(
              (vault.current_occupancy / vault.capacity_vehicles) * 100
            );

            return (
              <div
                key={vault.id}
                className={`bg-gray-900 rounded-lg p-4 border-2 transition-colors cursor-pointer ${
                  selectedVault === vault.id
                    ? 'border-blue-500'
                    : 'border-transparent hover:border-gray-700'
                }`}
                onClick={() =>
                  setSelectedVault(selectedVault === vault.id ? null : vault.id)
                }
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-white font-medium">{vault.name}</h3>
                    <p className="text-sm text-gray-400">
                      {vault.city}, {vault.state}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-medium text-white">
                      {formatCurrency(vault.base_monthly_rate_cents)}
                    </p>
                    <p className="text-xs text-gray-400">/month</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <span className={`text-sm ${facilityInfo.color}`}>
                    {facilityInfo.label}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs">Security:</span>
                    {renderSecurityLevel(vault.security_level)}
                  </div>
                </div>

                {/* Capacity Bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Capacity</span>
                    <span>
                      {vault.current_occupancy}/{vault.capacity_vehicles} ({occupancyPct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        occupancyPct > 90
                          ? 'bg-red-500'
                          : occupancyPct > 70
                          ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`}
                      style={{ width: `${occupancyPct}%` }}
                    />
                  </div>
                </div>

                {/* Features */}
                {vault.features && vault.features.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(vault.features as string[]).slice(0, 4).map((feature, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 bg-gray-800 text-gray-400 text-xs rounded"
                      >
                        {feature}
                      </span>
                    ))}
                    {vault.features.length > 4 && (
                      <span className="px-2 py-0.5 text-gray-500 text-xs">
                        +{vault.features.length - 4} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default VaultPortfolio;
