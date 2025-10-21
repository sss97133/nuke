import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';
import FilterPills from '../components/filters/FilterPills';
import CursorButton from '../components/CursorButton';

interface Vehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value?: number;
  location?: string;
  updated_at?: string;
  created_at?: string;
  is_public?: boolean;
  event_count?: number;
}

const CursorHomepage: React.FC = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalVehicles: 0,
    activeToday: 0,
    partsCount: 0,
  });
  const [activeFilter, setActiveFilter] = useState('recent');
  const [viewMode, setViewMode] = useState<'list' | 'gallery' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'price' | 'date' | 'make' | 'year'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load vehicles - removed primary_image_url as it doesn't exist in schema
      const { data: vehicleData, error } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          current_value,
          location,
          updated_at,
          created_at,
          is_public
        `)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error loading vehicles:', error);
      } else if (vehicleData) {
        // Just use vehicles without images for now - images can be added later
        setVehicles(vehicleData);
        setFilteredVehicles(vehicleData);
      }

      // Load stats - count only public vehicles
      const [vehicleCount, activeCount] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact' }).eq('is_public', true),
        supabase.from('profiles').select('id', { count: 'exact' }),
      ]);

      setStats({
        totalVehicles: vehicleCount.count || 0,
        activeToday: activeCount.count || 0,
        partsCount: 0, // Placeholder
      });
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim()) {
      setFilteredVehicles(vehicles);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = vehicles.filter(v => 
      `${v.year} ${v.make} ${v.model}`.toLowerCase().includes(query)
    );
    setFilteredVehicles(filtered);
  }, [searchQuery, vehicles]);

  // Add keyboard shortcut for search (⌘K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Enter' && document.activeElement === searchInputRef.current) {
        e.preventDefault();
        handleSearch();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSearch]);

  const handleFilterChange = (filter: string) => {
    setActiveFilter(filter);
    
    let filtered = vehicles;
    switch (filter) {
      case 'recent':
        filtered = vehicles;
        break;
      case 'for_sale':
        // is_for_sale column doesn't exist - skip filter for now
        filtered = vehicles;
        break;
      case 'projects':
        filtered = vehicles.filter(v => v.event_count && v.event_count > 0);
        break;
      case 'near_me':
        filtered = vehicles.filter(v => v.location);
        break;
      default:
        filtered = vehicles;
    }
    setFilteredVehicles(filtered);
  };

  const handleSort = (column: 'price' | 'date' | 'make' | 'year') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const sortVehicles = (vehicles: Vehicle[]) => {
    return [...vehicles].sort((a, b) => {
      let aVal: number | string | undefined, bVal: number | string | undefined;
      
      switch (sortBy) {
        case 'price':
          aVal = a.current_value || 0;
          bVal = b.current_value || 0;
          break;
        case 'date':
          aVal = new Date(a.created_at || '').getTime();
          bVal = new Date(b.created_at || '').getTime();
          break;
        case 'make':
          aVal = a.make || '';
          bVal = b.make || '';
          break;
        case 'year':
          aVal = a.year || 0;
          bVal = b.year || 0;
          break;
        default:
          return 0;
      }
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', width: '100%', overflow: 'hidden' }}>
      {/* Hero Section - Compact */}
      <section style={{ padding: '16px 12px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Clean Search */}
        <div style={{ position: 'relative', marginBottom: '12px', width: '100%' }}>
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              }
            }}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <span style={{
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '10px',
            color: 'var(--text-secondary)',
            display: window.innerWidth > 768 ? 'block' : 'none'
          }}>
            ⌘K
          </span>
        </div>
        
        {/* Dense Stats */}
        <div style={{ fontSize: '10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {stats.totalVehicles} vehicles · {stats.activeToday} active today
        </div>
      </section>

      {/* Controls */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 12px', width: '100%', boxSizing: 'border-box' }}>
        {/* Filter Pills */}
        <div style={{ marginBottom: '8px', overflowX: 'auto' }}>
          <FilterPills activeFilter={activeFilter} onFilterChange={handleFilterChange} />
        </div>
        
        {/* View Mode & Sort Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          {/* View Mode Toggle */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['list', 'gallery', 'grid'] as const).map(mode => (
              <CursorButton
                key={mode}
                onClick={() => setViewMode(mode)}
                variant={viewMode === mode ? 'primary' : 'secondary'}
                size="sm"
              >
                {mode}
              </CursorButton>
            ))}
          </div>
          
          {/* Sort Controls */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Sort:</span>
            {(['price', 'date', 'make', 'year'] as const).map(column => (
              <CursorButton
                key={column}
                onClick={() => handleSort(column)}
                variant={sortBy === column ? 'primary' : 'secondary'}
                size="sm"
              >
                {column}
                {sortBy === column && (
                  <span style={{ marginLeft: '2px' }}>
                    {sortOrder === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </CursorButton>
            ))}
          </div>
        </div>
      </div>

      {/* Vehicle Display */}
      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '12px', width: '100%', boxSizing: 'border-box' }}>
        {loading ? (
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Loading...</div>
        ) : (
          <div style={{
            display: viewMode === 'grid' ? 'grid' : 'flex',
            flexDirection: viewMode === 'list' ? 'column' : viewMode === 'gallery' ? 'column' : 'row',
            gridTemplateColumns: viewMode === 'grid' ? 'repeat(auto-fill, minmax(200px, 1fr))' : undefined,
            gap: '8px',
            width: '100%',
            flexWrap: 'nowrap'
          }}>
            {sortVehicles(filteredVehicles).map(vehicle => (
              <VehicleCardDense 
                key={vehicle.id} 
                vehicle={vehicle} 
                viewMode={viewMode}
                showSocial={viewMode === 'gallery'}
                showPriceChange={viewMode === 'grid'}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default CursorHomepage;

