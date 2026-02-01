import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Component {
  id: string;
  vehicle_id: string;
  component_category: string;
  component_type: string;
  brand: string;
  part_number?: string;
  installed_date?: string;
  installed_by?: string;
  quality_tier?: string;
  purchase_price?: number;
  verification_photos?: string[];
}

interface VehicleComponentsSectionProps {
  vehicleId: string;
  isOwner: boolean;
}

const VehicleComponentsSection: React.FC<VehicleComponentsSectionProps> = ({ vehicleId, isOwner }) => {
  const [components, setComponents] = useState<Component[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newComponent, setNewComponent] = useState({
    component_category: '',
    component_type: '',
    brand: '',
    part_number: '',
    quality_tier: 'aftermarket'
  });

  useEffect(() => {
    loadComponents();
  }, [vehicleId]);

  const loadComponents = async () => {
    try {
      // First try to load from component_installations table
      let { data: installedData, error: installError } = await supabase
        .from('component_installations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('installed_date', { ascending: false });

      let components: Component[] = [];

      if (!installError && installedData && installedData.length > 0) {
        // Use actual component data if available
        components = installedData;
      } else {
        // Fallback to extracting component data from image tags
        console.log('Component table not found or empty, sourcing from image tags');

        try {
          // Get all images for this vehicle
          const { data: vehicleImages, error: imageError } = await supabase
            .from('vehicle_images')
            .select('id')
            .eq('vehicle_id', vehicleId);

          if (vehicleImages && vehicleImages.length > 0) {
            const imageIds = vehicleImages.map(img => img.id);

            // Get tags from images that are component-related
            const { data: tagData, error: tagError } = await supabase
              .from('image_tags')
              .select('*')
              .in('image_id', imageIds)
              .in('type', ['product', 'part', 'brand', 'tool'])
              .order('created_at', { ascending: false });

            if (tagData && tagData.length > 0) {
              // Process tags to extract component information
              components = extractComponentsFromTags(tagData);
            }
          }
        } catch (tagErr) {
          console.log('Could not load components from tags:', tagErr);
        }
      }

      setComponents(components);
    } catch (err) {
      console.error('Error loading components:', err);
      setComponents([]);
    } finally {
      setLoading(false);
    }
  };

  const extractComponentsFromTags = (tags: any[]): Component[] => {
    const componentMap = new Map<string, Component>();

    tags.forEach((tag, index) => {
      const text = tag.text?.toLowerCase() || '';
      const type = tag.type || 'product';

      // Try to extract brand, part, and category information from tag text
      let brand = '';
      let componentType = '';
      let category = 'other';
      let partNumber = '';

      // Extract brand names (common auto parts brands)
      const brandMatches = text.match(/\b(arp|clevite|fel-pro|acdelco|bosch|denso|ngk|oem|mopar|ford|gm|toyota|honda|nissan|subaru|mazda|bmw|mercedes|audi|volkswagen|porsche)\b/i);
      if (brandMatches) {
        brand = brandMatches[1].toUpperCase();
      }

      // Extract part numbers (patterns like ABC-123, 123ABC, etc.)
      const partMatches = text.match(/\b([A-Z0-9]+-[A-Z0-9]+|[A-Z]+[0-9]+|[0-9]+[A-Z]+)\b/i);
      if (partMatches) {
        partNumber = partMatches[1].toUpperCase();
      }

      // Categorize based on keywords
      if (text.includes('stud') || text.includes('bolt') || text.includes('screw')) {
        category = 'fasteners';
        componentType = text.includes('head') ? 'head_studs' : 'bolts';
      } else if (text.includes('bearing')) {
        category = 'bearings';
        componentType = text.includes('main') ? 'main_bearings' : 'bearings';
      } else if (text.includes('gasket') || text.includes('seal')) {
        category = 'gaskets';
        componentType = 'gaskets';
      } else if (text.includes('brake') || text.includes('pad') || text.includes('rotor')) {
        category = 'brakes';
        componentType = text.includes('pad') ? 'brake_pads' : 'brake_components';
      } else if (text.includes('suspension') || text.includes('strut') || text.includes('shock')) {
        category = 'suspension';
        componentType = 'suspension_components';
      } else if (text.includes('filter') || text.includes('oil')) {
        category = 'engine';
        componentType = text.includes('oil') ? 'oil_filter' : 'filter';
      } else {
        // Default categorization
        componentType = text.substring(0, 30); // Use first 30 chars as component type
      }

      // Create unique key for grouping similar components
      const key = `${brand}_${componentType}_${category}`;

      if (!componentMap.has(key) && (brand || componentType)) {
        componentMap.set(key, {
          id: `tag_${index}_${Date.now()}`,
          vehicle_id: vehicleId,
          component_category: category,
          component_type: componentType,
          brand: brand || 'Unknown',
          part_number: partNumber,
          quality_tier: brand ? 'aftermarket' : undefined,
          installed_date: tag.created_at,
        });
      }
    });

    return Array.from(componentMap.values());
  };

  const handleAddComponent = async () => {
    try {
      const { data, error } = await supabase
        .from('component_installations')
        .insert([{
          vehicle_id: vehicleId,
          ...newComponent,
          installed_date: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Error adding component:', error);
        // For now, add to local state even if DB fails
        const mockComponent = {
          id: Date.now().toString(),
          vehicle_id: vehicleId,
          ...newComponent,
          installed_date: new Date().toISOString()
        };
        setComponents([mockComponent, ...components]);
      } else {
        setComponents([data, ...components]);
      }
      
      setShowAddForm(false);
      setNewComponent({
        component_category: '',
        component_type: '',
        brand: '',
        part_number: '',
        quality_tier: 'aftermarket'
      });
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const getQualityColor = (tier?: string) => {
    switch (tier) {
      case 'premium': return '#16a34a';
      case 'oem': return '#0284c7';
      case 'aftermarket': return '#6b7280';
      case 'economy': return '#dc2626';
      default: return '#6b7280';
    }
  };

  if (loading) {
    return <div>Loading components...</div>;
  }

  return (
    <div className="card">
      <div className="card-header">
        <span>Installed Components</span>
        {isOwner && (
          <button
            className="button button-small button-secondary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Cancel' : 'Add Component'}
          </button>
        )}
      </div>
      
      {showAddForm && (
        <div className="card-body" style={{ borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280' }}>Category</label>
              <select
                value={newComponent.component_category}
                onChange={(e) => setNewComponent({...newComponent, component_category: e.target.value})}
                className="form-input"
                style={{ fontSize: '14px' }}
              >
                <option value="">Select category</option>
                <option value="fasteners">Fasteners</option>
                <option value="bearings">Bearings</option>
                <option value="gaskets">Gaskets</option>
                <option value="electronics">Electronics</option>
                <option value="suspension">Suspension</option>
                <option value="brakes">Brakes</option>
                <option value="engine">Engine</option>
                <option value="transmission">Transmission</option>
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280' }}>Type</label>
              <input
                type="text"
                value={newComponent.component_type}
                onChange={(e) => setNewComponent({...newComponent, component_type: e.target.value})}
                className="form-input"
                placeholder="e.g., head studs, main bearings"
                style={{ fontSize: '14px' }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280' }}>Brand</label>
              <input
                type="text"
                value={newComponent.brand}
                onChange={(e) => setNewComponent({...newComponent, brand: e.target.value})}
                className="form-input"
                placeholder="e.g., ARP, Clevite, Fel-Pro"
                style={{ fontSize: '14px' }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280' }}>Part Number</label>
              <input
                type="text"
                value={newComponent.part_number}
                onChange={(e) => setNewComponent({...newComponent, part_number: e.target.value})}
                className="form-input"
                placeholder="e.g., ARP-2000"
                style={{ fontSize: '14px' }}
              />
            </div>
            
            <div>
              <label style={{ fontSize: '12px', color: '#6b7280' }}>Quality Tier</label>
              <select
                value={newComponent.quality_tier}
                onChange={(e) => setNewComponent({...newComponent, quality_tier: e.target.value})}
                className="form-input"
                style={{ fontSize: '14px' }}
              >
                <option value="premium">Premium</option>
                <option value="oem">OEM</option>
                <option value="aftermarket">Aftermarket</option>
                <option value="economy">Economy</option>
              </select>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                onClick={handleAddComponent}
                className="button button-primary"
                style={{ width: '100%' }}
              >
                Add Component
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="card-body">
        {components.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
            No components documented yet
            {isOwner && !showAddForm && (
              <div style={{ marginTop: '8px', fontSize: '13px' }}>
                Click "Add Component" to start documenting parts
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Group by category */}
            {Object.entries(
              components.reduce((acc, comp) => {
                const cat = comp.component_category || 'Other';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(comp);
                return acc;
              }, {} as Record<string, Component[]>)
            ).map(([category, categoryComponents]) => (
              <div key={category}>
                <div style={{ 
                  fontSize: '11px', 
                  fontWeight: '600', 
                  color: '#6b7280', 
                  marginBottom: '8px', 
                  marginTop: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px' 
                }}>
                  {category}
                </div>
                {categoryComponents.map(comp => (
                  <div 
                    key={comp.id}
                    style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      padding: '8px 0', 
                      borderBottom: '1px solid #e5e7eb' 
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ 
                        width: '6px', 
                        height: '6px', 
                        borderRadius: '50%', 
                        backgroundColor: getQualityColor(comp.quality_tier) 
                      }} />
                      <span style={{ fontSize: '13px' }}>
                        {comp.brand} {comp.component_type}
                      </span>
                      {comp.part_number && (
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                          ({comp.part_number})
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {comp.quality_tier && (
                        <span style={{ 
                          fontSize: '11px', 
                          color: getQualityColor(comp.quality_tier),
                          fontWeight: '500',
                          textTransform: 'uppercase' 
                        }}>
                          {comp.quality_tier}
                        </span>
                      )}
                      {comp.purchase_price && (
                        <span style={{ fontSize: '13px', fontWeight: '500' }}>
                          ${comp.purchase_price}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            
            {/* Total component value */}
            {components.some(c => c.purchase_price) && (
              <div style={{ 
                marginTop: '12px', 
                paddingTop: '12px', 
                borderTop: '2px solid #e5e7eb',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '13px', fontWeight: '600' }}>
                  Total Component Value
                </span>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#059669' }}>
                  ${components.reduce((sum, c) => sum + (c.purchase_price || 0), 0).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleComponentsSection;
