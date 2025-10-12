import React, { useState, useEffect } from 'react';
import type { Upload, FileText, DollarSign, Clock, Package, TrendingUp, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { BuildImportService } from '../../services/buildImportService';
import '../../design-system.css';

interface VehicleBuildManagerProps {
  vehicleId: string;
  isOwner: boolean;
  isPublicView?: boolean; // Whether this is being viewed by non-owner
}

interface BuildSummary {
  totalSpent: number;
  totalBudget: number;
  completedItems: number;
  pendingItems: number;
  totalHours: number;
  phaseCount: number;
}

interface BuildLineItem {
  id: string;
  name: string;
  category: string;
  supplier: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  status: string;
  days_to_install: number;
  date_installed?: string;
  condition: string;
  is_public?: boolean;
  hide_cost?: boolean;
}

export const VehicleBuildManager: React.FC<VehicleBuildManagerProps> = ({ vehicleId, isOwner, isPublicView = false }) => {
  const [builds, setBuilds] = useState<any[]>([]);
  const [selectedBuild, setSelectedBuild] = useState<any>(null);
  const [lineItems, setLineItems] = useState<BuildLineItem[]>([]);
  const [summary, setSummary] = useState<BuildSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'parts' | 'invoices' | 'timeline'>('overview');
  const [importData, setImportData] = useState('');
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    loadBuilds();
  }, [vehicleId]);

  useEffect(() => {
    if (selectedBuild) {
      loadBuildDetails(selectedBuild.id);
    }
  }, [selectedBuild]);

  const loadBuilds = async () => {
    try {
      console.log('Loading builds for vehicle:', vehicleId);
      
      let query = supabase
        .from('vehicle_builds')
        .select('*')
        .eq('vehicle_id', vehicleId);

      // If not owner, only show public builds
      if (!isOwner) {
        query = query.eq('visibility_level', 'public');
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      console.log('Builds query result:', { data, error });
      
      if (error) {
        console.error('Query error:', error);
        throw error;
      }
      
      setBuilds(data || []);
      if (data && data.length > 0) {
        console.log('Setting selected build:', data[0]);
        setSelectedBuild(data[0]);
      }
    } catch (error) {
      console.error('Error loading builds:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBuildDetails = async (buildId: string) => {
    try {
      // Load line items with categories and suppliers
      let itemsQuery = supabase
        .from('build_line_items')
        .select(`
          *,
          part_categories (name),
          suppliers (name)
        `)
        .eq('build_id', buildId);

      // If not owner, only show public items
      if (!isOwner) {
        itemsQuery = itemsQuery.eq('is_public', true);
      }

      const { data: items, error: itemsError } = await itemsQuery
        .order('created_at', { ascending: false });

      if (itemsError) throw itemsError;

      const formattedItems = items?.map(item => ({
        id: item.id,
        name: item.name,
        category: item.part_categories?.name || 'Uncategorized',
        supplier: item.suppliers?.name || 'Unknown',
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        status: item.status,
        days_to_install: item.days_to_install,
        date_installed: item.date_installed,
        condition: item.condition,
        is_public: item.is_public,
        hide_cost: item.hide_cost
      })) || [];

      setLineItems(formattedItems);

      // Calculate summary
      const summary: BuildSummary = {
        totalSpent: formattedItems.reduce((sum, item) =>
          sum + (item.status === 'completed' && (isOwner || !item.hide_cost) ? item.total_price : 0), 0),
        totalBudget: selectedBuild.total_budget || 0,
        completedItems: formattedItems.filter(i => i.status === 'completed').length,
        pendingItems: formattedItems.filter(i => ['ordered', 'backordered'].includes(i.status)).length,
        totalHours: formattedItems.reduce((sum, item) =>
          sum + (item.days_to_install * 8), 0), // Assuming 8 hour work days
        phaseCount: 0 // Will load separately if needed
      };

      setSummary(summary);
    } catch (error) {
      console.error('Error loading build details:', error);
    }
  };

  const handleImport = async () => {
    if (!importData.trim()) return;

    setImporting(true);
    try {
      const items = await BuildImportService.parseCSV(importData);
      const build = await BuildImportService.importBuildData(
        vehicleId,
        `Restoration Build ${new Date().toLocaleDateString()}`,
        items
      );

      // Reload builds
      await loadBuilds();
      setShowImport(false);
      setImportData('');
    } catch (error) {
      console.error('Import error:', error);
      alert('Error importing data. Please check the format.');
    } finally {
      setImporting(false);
    }
  };

  const getStatusColor = (status: string) => {
    // In design system, we only use black text with different styling
    return 'text'; // All text is black in design system
  };

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'in_progress': return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'ordered': return <Package className="w-4 h-4" />;
      case 'backordered': return <AlertCircle className="w-4 h-4" />;
      default: return null;
    }
  };

  const shouldShowCosts = isOwner || selectedBuild?.show_costs;

  if (loading) {
    return (
      <div className="layout">
        <section className="section">
          <div className="container">
            <div className="card text-center">
              <div className="card-body">
                <Loader2 className="w-8 h-8 animate-spin mx-auto" />
                <p className="text">Loading...</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="layout">
      {/* Header */}
      <header className="header">
        <div className="container">
          <div className="flex justify-between items-center">
            <h2 className="text font-bold">Build Management</h2>
            {isOwner && (
              <button
                onClick={() => setShowImport(true)}
                className="button button-primary"
              >
                <Upload className="w-4 h-4" />
                <span className="text">Import CSV</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Build Selector */}
      {builds.length > 1 && (
        <section className="section">
          <div className="container">
            <div className="flex gap-2">
              {builds.map(build => (
                <button
                  key={build.id}
                  onClick={() => setSelectedBuild(build)}
                  className={selectedBuild?.id === build.id
                    ? 'button button-primary'
                    : 'button button-secondary'
                  }
                >
                  <span className="text">{build.name}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {selectedBuild ? (
        <>
          {/* Summary Cards */}
          <section className="section">
            <div className="container">
              <div className="grid grid-cols-2 gap-4">
                {shouldShowCosts && (
                  <div className="card">
                    <div className="card-body">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text text-muted">Total Spent</p>
                          <p className="text font-bold">
                            ${summary?.totalSpent.toLocaleString() || 0}
                          </p>
                        </div>
                        <DollarSign className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                )}

                {shouldShowCosts && (
                  <div className="card">
                    <div className="card-body">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text text-muted">Budget</p>
                          <p className="text font-bold">
                            ${summary?.totalBudget.toLocaleString() || 0}
                          </p>
                        </div>
                        <TrendingUp className="w-4 h-4" />
                      </div>
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="card-body">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text text-muted">Completed</p>
                        <p className="text font-bold">{summary?.completedItems || 0}</p>
                      </div>
                      <CheckCircle className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-body">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text text-muted">Labor Hours</p>
                        <p className="text font-bold">{summary?.totalHours || 0}</p>
                      </div>
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Tabs */}
          <section className="section">
            <div className="container">
              <div className="nav">
                <div className="nav-menu">
                  {['overview', 'parts', 'invoices', 'timeline'].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab as any)}
                      className={activeTab === tab
                        ? 'button button-primary'
                        : 'button button-secondary'
                      }
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
                      <div className="p-4">
                        <h3 className="text font-bold">Build Progress</h3>
                        <div style={{
                          width: '100%',
                          height: '8px',
                          backgroundColor: 'var(--grey-300)',
                          border: '1px solid var(--border-medium)',
                          marginTop: '8px'
                        }}>
                          <div
                            style={{
                              height: '6px',
                              backgroundColor: 'var(--text)',
                              width: `${(summary?.completedItems || 0) /
                                       ((summary?.completedItems || 0) + (summary?.pendingItems || 0) +
                                        lineItems.filter(i => i.status === 'planning').length) * 100}%`
                            }}
                          />
                        </div>
                      </div>

                      {/* Category Breakdown */}
                      {shouldShowCosts && (
                        <div className="p-4">
                          <h3 className="text font-bold">Spending by Category</h3>
                          <div>
                            {Object.entries(
                              lineItems.reduce((acc, item) => {
                                if (!item.hide_cost || isOwner) {
                                  acc[item.category] = (acc[item.category] || 0) + item.total_price;
                                }
                                return acc;
                              }, {} as Record<string, number>)
                            )
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 5)
                              .map(([category, amount]) => (
                                <div key={category} className="flex justify-between p-1">
                                  <span className="text">{category}</span>
                                  <span className="text font-bold">${amount.toLocaleString()}</span>
                                </div>
                              ))
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'parts' && (
                    <div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th className="text-left">Part</th>
                            <th className="text-left">Category</th>
                            <th className="text-left">Supplier</th>
                            <th className="text-center">Qty</th>
                            {shouldShowCosts && (
                              <th className="text-right">Price</th>
                            )}
                            <th className="text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lineItems
                            .filter(item => isOwner || item.is_public !== false)
                            .map(item => (
                            <tr key={item.id}>
                              <td className="text">{item.name}</td>
                              <td className="text text-muted">{item.category}</td>
                              <td className="text text-muted">{item.supplier}</td>
                              <td className="text text-center">{item.quantity}</td>
                              {(isOwner || (shouldShowCosts && !item.hide_cost)) && (
                                <td className="text text-right">${item.total_price.toLocaleString()}</td>
                              )}
                              <td className="text-center">
                                <div className={`flex items-center justify-center gap-1 ${getStatusColor(item.status)}`}>
                                  {getStatusIcon(item.status)}
                                  <span className="text">{item.status}</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {activeTab === 'invoices' && (
                    <div className="p-4">
                      <p className="text text-muted">Invoice functionality coming soon...</p>
                    </div>
                  )}

                  {activeTab === 'timeline' && (
                    <div className="p-4">
                      <p className="text text-muted">Timeline functionality coming soon...</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="section">
          <div className="container">
            <div className="card text-center">
              <div className="card-body">
                <FileText className="w-8 h-8 mx-auto" />
                <h3 className="text font-bold">No Build Data</h3>
                <p className="text text-muted">Import your build spreadsheet to get started</p>
                {isOwner && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="button button-primary"
                  >
                    <span className="text">Import CSV</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

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
          zIndex: 50,
          padding: '16px'
        }}>
          <div className="card" style={{ maxWidth: '600px', width: '100%' }}>
            <div className="card-header">
              <h3 className="text font-bold">Import Build Data</h3>
            </div>
            <div className="card-body">
              <p className="text text-muted">
                Paste your CSV data below. Format should include columns:
                Time, Part, Supplier, Investment, Done, Invoice 3, Invoice 4
              </p>
              <textarea
                value={importData}
                onChange={(e) => setImportData(e.target.value)}
                className="form-input"
                style={{
                  height: '200px',
                  fontFamily: 'monospace',
                  width: '100%',
                  marginTop: '8px'
                }}
                placeholder="Paste CSV data here..."
              />
            </div>
            <div className="card-footer">
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setShowImport(false);
                    setImportData('');
                  }}
                  className="button button-secondary"
                >
                  <span className="text">Cancel</span>
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || !importData.trim()}
                  className="button button-primary"
                  style={{ opacity: (importing || !importData.trim()) ? 0.5 : 1 }}
                >
                  <span className="text">{importing ? 'Importing...' : 'Import'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};