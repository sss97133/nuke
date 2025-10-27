import React, { useState, useEffect, useCallback, memo } from 'react';
import { 
  DollarSign, Package, TrendingUp, Upload, Download,
  Plus, Edit2, CheckCircle, AlertCircle, Calculator,
  FileText, Activity, Clock, Wrench
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { BuildImportService } from '../../services/buildImportService';
import { VehicleValuationService } from '../../services/vehicleValuationService';
import VehicleDocumentUploader from '../documents/VehicleDocumentUploader';
import VehicleErrorBoundary from './VehicleErrorBoundary';
import '../../design-system.css';

interface VehicleBuildSystemProps {
  vehicleId: string;
  isOwner: boolean;
}

interface UnifiedBuildItem {
  id: string;
  // Core fields
  name: string;
  category: string;
  brand?: string;
  model?: string;
  part_number?: string;
  
  // Installation/status
  status: 'planning' | 'ordered' | 'received' | 'installed' | 'completed';
  installation_date?: string;
  installation_hours?: number;
  
  // Financial
  purchase_price?: number;
  market_value?: number;
  condition: 'new' | 'used' | 'rebuilt' | 'refurbished';
  
  // Documentation
  invoice_number?: string;
  supplier?: string;
  notes?: string;
  images?: any[];
}

interface BuildValuation {
  totalInvested: number;
  currentMarketValue: number;
  comparableVehicles: any[];
  valueBreakdown: {
    category: string;
    invested: number;
    marketValue: number;
  }[];
}

const VehicleBuildSystem: React.FC<VehicleBuildSystemProps> = memo(({
  vehicleId,
  isOwner
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'parts' | 'valuation'>('overview');
  const [buildItems, setBuildItems] = useState<UnifiedBuildItem[]>([]);
  const [valuation, setValuation] = useState<BuildValuation | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState('');
  const [editingItem, setEditingItem] = useState<UnifiedBuildItem | null>(null);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalInvested: 0,
    installedCount: 0,
    pendingCount: 0,
    totalHours: 0,
    estimatedValue: 0
  });

  const loadBuildData = useCallback(async () => {
    try {
      setLoading(true);

      // Use the shared valuation service for consistent data
      const valuation = await VehicleValuationService.getValuation(vehicleId);

      // Update stats with real valuation data
      setStats({
        totalInvested: valuation.totalInvested,
        installedCount: valuation.installedParts,
        pendingCount: valuation.pendingParts,
        totalHours: valuation.laborHours,
        estimatedValue: valuation.estimatedValue
      });

      // Set the valuation for the valuation tab, prefer categoryBreakdown
      const categoryBreakdown = (valuation as any).categoryBreakdown && (valuation as any).categoryBreakdown.length > 0
        ? (valuation as any).categoryBreakdown
        : [];
      setValuation({
        totalInvested: valuation.totalInvested,
        currentMarketValue: valuation.estimatedValue,
        comparableVehicles: [],
        valueBreakdown: (categoryBreakdown.length > 0
          ? categoryBreakdown
          : valuation.topParts.map(part => ({
              category: 'Parts',
              invested: part.price,
              marketValue: part.price * 1.2
            }))
        )
      });

      // Get the build ID if it exists
      const { data: buildData } = await supabase
        .from('vehicle_builds')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();

      const buildId = buildData?.id;

      // Load from multiple sources and unify
      const [buildResult, componentsResult] = await Promise.all([
        // Load from build_line_items
        buildId ? supabase
          .from('build_line_items')
          .select(`
            *,
            part_categories (name),
            suppliers (name)
          `)
          .eq('build_id', buildId) : Promise.resolve({ data: null }),

        // Load from component_installations (might not exist)
        supabase
          .from('component_installations')
          .select(`
            *,
            components (*)
          `)
          .eq('vehicle_id', vehicleId)
          .or('id.is.null') // This prevents 404 if table doesn't exist
      ]);

      // Also check vehicle_data for additional specs
      const { data: vehicleData } = await supabase
        .from('vehicle_data')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .single();

      // Merge and deduplicate data
      const unifiedItems = mergeDataSources(
        buildResult.data || [],
        componentsResult.data || [],
        vehicleData
      );

      setBuildItems(unifiedItems);
      await calculateStats(unifiedItems);
      await calculateValuation(unifiedItems);

    } catch (error) {
      console.error('Error loading build data:', error);
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    loadBuildData();
  }, [loadBuildData]);

  const mergeDataSources = (buildItems: any[], components: any[], vehicleData: any) => {
    const unified: UnifiedBuildItem[] = [];
    const seen = new Set<string>();

    // Process build_line_items
    buildItems?.forEach(item => {
      const key = `${item.name}-${item.category}`;
      if (!seen.has(key)) {
        seen.add(key);
        unified.push({
          id: item.id,
          name: item.name,
          category: item.part_categories?.name || item.category || 'Uncategorized',
          status: mapStatus(item.status),
          purchase_price: item.total_price || item.unit_price,
          condition: item.condition || 'new',
          supplier: item.suppliers?.name || item.supplier,
          installation_date: item.date_installed,
          installation_hours: item.days_to_install ? item.days_to_install * 8 : 0,
          notes: item.notes
        });
      }
    });

    // Process component_installations
    components?.forEach(comp => {
      const item = comp.components;
      if (item) {
        const key = `${item.name}-${item.category}`;
        if (!seen.has(key)) {
          seen.add(key);
          unified.push({
            id: comp.id,
            name: item.name,
            category: item.category || 'Modifications',
            brand: item.brand,
            model: item.model,
            part_number: item.part_number,
            status: comp.installation_date ? 'installed' : 'planning',
            purchase_price: comp.purchase_price,
            market_value: item.estimated_value,
            condition: comp.condition || 'new',
            installation_date: comp.installation_date,
            notes: comp.notes
          });
        }
      }
    });

    // Extract key mods from vehicle_data
    if (vehicleData) {
      // Add engine if modified
      if (vehicleData.engine && vehicleData.engine !== 'Stock') {
        const engineKey = `engine-${vehicleData.engine}`;
        if (!seen.has(engineKey)) {
          unified.push({
            id: 'engine-mod',
            name: vehicleData.engine,
            category: 'Engine',
            status: 'installed',
            condition: 'new'
          });
        }
      }

      // Add transmission if modified
      if (vehicleData.transmission && vehicleData.transmission !== 'Stock') {
        const transKey = `trans-${vehicleData.transmission}`;
        if (!seen.has(transKey)) {
          unified.push({
            id: 'trans-mod',
            name: vehicleData.transmission,
            category: 'Transmission',
            status: 'installed',
            condition: 'new'
          });
        }
      }
    }

    return unified;
  };

  const mapStatus = (status: string): UnifiedBuildItem['status'] => {
    const statusMap: Record<string, UnifiedBuildItem['status']> = {
      'completed': 'completed',
      'installed': 'installed',
      'in_progress': 'installed',
      'ordered': 'ordered',
      'received': 'received',
      'planning': 'planning',
      'pending': 'planning'
    };
    return statusMap[status] || 'planning';
  };

  const calculateStats = async (items: UnifiedBuildItem[]) => {
    const totalInvested = items.reduce((sum, item) => 
      sum + (item.purchase_price || 0), 0);
    
    const installedCount = items.filter(i => 
      ['installed', 'completed'].includes(i.status)).length;
    
    const pendingCount = items.filter(i => 
      ['ordered', 'received'].includes(i.status)).length;
    
    const totalHours = items.reduce((sum, item) => 
      sum + (item.installation_hours || 0), 0);

    // Use proper valuation service instead of hardcoded multiplier
    try {
      const valuation = await VehicleValuationService.getValuation(vehicleId);
      setStats({
        totalInvested,
        installedCount,
        pendingCount,
        totalHours,
        estimatedValue: valuation.estimatedValue
      });
    } catch (error) {
      console.warn('Failed to get real valuation, using fallback calculation:', error);
      // Fallback to basic calculation only if valuation service fails
      setStats({
        totalInvested,
        installedCount,
        pendingCount,
        totalHours,
        estimatedValue: Math.round(totalInvested * 1.15) // More conservative fallback
      });
    }
  };

  const calculateValuation = async (items: UnifiedBuildItem[]) => {
    // Group by category
    const categoryBreakdown = items.reduce((acc, item) => {
      const cat = item.category;
      if (!acc[cat]) {
        acc[cat] = { invested: 0, marketValue: 0 };
      }
      acc[cat].invested += item.purchase_price || 0;
      acc[cat].marketValue += item.market_value || item.purchase_price || 0;
      return acc;
    }, {} as Record<string, { invested: number; marketValue: number }>);

    const breakdown = Object.entries(categoryBreakdown).map(([category, values]) => ({
      category,
      invested: values.invested,
      marketValue: values.marketValue
    }));

    // Load comparable vehicles
    const { data: comparables } = await supabase
      .from('build_benchmarks')
      .select('*')
      .limit(5);

    setValuation({
      totalInvested: stats.totalInvested,
      currentMarketValue: stats.estimatedValue,
      comparableVehicles: comparables || [],
      valueBreakdown: breakdown
    });
  };

  const handleImport = useCallback(async () => {
    if (!importData.trim()) return;
    
    try {
      const items = await BuildImportService.parseCSV(importData);
      const build = await BuildImportService.importBuildData(
        vehicleId,
        'Build Import',
        items
      );
      
      await loadBuildData();
      setShowImport(false);
      setImportData('');
    } catch (error) {
      console.error('Import error:', error);
      alert('Error importing data');
    }
  }, [importData, vehicleId, loadBuildData]);

  const getStatusIcon = useCallback((status: string) => {
    switch(status) {
      case 'completed':
      case 'installed': return <CheckCircle className="w-4 h-4" />;
      case 'ordered': return <Package className="w-4 h-4" />;
      case 'planning': return <AlertCircle className="w-4 h-4" />;
      default: return null;
    }
  }, []);
  const handleClose = useCallback(() => setShowDocumentUpload(false), []);
  const handleUploadSuccess = useCallback(() => { loadBuildData(); }, [loadBuildData]);
  if (loading) {
    return (
      <div className="card">
        <div className="card-body text-center">
          <p>Loading build data...</p>
        </div>
      </div>
    );
  }

  return (
    <VehicleErrorBoundary
      vehicleId={vehicleId}
      componentName="Build & Valuation System"
    >
      <div className="layout">
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text font-bold">B&V</h2>
            </div>
            {isOwner && (
              <div className="flex gap-2">
                <button onClick={() => setShowImport(true)} className="button button-secondary">
                  <Upload className="w-4 h-4" />
                  <span>Import</span>
                </button>
                <button onClick={() => setShowItemModal(true)} className="button button-primary">
                  <Plus className="w-4 h-4" />
                  <span>Add Part</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Summary Cards */}
      <section className="section">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="card" style={{ padding: '8px' }}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text text-muted" style={{ fontSize: '11px', margin: 0 }}>Invested</p>
                  <p className="text font-bold" style={{ fontSize: '14px', margin: 0 }}>${stats.totalInvested.toLocaleString()}</p>
                </div>
                <DollarSign className="w-3 h-3" />
              </div>
            </div>

            <div className="card" style={{ padding: '8px' }}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text text-muted" style={{ fontSize: '11px', margin: 0 }}>Value</p>
                  <p className="text font-bold" style={{ fontSize: '14px', margin: 0 }}>${stats.estimatedValue.toLocaleString()}</p>
                </div>
                <TrendingUp className="w-3 h-3" />
              </div>
            </div>

            <div className="card" style={{ padding: '8px' }}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text text-muted" style={{ fontSize: '11px', margin: 0 }}>Installed</p>
                  <p className="text font-bold" style={{ fontSize: '14px', margin: 0 }}>{stats.installedCount}</p>
                </div>
                <CheckCircle className="w-3 h-3" />
              </div>
            </div>

            <div className="card" style={{ padding: '8px' }}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text text-muted" style={{ fontSize: '11px', margin: 0 }}>Pending</p>
                  <p className="text font-bold" style={{ fontSize: '14px', margin: 0 }}>{stats.pendingCount}</p>
                </div>
                <Package className="w-3 h-3" />
              </div>
            </div>

            <div className="card" style={{ padding: '8px' }}>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text text-muted" style={{ fontSize: '11px', margin: 0 }}>Hours</p>
                  <p className="text font-bold" style={{ fontSize: '14px', margin: 0 }}>{stats.totalHours}</p>
                </div>
                <Clock className="w-3 h-3" />
              </div>
            </div>

            {/* Document Upload Card */}
            {isOwner && (
              <div
                className="card"
                style={{
                  padding: '8px',
                  cursor: 'pointer',
                  backgroundColor: 'var(--button-primary-bg)',
                  borderColor: 'var(--button-primary-border)'
                }}
                onClick={() => setShowDocumentUpload(true)}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text text-muted" style={{ fontSize: '11px', margin: 0, color: 'rgba(255,255,255,0.8)' }}>Add</p>
                    <p className="text font-bold" style={{ fontSize: '14px', margin: 0, color: 'white' }}>Documents</p>
                  </div>
                  <FileText className="w-3 h-3" style={{ color: 'white' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Tabs */}
      <section className="section">
        <div className="container">
          <div className="nav">
            <div className="nav-menu">
              {['overview', 'parts', 'valuation'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as any)}
                  className={activeTab === tab ? 'button button-primary' : 'button button-secondary'}
                >
                  <span className="text capitalize">{tab}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tab Content */}
      <section className="section">
        <div className="container">
          <div className="card">
            <div className="card-body">
              {activeTab === 'overview' && (
                <div>
                  <h3 className="text font-bold mb-4">Build Overview</h3>
                  
                  {/* Category Breakdown */}
                  <div className="mb-6">
                    <h4 className="text font-semibold mb-2">Investment by Category</h4>
                    <div className="space-y-2">
                      {valuation?.valueBreakdown
                        .sort((a, b) => b.invested - a.invested)
                        .slice(0, 5)
                        .map(cat => (
                          <div key={cat.category} className="flex justify-between items-center">
                            <span className="text">{cat.category}</span>
                            <div className="text-right">
                              <span className="text font-bold">${cat.invested.toLocaleString()}</span>
                              {cat.marketValue > cat.invested && (
                                <span className="text text-muted ml-2">
                                  (${cat.marketValue.toLocaleString()})
                                </span>
                              )}
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <h4 className="text font-semibold mb-2">Installation Progress</h4>
                    <div style={{
                      width: '100%',
                      height: '8px',
                      backgroundColor: 'var(--grey-300)',
                      border: '1px solid var(--border-medium)'
                    }}>
                      <div style={{
                        height: '6px',
                        backgroundColor: 'var(--text)',
                        width: `${(stats.installedCount / buildItems.length) * 100}%`
                      }} />
                    </div>
                    <p className="text text-muted mt-1">
                      {stats.installedCount} of {buildItems.length} parts installed
                    </p>
                  </div>

                  {/* Document Management */}
                  {isOwner && (
                    <div className="mt-6">
                      <h4 className="text font-semibold mb-2">Documentation</h4>
                      <p className="text text-muted mb-3">Track receipts and paperwork for this build</p>
                      <button
                        className="button button-secondary"
                        onClick={() => setShowDocumentUpload(true)}
                      >
                        <FileText size={16} style={{ marginRight: '8px' }} />
                        Add Document
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'parts' && (
                <div>
                  <h3 className="text font-bold mb-4">Parts & Modifications</h3>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Part/Modification</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Cost</th>
                        <th>Value</th>
                        {isOwner && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {buildItems.map(item => (
                        <tr key={item.id}>
                          <td>
                            <div>
                              <p className="text font-semibold">{item.name}</p>
                              {item.brand && (
                                <p className="text text-muted text-sm">{item.brand} {item.model}</p>
                              )}
                            </div>
                          </td>
                          <td className="text">{item.category}</td>
                          <td>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(item.status)}
                              <span className="text">{item.status}</span>
                            </div>
                          </td>
                          <td className="text">
                            {item.purchase_price ? `$${item.purchase_price.toLocaleString()}` : '-'}
                          </td>
                          <td className="text">
                            {item.market_value ? `$${item.market_value.toLocaleString()}` : '-'}
                          </td>
                          {isOwner && (
                            <td>
                              <button 
                                onClick={() => {
                                  setEditingItem(item);
                                  setShowItemModal(true);
                                }}
                                className="text-link"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'valuation' && (
                <div>
                  <h3 className="text font-bold mb-4">Vehicle Valuation</h3>
                  
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="card">
                      <div className="card-body">
                        <p className="text text-muted">Total Investment</p>
                        <p className="text font-bold text-xl">
                          ${valuation?.totalInvested.toLocaleString() || 0}
                        </p>
                      </div>
                    </div>
                    <div className="card">
                      <div className="card-body">
                        <p className="text text-muted">Estimated Market Value</p>
                        <p className="text font-bold text-xl">
                          ${valuation?.currentMarketValue.toLocaleString() || 0}
                        </p>
                        {valuation && valuation.currentMarketValue > valuation.totalInvested && (
                          <p className="text text-success">
                            +${(valuation.currentMarketValue - valuation.totalInvested).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {valuation?.comparableVehicles && valuation.comparableVehicles.length > 0 && (
                    <div>
                      <h4 className="text font-semibold mb-2">Comparable Sales</h4>
                      <div className="space-y-2">
                        {valuation.comparableVehicles.map((comp, idx) => (
                          <div key={idx} className="flex justify-between">
                            <span className="text">
                              {comp.year} {comp.make} {comp.model}
                            </span>
                            <span className="text font-bold">
                              ${comp.sale_price?.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Import Modal */}
      {showImport && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50
        }}>
          <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
            <div className="card-header">
              <h3 className="text font-bold">Import Build Data</h3>
            </div>
            <div className="card-body">
              <textarea
                value={importData}
                onChange={(e) => setImportData(e.target.value)}
                className="form-input"
                style={{ height: '200px', width: '100%' }}
                placeholder="Paste CSV data here..."
              />
            </div>
            <div className="card-footer">
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowImport(false)} className="button button-secondary">
                  Cancel
                </button>
                <button onClick={handleImport} className="button button-primary">
                  Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Upload Modal */}
      {showDocumentUpload && (
        <VehicleDocumentUploader
          vehicleId={vehicleId}
          onClose={handleClose}
          onSuccess={handleUploadSuccess}
          defaultDocumentType="receipt"
        />
      )}
      </div>
    </VehicleErrorBoundary>
  );
});

VehicleBuildSystem.displayName = 'VehicleBuildSystem';

export { VehicleBuildSystem };
export default VehicleBuildSystem;
