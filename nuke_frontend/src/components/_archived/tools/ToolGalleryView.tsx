/**
 * Tool Gallery View Component
 * Shows official product images alongside user's actual tool photos
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import type { ToolProductEnrichmentService } from '../../services/toolProductEnrichmentService';

interface ToolWithImages {
  id: string;
  name: string;
  partNumber: string;
  brand: string;
  
  // From catalog (official product images)
  catalogImages: string[];
  productUrl?: string;
  msrp?: number;
  
  // User's photos
  userImages: string[];
  condition?: string;
  purchaseDate?: string;
  purchasePrice?: number;
}

interface ToolGalleryViewProps {
  userId: string;
}

const ToolGalleryView: React.FC<ToolGalleryViewProps> = ({ userId }) => {
  const [tools, setTools] = useState<ToolWithImages[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('grid');
  
  useEffect(() => {
    loadToolsWithImages();
  }, [userId]);
  
  const loadToolsWithImages = async () => {
    try {
      // Load user's tools with all related data
      const { data: userTools } = await supabase
        .from('user_tools')
        .select(`
          *,
          tool_catalog!catalog_id (
            id,
            part_number,
            name,
            msrp,
            product_url,
            tool_brands!brand_id (
              name
            )
          ),
          user_tool_images (
            image_url,
            image_type
          )
        `)
        .eq('user_id', userId);
      
      if (!userTools) return;
      
      // Process and combine images
      const toolsWithImages: ToolWithImages[] = [];
      
      for (const tool of userTools) {
        // Get catalog images if available
        let catalogImages: string[] = [];
        if (tool.catalog_id && tool.tool_catalog) {
          catalogImages = await ToolProductEnrichmentService.getProductImages(tool.tool_catalog.id);
        }
        
        // Get user images
        const userImages = tool.user_tool_images?.map((img: any) => img.image_url) || [];
        
        toolsWithImages.push({
          id: tool.id,
          name: tool.name || tool.tool_catalog?.name || 'Unknown Tool',
          partNumber: tool.part_number || tool.tool_catalog?.part_number || '',
          brand: tool.brand_name || tool.tool_catalog?.tool_brands?.name || '',
          catalogImages,
          productUrl: tool.tool_catalog?.product_url,
          msrp: tool.tool_catalog?.msrp,
          userImages,
          condition: tool.condition,
          purchaseDate: tool.purchase_date,
          purchasePrice: tool.purchase_price
        });
      }
      
      setTools(toolsWithImages);
    } catch (error) {
      console.error('Failed to load tools:', error);
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) {
    return <div>Loading tool gallery...</div>;
  }
  
  return (
    <div className="tool-gallery">
      {/* View Mode Toggle */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <button
          className={`button ${viewMode === 'grid' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setViewMode('grid')}
        >
          Grid View
        </button>
        <button
          className={`button ${viewMode === 'timeline' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setViewMode('timeline')}
        >
          Timeline View
        </button>
      </div>
      
      {/* Grid View */}
      {viewMode === 'grid' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '20px'
        }}>
          {tools.map(tool => (
            <div key={tool.id} style={{
              border: '1px solid #e5e5e5',
              borderRadius: '8px',
              overflow: 'hidden'
            }}>
              {/* Image Carousel */}
              <div style={{
                position: 'relative',
                height: '250px',
                backgroundColor: 'var(--bg)'
              }}>
                {/* Show product image if available, otherwise user image */}
                {tool.catalogImages.length > 0 ? (
                  <div>
                    <img
                      src={tool.catalogImages[0]}
                      alt={tool.name}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '250px',
                        objectFit: 'contain'
                      }}
                    />
                    <div style={{
                      position: 'absolute',
                      top: '10px',
                      left: '10px',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      Official Product Image
                    </div>
                  </div>
                ) : tool.userImages.length > 0 ? (
                  <div>
                    <img
                      src={tool.userImages[0]}
                      alt={tool.name}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '250px',
                        objectFit: 'cover'
                      }}
                    />
                    <div style={{
                      position: 'absolute',
                      top: '10px',
                      left: '10px',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      Your Photo
                    </div>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    fontSize: '48px'
                  }}>
                    🔧
                  </div>
                )}
                
                {/* Image count indicators */}
                {(tool.catalogImages.length > 0 || tool.userImages.length > 0) && (
                  <div style={{
                    position: 'absolute',
                    bottom: '10px',
                    right: '10px',
                    display: 'flex',
                    gap: '5px'
                  }}>
                    {tool.catalogImages.length > 0 && (
                      <span style={{
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}>
                        {tool.catalogImages.length} Product
                      </span>
                    )}
                    {tool.userImages.length > 0 && (
                      <span style={{
                        backgroundColor: '#10b981',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}>
                        {tool.userImages.length} User
                      </span>
                    )}
                  </div>
                )}
              </div>
              
              {/* Tool Info */}
              <div style={{ padding: '15px' }}>
                <h4 style={{ margin: '0 0 5px 0' }}>{tool.name}</h4>
                <p style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#666' }}>
                  {tool.brand} • {tool.partNumber}
                </p>
                
                {/* Price comparison */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  fontSize: '14px'
                }}>
                  {tool.msrp && (
                    <div>
                      <span style={{ color: '#666' }}>MSRP: </span>
                      <span style={{ fontWeight: 'bold' }}>${tool.msrp}</span>
                    </div>
                  )}
                  {tool.purchasePrice && (
                    <div>
                      <span style={{ color: '#666' }}>Paid: </span>
                      <span style={{ fontWeight: 'bold', color: '#10b981' }}>
                        ${tool.purchasePrice}
                      </span>
                    </div>
                  )}
                </div>
                
                {/* Actions */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  {tool.productUrl && (
                    <a
                      href={tool.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '12px',
                        color: '#3b82f6',
                        textDecoration: 'none'
                      }}
                    >
                      View Product →
                    </a>
                  )}
                  <button
                    style={{
                      fontSize: '12px',
                      color: '#666',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0
                    }}
                    onClick={() => {
                      // Open detailed view
                      console.log('View details for', tool.id);
                    }}
                  >
                    Details →
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {/* Timeline View */}
      {viewMode === 'timeline' && (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {tools
            .sort((a, b) => {
              const dateA = a.purchaseDate ? new Date(a.purchaseDate).getTime() : 0;
              const dateB = b.purchaseDate ? new Date(b.purchaseDate).getTime() : 0;
              return dateB - dateA;
            })
            .map(tool => (
            <div key={tool.id} style={{
              display: 'flex',
              gap: '20px',
              padding: '20px',
              borderBottom: '1px solid #e5e5e5'
            }}>
              {/* Images Column */}
              <div style={{ display: 'flex', gap: '10px' }}>
                {tool.catalogImages.length > 0 && (
                  <img
                    src={tool.catalogImages[0]}
                    alt="Product"
                    loading="lazy"
                    style={{
                      width: '80px',
                      height: '80px',
                      objectFit: 'contain',
                      border: '2px solid #3b82f6',
                      borderRadius: '4px',
                      padding: '4px',
                      backgroundColor: 'var(--surface)'
                    }}
                  />
                )}
                {tool.userImages.length > 0 && (
                  <img
                    src={tool.userImages[0]}
                    alt="User"
                    loading="lazy"
                    style={{
                      width: '80px',
                      height: '80px',
                      objectFit: 'cover',
                      border: '2px solid #10b981',
                      borderRadius: '4px'
                    }}
                  />
                )}
              </div>
              
              {/* Info Column */}
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 5px 0' }}>{tool.name}</h4>
                <p style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>
                  {tool.brand} • {tool.partNumber}
                  {tool.purchaseDate && ` • Purchased ${new Date(tool.purchaseDate).toLocaleDateString()}`}
                </p>
                {tool.condition && (
                  <span style={{
                    fontSize: '12px',
                    padding: '2px 6px',
                    backgroundColor: 'var(--bg)',
                    borderRadius: '4px'
                  }}>
                    Condition: {tool.condition}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolGalleryView;
