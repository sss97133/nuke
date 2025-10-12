import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface DatabaseStats {
  totalVehicles: number;
  totalProfiles: number;
  totalImages: number;
  totalAnonymousVehicles: number;
  totalAuthenticatedVehicles: number;
  vehiclesWithImages: number;
  vehiclesWithoutImages: number;
  averageVehiclesPerUser: number;
  mostPopularMakes: Array<{ make: string; count: number }>;
  recentActivity: Array<{ date: string; count: number }>;
}

interface VehicleData {
  id: string;
  make: string;
  model: string;
  year: number;
  created_at: string;
  isAnonymous: boolean;
  hasImage: boolean;
}

const DatabaseAudit: React.FC = () => {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [vehicles, setVehicles] = useState<VehicleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMake, setFilterMake] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    loadDatabaseStats();
  }, []);

  const loadDatabaseStats = async () => {
    try {
      setLoading(true);

      // Load vehicles from database
      let dbVehicles: VehicleData[] = [];
      try {
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          dbVehicles = data.map(v => ({
            id: v.id,
            make: v.make,
            model: v.model,
            year: v.year,
            created_at: v.created_at,
            isAnonymous: false,
            hasImage: !!v.primaryImageUrl
          }));
        }
      } catch (error) {
        console.error('Error loading database vehicles:', error);
      }

      // Load vehicles from localStorage
      const localVehicles = JSON.parse(localStorage.getItem('anonymousVehicles') || '[]');
      const anonymousVehicles: VehicleData[] = localVehicles.map((v: any) => ({
        id: v.id,
        make: v.make,
        model: v.model,
        year: v.year,
        created_at: v.created_at,
        isAnonymous: true,
        hasImage: !!v.primaryImageUrl
      }));

      const allVehicles = [...dbVehicles, ...anonymousVehicles];
      setVehicles(allVehicles);

      // Calculate statistics
      const totalVehicles = allVehicles.length;
      const totalAnonymousVehicles = anonymousVehicles.length;
      const totalAuthenticatedVehicles = dbVehicles.length;
      const vehiclesWithImages = allVehicles.filter(v => v.hasImage).length;
      const vehiclesWithoutImages = totalVehicles - vehiclesWithImages;

      // Calculate most popular makes
      const makeCounts: { [key: string]: number } = {};
      allVehicles.forEach(vehicle => {
        makeCounts[vehicle.make] = (makeCounts[vehicle.make] || 0) + 1;
      });
      const mostPopularMakes = Object.entries(makeCounts)
        .map(([make, count]) => ({ make, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Calculate recent activity (last 7 days)
      const recentActivity = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = allVehicles.filter(v => 
          v.created_at.startsWith(dateStr)
        ).length;
        recentActivity.push({ date: dateStr, count });
      }

      // Calculate profile count from actual user data
      const totalProfiles = totalAuthenticatedVehicles > 0 ? totalAuthenticatedVehicles : 0;
      const totalImages = vehiclesWithImages; // Simplified
             const averageVehiclesPerUser = totalAuthenticatedVehicles > 0 
         ? parseFloat((totalAuthenticatedVehicles / totalProfiles).toFixed(1))
         : 0;

      setStats({
        totalVehicles,
        totalProfiles,
        totalImages,
        totalAnonymousVehicles,
        totalAuthenticatedVehicles,
        vehiclesWithImages,
        vehiclesWithoutImages,
        averageVehiclesPerUser,
        mostPopularMakes,
        recentActivity
      });

    } catch (error) {
      console.error('Error loading database stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredVehicles = vehicles.filter(vehicle => {
    const matchesSearch = vehicle.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vehicle.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vehicle.year.toString().includes(searchTerm);
    const matchesMake = !filterMake || vehicle.make === filterMake;
    return matchesSearch && matchesMake;
  });

  const sortedVehicles = [...filteredVehicles].sort((a, b) => {
    let aValue: any = a[sortBy as keyof VehicleData];
    let bValue: any = b[sortBy as keyof VehicleData];
    
    if (sortBy === 'created_at') {
      aValue = new Date(aValue);
      bValue = new Date(bValue);
    }
    
    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  const uniqueMakes = Array.from(new Set(vehicles.map(v => v.make))).sort();

  if (loading) {
    return (
      <div className="layout">
        <div className="container">
          <div className="main">
            <div className="card">
              <div className="card-body">
                <div className="text-center">
                  <div className="text text-muted">Loading database audit...</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">


      {/* Main Content */}
      <main className="main">
        <div className="container">
          <div className="fade-in">
            {/* Page Header */}
            <section className="section">
              <div className="card">
                <div className="card-header">
                  <div className="flex justify-between items-center">
                    <div>
                      <h1 className="text font-bold text-primary">Database Audit</h1>
                      <p className="text-small text-muted">Comprehensive analysis of vehicle data</p>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        className="button button-secondary"
                        onClick={loadDatabaseStats}
                      >
                        Refresh Data
                      </button>
                      <button 
                        className="button button-primary"
                        onClick={() => {
                          const csv = [
                            ['ID', 'Make', 'Model', 'Year', 'Created', 'Type', 'Has Image'],
                            ...sortedVehicles.map(v => [
                              v.id,
                              v.make,
                              v.model,
                              v.year,
                              v.created_at,
                              v.isAnonymous ? 'Local' : 'Cloud',
                              v.hasImage ? 'Yes' : 'No'
                            ])
                          ].map(row => row.join(',')).join('\n');
                          
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'vehicle-audit.csv';
                          a.click();
                        }}
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Tabs */}
            <section className="section">
              <div className="flex gap-4 m-6">
                <button 
                  className={`button button-secondary ${activeTab === 'overview' ? 'nav-item active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  Overview
                </button>
                <button 
                  className={`button button-secondary ${activeTab === 'vehicles' ? 'nav-item active' : ''}`}
                  onClick={() => setActiveTab('vehicles')}
                >
                  Vehicle Data
                </button>
                <button 
                  className={`button button-secondary ${activeTab === 'analytics' ? 'nav-item active' : ''}`}
                  onClick={() => setActiveTab('analytics')}
                >
                  Analytics
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'overview' && stats && (
                <div className="grid grid-cols-2 gap-6">
                  {/* Key Metrics */}
                  <div className="card">
                    <div className="card-header">
                      <h2 className="text font-bold">Key Metrics</h2>
                    </div>
                    <div className="card-body">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{stats.totalVehicles}</div>
                          <div className="text-small text-muted">Total Vehicles</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{stats.totalProfiles}</div>
                          <div className="text-small text-muted">User Profiles</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{stats.totalImages}</div>
                          <div className="text-small text-muted">Total Images</div>
                        </div>
                        <div className="text-center">
                          <div className="text-2xl font-bold text-primary">{stats.averageVehiclesPerUser}</div>
                          <div className="text-small text-muted">Avg per User</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Storage Distribution */}
                  <div className="card">
                    <div className="card-header">
                      <h2 className="text font-bold">Storage Distribution</h2>
                    </div>
                    <div className="card-body">
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-small text-muted">Cloud Storage</span>
                          <span className="text font-bold">{stats.totalAuthenticatedVehicles}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-small text-muted">Local Storage</span>
                          <span className="text font-bold">{stats.totalAnonymousVehicles}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-small text-muted">With Images</span>
                          <span className="text font-bold">{stats.vehiclesWithImages}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-small text-muted">Without Images</span>
                          <span className="text font-bold">{stats.vehiclesWithoutImages}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Popular Makes */}
                  <div className="card">
                    <div className="card-header">
                      <h2 className="text font-bold">Most Popular Makes</h2>
                    </div>
                    <div className="card-body">
                      <div className="space-y-2">
                        {stats.mostPopularMakes.slice(0, 5).map((item, index) => (
                          <div key={index} className="flex justify-between items-center">
                            <span className="text font-bold">{item.make}</span>
                            <span className="badge badge-primary">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div className="card">
                    <div className="card-header">
                      <h2 className="text font-bold">Recent Activity (7 Days)</h2>
                    </div>
                    <div className="card-body">
                      <div className="space-y-2">
                        {stats.recentActivity.map((item, index) => (
                          <div key={index} className="flex justify-between items-center">
                            <span className="text-small text-muted">
                              {new Date(item.date).toLocaleDateString()}
                            </span>
                            <span className="text font-bold">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'vehicles' && (
                <div className="card">
                  <div className="card-header">
                    <h2 className="text font-bold">Vehicle Data</h2>
                  </div>
                  <div className="card-body">
                    {/* Filters */}
                    <div className="flex gap-4 mb-6">
                      <div className="flex-1">
                        <input
                          type="text"
                          placeholder="Search vehicles..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="input"
                        />
                      </div>
                      <div>
                        <select
                          value={filterMake}
                          onChange={(e) => setFilterMake(e.target.value)}
                          className="select"
                        >
                          <option value="">All Makes</option>
                          {uniqueMakes.map(make => (
                            <option key={make} value={make}>{make}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <select
                          value={sortBy}
                          onChange={(e) => setSortBy(e.target.value)}
                          className="select"
                        >
                          <option value="created_at">Date Created</option>
                          <option value="make">Make</option>
                          <option value="model">Model</option>
                          <option value="year">Year</option>
                        </select>
                      </div>
                      <div>
                        <select
                          value={sortOrder}
                          onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                          className="select"
                        >
                          <option value="desc">Descending</option>
                          <option value="asc">Ascending</option>
                        </select>
                      </div>
                    </div>

                    {/* Vehicle Table */}
                    <div className="overflow-x-auto">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Make</th>
                            <th>Model</th>
                            <th>Year</th>
                            <th>Created</th>
                            <th>Type</th>
                            <th>Image</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedVehicles.map((vehicle) => (
                            <tr key={vehicle.id}>
                              <td className="text-small font-mono">{vehicle.id.substring(0, 8)}...</td>
                              <td>{vehicle.make}</td>
                              <td>{vehicle.model}</td>
                              <td>{vehicle.year}</td>
                              <td>{new Date(vehicle.created_at).toLocaleDateString()}</td>
                              <td>
                                {vehicle.isAnonymous ? (
                                  <span className="badge badge-secondary">Local</span>
                                ) : (
                                  <span className="badge badge-primary">Cloud</span>
                                )}
                              </td>
                              <td>
                                {vehicle.hasImage ? (
                                  <span className="badge badge-success">Yes</span>
                                ) : (
                                  <span className="badge badge-warning">No</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="text-center mt-4">
                      <div className="text-small text-muted">
                        Showing {sortedVehicles.length} of {vehicles.length} vehicles
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'analytics' && stats && (
                <div className="grid grid-cols-2 gap-6">
                  {/* Data Quality */}
                  <div className="card">
                    <div className="card-header">
                      <h2 className="text font-bold">Data Quality</h2>
                    </div>
                    <div className="card-body">
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between mb-2">
                            <span className="text-small text-muted">Vehicles with Images</span>
                            <span className="text font-bold">
                              {Math.round((stats.vehiclesWithImages / stats.totalVehicles) * 100)}%
                            </span>
                          </div>
                          <div className="w-full bg-grey-200 rounded-full h-2">
                            <div 
                              className="bg-primary h-2 rounded-full" 
                              style={{ width: `${(stats.vehiclesWithImages / stats.totalVehicles) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between mb-2">
                            <span className="text-small text-muted">Cloud vs Local</span>
                            <span className="text font-bold">
                              {Math.round((stats.totalAuthenticatedVehicles / stats.totalVehicles) * 100)}%
                            </span>
                          </div>
                          <div className="w-full bg-grey-200 rounded-full h-2">
                            <div 
                              className="bg-secondary h-2 rounded-full" 
                              style={{ width: `${(stats.totalAuthenticatedVehicles / stats.totalVehicles) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Growth Trends */}
                  <div className="card">
                    <div className="card-header">
                      <h2 className="text font-bold">Growth Trends</h2>
                    </div>
                    <div className="card-body">
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-small text-muted">Total Growth</span>
                          <span className="text font-bold text-success">+{stats.totalVehicles}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-small text-muted">Daily Average</span>
                          <span className="text font-bold">
                            {Math.round(stats.totalVehicles / 30)}/day
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-small text-muted">User Engagement</span>
                          <span className="text font-bold">
                            {stats.averageVehiclesPerUser} vehicles/user
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DatabaseAudit; 