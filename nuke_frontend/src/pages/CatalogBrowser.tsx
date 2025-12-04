import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface CatalogPart {
  id: string;
  part_number: string;
  name: string;
  description: string;
  price_current: number;
  category: string;
  subcategory: string;
  manufacturer: string;
  condition: string;
  fits_models: string[];
  year_start: number;
  year_end: number;
  in_stock: boolean;
  product_image_url: string;
  supplier_url: string;
  weight_lbs: number;
  installation_difficulty: string;
  related_parts: string[];
  page: {
    page_number: number;
    image_url: string;
  };
  catalog: {
    name: string;
    provider: string;
  };
}

export default function CatalogBrowser() {
  const navigate = useNavigate();
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category: '',
    search: '',
    inStock: true,
    minYear: 1973,
    maxYear: 1987
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    with_images: 0,
    in_stock: 0
  });

  useEffect(() => {
    loadCategories();
    loadStats();
  }, []);

  useEffect(() => {
    loadParts();
  }, [filters]);

  const loadCategories = async () => {
    const { data } = await supabase
      .from('catalog_parts')
      .select('category')
      .not('category', 'is', null);
    
    if (data) {
      const unique = [...new Set(data.map(d => d.category))].filter(Boolean).sort();
      setCategories(unique);
    }
  };

  const loadStats = async () => {
    const { count: total } = await supabase
      .from('catalog_parts')
      .select('*', { count: 'exact', head: true });
    
    const { count: with_images } = await supabase
      .from('catalog_parts')
      .select('*', { count: 'exact', head: true })
      .not('product_image_url', 'is', null);
    
    const { count: in_stock } = await supabase
      .from('catalog_parts')
      .select('*', { count: 'exact', head: true })
      .eq('in_stock', true);
    
    setStats({
      total: total || 0,
      with_images: with_images || 0,
      in_stock: in_stock || 0
    });
  };

  const loadParts = async () => {
    setLoading(true);
    
    let query = supabase
      .from('catalog_parts')
      .select(`
        *,
        page:catalog_pages(page_number, image_url),
        catalog:catalog_sources(name, provider)
      `)
      .order('part_number', { ascending: true })
      .limit(100);

    if (filters.category) {
      query = query.eq('category', filters.category);
    }

    if (filters.search) {
      query = query.or(`part_number.ilike.%${filters.search}%,name.ilike.%${filters.search}%`);
    }

    if (filters.inStock) {
      query = query.eq('in_stock', true);
    }

    const { data, error } = await query;
    
    if (error) {
      console.error('Error loading parts:', error);
    } else {
      setParts(data || []);
    }
    
    setLoading(false);
  };

  return (
    <div style={{ padding: '16px', maxWidth: '1600px', margin: '0 auto', background: '#fff', minHeight: '100vh' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '2px solid #000', paddingBottom: '12px' }}>
        <h1 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase' }}>
          LMC PARTS CATALOG
        </h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '8pt', color: '#666' }}>
          <span>Total Parts: {stats.total.toLocaleString()}</span>
          <span>With Images: {stats.with_images.toLocaleString()}</span>
          <span>In Stock: {stats.in_stock.toLocaleString()}</span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '12px',
        marginBottom: '16px',
        padding: '12px',
        background: '#f8f8f8',
        border: '2px solid #000'
      }}>
        
        {/* Search */}
        <div>
          <label style={{ fontSize: '8pt', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            SEARCH
          </label>
          <input
            type="text"
            placeholder="Part # or name..."
            value={filters.search}
            onChange={(e) => setFilters({...filters, search: e.target.value})}
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '8pt',
              border: '1px solid #000',
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Category */}
        <div>
          <label style={{ fontSize: '8pt', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            CATEGORY
          </label>
          <select
            value={filters.category}
            onChange={(e) => setFilters({...filters, category: e.target.value})}
            style={{
              width: '100%',
              padding: '6px',
              fontSize: '8pt',
              border: '1px solid #000',
              fontFamily: 'inherit'
            }}
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Stock Filter */}
        <div>
          <label style={{ fontSize: '8pt', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            AVAILABILITY
          </label>
          <label style={{ fontSize: '8pt', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filters.inStock}
              onChange={(e) => setFilters({...filters, inStock: e.target.checked})}
            />
            In Stock Only
          </label>
        </div>

        {/* Clear */}
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            onClick={() => setFilters({ category: '', search: '', inStock: true, minYear: 1973, maxYear: 1987 })}
            style={{
              padding: '6px 12px',
              fontSize: '8pt',
              fontWeight: 700,
              border: '2px solid #000',
              background: '#fff',
              cursor: 'pointer'
            }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Parts Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', fontSize: '8pt', color: '#999' }}>
          Loading catalog...
        </div>
      ) : parts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', fontSize: '8pt', color: '#999' }}>
          No parts found matching filters
        </div>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '16px'
        }}>
          {parts.map(part => (
            <div 
              key={part.id}
              style={{
                border: '2px solid #000',
                background: '#fff',
                overflow: 'hidden',
                transition: 'transform 0.12s',
                cursor: 'pointer'
              }}
              className="hover:shadow-lg"
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              
              {/* Product Image */}
              <div style={{ 
                height: '200px', 
                background: '#f8f8f8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderBottom: '2px solid #000'
              }}>
                {part.product_image_url ? (
                  <img 
                    src={part.product_image_url}
                    alt={part.name}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <div style={{ fontSize: '8pt', color: '#999' }}>No image</div>
                )}
              </div>

              {/* Part Info */}
              <div style={{ padding: '12px' }}>
                
                {/* Part Number */}
                <div style={{ 
                  fontSize: '10pt', 
                  fontWeight: 700, 
                  fontFamily: 'monospace',
                  marginBottom: '4px'
                }}>
                  {part.part_number}
                </div>

                {/* Name */}
                <div style={{ 
                  fontSize: '8pt',
                  marginBottom: '8px',
                  minHeight: '32px'
                }}>
                  {part.name}
                </div>

                {/* Category */}
                {part.category && (
                  <div style={{ 
                    fontSize: '7pt',
                    color: '#666',
                    marginBottom: '4px'
                  }}>
                    {part.category}
                    {part.subcategory && ` › ${part.subcategory}`}
                  </div>
                )}

                {/* Fits */}
                {(part.year_start || part.fits_models?.length > 0) && (
                  <div style={{ 
                    fontSize: '7pt',
                    color: '#666',
                    marginBottom: '8px'
                  }}>
                    Fits: {part.year_start && part.year_end 
                      ? `${part.year_start}-${part.year_end}` 
                      : ''} {part.fits_models?.join(', ')}
                  </div>
                )}

                {/* Price */}
                <div style={{ 
                  fontSize: '12pt',
                  fontWeight: 700,
                  marginBottom: '8px'
                }}>
                  ${part.price_current?.toFixed(2) || 'N/A'}
                </div>

                {/* Stock Status */}
                <div style={{ 
                  fontSize: '7pt',
                  fontWeight: 700,
                  color: part.in_stock ? '#16a34a' : '#dc2626',
                  marginBottom: '8px'
                }}>
                  {part.in_stock ? '● IN STOCK' : '○ OUT OF STOCK'}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {part.supplier_url && (
                    <button
                      onClick={() => window.open(part.supplier_url, '_blank')}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        fontSize: '7pt',
                        fontWeight: 700,
                        border: '2px solid #000',
                        background: '#000',
                        color: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      VIEW ON LMC
                    </button>
                  )}
                  {part.page?.page_number && (
                    <button
                      style={{
                        padding: '6px 8px',
                        fontSize: '7pt',
                        fontWeight: 700,
                        border: '2px solid #000',
                        background: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      PAGE {part.page.page_number}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ 
        marginTop: '24px',
        padding: '12px',
        borderTop: '2px solid #000',
        fontSize: '8pt',
        color: '#666',
        textAlign: 'center'
      }}>
        Showing {parts.length} parts • Total catalog: {stats.total.toLocaleString()} parts
      </div>
    </div>
  );
}

