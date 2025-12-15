import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface CatalogPart {
  id: string;
  part_number: string;
  name: string;
  description: string;
  price_current: number;
  category: string;
  subcategory: string;
  fits_models: string[];
  year_start: number;
  year_end: number;
  in_stock: boolean;
  product_image_url: string;
  supplier_url: string;
  page_id: string;
  page: { page_number: number };
}

export default function CatalogBrowserV2() {
  const [parts, setParts] = useState<CatalogPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalParts, setTotalParts] = useState(0);
  const [filters, setFilters] = useState({
    category: '',
    search: '',
    inStock: false,
    hasImage: false,
    minPrice: '',
    maxPrice: ''
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedPart, setSelectedPart] = useState<CatalogPart | null>(null);
  const [partAssemblies, setPartAssemblies] = useState<any[]>([]);
  const [assemblyParts, setAssemblyParts] = useState<any[]>([]);

  const PARTS_PER_PAGE = 50;

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    loadParts();
  }, [filters, currentPage]);

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

  const loadParts = async () => {
    setLoading(true);
    
    let query = supabase
      .from('catalog_parts')
      .select(`
        *,
        page:catalog_pages(page_number)
      `, { count: 'exact' });

    // Apply filters
    if (filters.category) query = query.eq('category', filters.category);
    if (filters.search) {
      query = query.or(`part_number.ilike.%${filters.search}%,name.ilike.%${filters.search}%`);
    }
    if (filters.inStock) query = query.eq('in_stock', true);
    if (filters.hasImage) query = query.not('product_image_url', 'is', null);
    if (filters.minPrice) query = query.gte('price_current', parseFloat(filters.minPrice));
    if (filters.maxPrice) query = query.lte('price_current', parseFloat(filters.maxPrice));

    // Pagination
    const from = (currentPage - 1) * PARTS_PER_PAGE;
    const to = from + PARTS_PER_PAGE - 1;

    const { data, error, count } = await query
      .order('part_number', { ascending: true })
      .range(from, to);
    
    if (!error && data) {
      setParts(data);
      setTotalParts(count || 0);
    }
    
    setLoading(false);
  };

  const totalPages = Math.ceil(totalParts / PARTS_PER_PAGE);

  const loadPartAssemblies = async (partId: string) => {
    const { data } = await supabase
      .rpc('get_part_assemblies', { part_uuid: partId });
    
    if (data && data.length > 0) {
      setPartAssemblies(data);
      
      // Load all parts in the first assembly
      const { data: allParts } = await supabase
        .rpc('get_assembly_parts', { assembly_uuid: data[0].assembly_id });
      
      setAssemblyParts(allParts || []);
    }
  };

  const handlePartClick = (part: CatalogPart) => {
    setSelectedPart(part);
    loadPartAssemblies(part.id);
  };

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      background: 'var(--surface)',
      overflow: 'hidden'
    }}>
      
      {/* Sidebar Filters */}
      <div style={{
        width: '280px',
        borderRight: '2px solid #000',
        padding: '16px',
        overflowY: 'auto',
        flexShrink: 0
      }}>
        <h2 style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '16px', textTransform: 'uppercase' }}>
          FILTERS
        </h2>

        {/* Search */}
        <div style={{ marginBottom: '16px' }}>
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
              padding: '8px',
              fontSize: '8pt',
              border: '2px solid #000',
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Category */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '8pt', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            CATEGORY
          </label>
          <select
            value={filters.category}
            onChange={(e) => setFilters({...filters, category: e.target.value})}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '8pt',
              border: '2px solid #000',
              fontFamily: 'inherit'
            }}
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Price Range */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '8pt', fontWeight: 700, display: 'block', marginBottom: '4px' }}>
            PRICE RANGE
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="number"
              placeholder="Min"
              value={filters.minPrice}
              onChange={(e) => setFilters({...filters, minPrice: e.target.value})}
              style={{
                flex: 1,
                padding: '8px',
                fontSize: '8pt',
                border: '2px solid #000'
              }}
            />
            <input
              type="number"
              placeholder="Max"
              value={filters.maxPrice}
              onChange={(e) => setFilters({...filters, maxPrice: e.target.value})}
              style={{
                flex: 1,
                padding: '8px',
                fontSize: '8pt',
                border: '2px solid #000'
              }}
            />
          </div>
        </div>

        {/* Checkboxes */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '8pt', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filters.inStock}
              onChange={(e) => setFilters({...filters, inStock: e.target.checked})}
            />
            In Stock Only
          </label>
          <label style={{ fontSize: '8pt', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filters.hasImage}
              onChange={(e) => setFilters({...filters, hasImage: e.target.checked})}
            />
            Has Product Image
          </label>
        </div>

        {/* Clear */}
        <button
          onClick={() => {
            setFilters({ category: '', search: '', inStock: false, hasImage: false, minPrice: '', maxPrice: '' });
            setCurrentPage(1);
          }}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '8pt',
            fontWeight: 700,
            border: '2px solid #000',
            background: 'var(--surface)',
            cursor: 'pointer'
          }}
        >
          CLEAR FILTERS
        </button>

        {/* Stats */}
        <div style={{ 
          marginTop: '24px',
          padding: '12px',
          background: '#f8f8f8',
          border: '2px solid #000',
          fontSize: '8pt'
        }}>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>CATALOG STATS</div>
          <div>Total Parts: {totalParts.toLocaleString()}</div>
          <div>Page: {currentPage} of {totalPages}</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Header */}
        <div style={{ 
          borderBottom: '2px solid #000',
          padding: '16px 24px',
          background: 'var(--surface)',
          flexShrink: 0
        }}>
          <h1 style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '4px' }}>
            LMC PARTS CATALOG
          </h1>
          <div style={{ fontSize: '8pt', color: '#666' }}>
            Showing {parts.length} parts (Page {currentPage} of {totalPages})
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', fontSize: '8pt', color: '#999' }}>
              Loading catalog...
            </div>
          ) : parts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', fontSize: '8pt', color: '#999' }}>
              No parts found matching filters
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#f8f8f8', borderBottom: '2px solid #000' }}>
                <tr>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>IMAGE</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>PART #</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>NAME</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>CATEGORY</th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 700 }}>FITS</th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>PRICE</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontWeight: 700 }}>STOCK</th>
                  <th style={{ padding: '12px', textAlign: 'center', fontWeight: 700 }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part, idx) => (
                  <tr 
                    key={part.id}
                    style={{ 
                      borderBottom: '1px solid #eee',
                      background: idx % 2 === 0 ? '#fff' : '#fafafa',
                      cursor: 'pointer'
                    }}
                    onClick={() => handlePartClick(part)}
                    className="hover:bg-gray-100"
                  >
                    <td style={{ padding: '12px' }}>
                      {part.product_image_url ? (
                        <img 
                          src={part.product_image_url}
                          alt={part.name}
                          style={{ width: '50px', height: '50px', objectFit: 'contain', border: '1px solid #ddd' }}
                        />
                      ) : (
                        <div style={{ width: '50px', height: '50px', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '7pt', color: '#999' }}>
                          No img
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: 700 }}>
                      {part.part_number}
                    </td>
                    <td style={{ padding: '12px', maxWidth: '300px' }}>
                      {part.name}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ 
                        padding: '4px 8px',
                        background: 'var(--surface)',
                        borderRadius: '2px',
                        fontSize: '7pt'
                      }}>
                        {part.category || 'Other'}
                      </span>
                    </td>
                    <td style={{ padding: '12px', fontSize: '7pt', color: '#666' }}>
                      {part.year_start && part.year_end 
                        ? `${part.year_start}-${part.year_end}` 
                        : 'N/A'}
                      <br/>
                      {part.fits_models?.slice(0, 2).join(', ')}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>
                      ${part.price_current?.toFixed(2) || 'N/A'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ 
                        fontSize: '7pt',
                        fontWeight: 700,
                        color: part.in_stock ? '#16a34a' : '#dc2626'
                      }}>
                        {part.in_stock ? '● IN' : '○ OUT'}
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {part.supplier_url && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(part.supplier_url, '_blank');
                          }}
                          style={{
                            padding: '4px 8px',
                            fontSize: '7pt',
                            fontWeight: 700,
                            border: '1px solid #000',
                            background: '#000',
                            color: '#fff',
                            cursor: 'pointer'
                          }}
                        >
                          VIEW
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div style={{ 
          borderTop: '2px solid #000',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--surface)',
          flexShrink: 0
        }}>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 700,
              border: '2px solid #000',
              background: currentPage === 1 ? '#ccc' : '#fff',
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
            }}
          >
            ← PREV
          </button>

          <div style={{ fontSize: '8pt' }}>
            Page {currentPage} of {totalPages} • {totalParts.toLocaleString()} total parts
          </div>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 700,
              border: '2px solid #000',
              background: currentPage === totalPages ? '#ccc' : '#fff',
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
            }}
          >
            NEXT →
          </button>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedPart && (
        <div 
          onClick={() => setSelectedPart(null)}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0,0,0,0.8)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              background: 'var(--surface)', 
              border: '2px solid #000', 
              padding: '24px', 
              maxWidth: '800px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '2px solid #000', paddingBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '14pt', fontWeight: 700, marginBottom: '4px' }}>
                  {selectedPart.part_number}
                </div>
                <div style={{ fontSize: '10pt', color: '#666' }}>
                  {selectedPart.name}
                </div>
                {partAssemblies.length > 0 && (
                  <div style={{ fontSize: '8pt', color: '#0066cc', marginTop: '4px' }}>
                    Part #{partAssemblies[0].callout_number} of {partAssemblies[0].assembly_name}
                  </div>
                )}
              </div>
              <button 
                onClick={() => { setSelectedPart(null); setPartAssemblies([]); setAssemblyParts([]); }}
                style={{ fontSize: '8pt', fontWeight: 700, border: '2px solid #000', background: 'var(--surface)', padding: '8px 16px', cursor: 'pointer', height: 'fit-content' }}
              >
                CLOSE
              </button>
            </div>

            {/* Assembly Context */}
            {partAssemblies.length > 0 && (
              <div style={{ marginBottom: '16px', padding: '12px', background: '#f0f8ff', border: '2px solid #0066cc' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', color: '#0066cc' }}>
                  🔧 ASSEMBLY CONTEXT
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
                  This is <strong>part #{partAssemblies[0].callout_number}</strong> in the <strong>{partAssemblies[0].assembly_name}</strong> ({partAssemblies[0].total_parts} total parts)
                </div>
                {partAssemblies[0].assembly_image_url && (
                  <img 
                    src={partAssemblies[0].assembly_image_url}
                    alt="Assembly diagram"
                    style={{ width: '100%', maxHeight: '300px', objectFit: 'contain', border: '1px solid #0066cc', marginBottom: '8px' }}
                  />
                )}
                {assemblyParts.length > 0 && (
                  <details style={{ fontSize: '8pt', marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                      View all {assemblyParts.length} parts in assembly
                    </summary>
                    <div style={{ marginTop: '8px', maxHeight: '150px', overflow: 'auto' }}>
                      {assemblyParts.map((ap: any) => (
                        <div key={ap.callout_number} style={{ 
                          padding: '4px', 
                          borderBottom: '1px solid #e0e0e0',
                          background: ap.part_number === selectedPart.part_number ? '#fffacd' : 'transparent'
                        }}>
                          <strong>#{ap.callout_number}</strong>: {ap.part_number} - {ap.part_name} ({ap.quantity}x) ${ap.price?.toFixed(2)}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: selectedPart.product_image_url ? '300px 1fr' : '1fr', gap: '24px' }}>
              {selectedPart.product_image_url && (
                <div>
                  <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                    PRODUCT IMAGE
                  </div>
                  <img 
                    src={selectedPart.product_image_url}
                    alt={selectedPart.name}
                    style={{ width: '100%', border: '2px solid #000' }}
                  />
                </div>
              )}

              <div style={{ fontSize: '8pt' }}>
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>CATEGORY</div>
                  <div>{selectedPart.category || 'Other'}</div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>FITS</div>
                  <div>
                    {selectedPart.year_start && selectedPart.year_end 
                      ? `${selectedPart.year_start}-${selectedPart.year_end}` 
                      : 'Year range not specified'}
                  </div>
                  <div>{selectedPart.fits_models?.join(', ') || 'Models not specified'}</div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>PRICE</div>
                  <div style={{ fontSize: '16pt', fontWeight: 700 }}>
                    ${selectedPart.price_current?.toFixed(2) || 'N/A'}
                  </div>
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>AVAILABILITY</div>
                  <div style={{ color: selectedPart.in_stock ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                    {selectedPart.in_stock ? '● IN STOCK' : '○ OUT OF STOCK'}
                  </div>
                </div>

                {selectedPart.description && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>DESCRIPTION</div>
                    <div>{selectedPart.description}</div>
                  </div>
                )}

                {selectedPart.page?.page_number && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>CATALOG PAGE</div>
                    <div>Page {selectedPart.page.page_number}</div>
                  </div>
                )}

                {selectedPart.supplier_url && (
                  <button
                    onClick={() => window.open(selectedPart.supplier_url, '_blank')}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '8pt',
                      fontWeight: 700,
                      border: '2px solid #000',
                      background: '#000',
                      color: '#fff',
                      cursor: 'pointer',
                      marginTop: '16px'
                    }}
                  >
                    VIEW ON LMC WEBSITE →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

