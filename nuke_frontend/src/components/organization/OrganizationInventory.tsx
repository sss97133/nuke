// Organization Inventory - Tools, Equipment, Facilities
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  organizationId: string;
  isOwner?: boolean;
}

interface InventoryItem {
  id: string;
  item_type: 'tool' | 'equipment' | 'facility' | 'specialty' | 'certification';
  name: string;
  brand?: string;
  model?: string;
  description?: string;
  quantity?: number;
  image_url?: string;
  acquisition_date?: string;
  value_usd?: number;
  condition?: string;
  submitted_by: string;
  submitted_at: string;
  profiles?: {
    full_name: string;
    username: string;
    avatar_url?: string;
  };
}

export default function OrganizationInventory({ organizationId, isOwner = false }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'tool' | 'equipment' | 'facility' | 'specialty' | 'certification'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    loadInventory();
    loadCurrentUser();
  }, [organizationId]);

  const loadCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setCurrentUserId(user?.id || null);
  };

  const loadInventory = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('organization_inventory')
        .select('id, item_type, name, brand, model, description, quantity, image_url, acquisition_date, value_usd, condition, submitted_by, submitted_at')
        .eq('organization_id', organizationId)
        .order('submitted_at', { ascending: false });

      if (error) throw error;

      // Enrich with submitter profiles
      const enriched = await Promise.all(
        (data || []).map(async (item: any) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, username, avatar_url')
            .eq('id', item.submitted_by)
            .single();

          return {
            ...item,
            profiles: profile
          };
        })
      );

      setItems(enriched);
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = filter === 'all' ? items : items.filter(i => i.item_type === filter);

  const itemTypeLabels: Record<string, string> = {
    tool: 'Tool',
    equipment: 'Equipment',
    facility: 'Facility',
    specialty: 'Specialty',
    certification: 'Certification'
  };

  const itemTypeCounts = {
    all: items.length,
    tool: items.filter(i => i.item_type === 'tool').length,
    equipment: items.filter(i => i.item_type === 'equipment').length,
    facility: items.filter(i => i.item_type === 'facility').length,
    specialty: items.filter(i => i.item_type === 'specialty').length,
    certification: items.filter(i => i.item_type === 'certification').length
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
        Loading inventory...
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Shop Inventory ({filteredItems.length})</span>
        {isOwner && (
          <button
            onClick={() => setShowAddModal(true)}
            className="button button-primary button-small"
            style={{ fontSize: '8pt' }}
          >
            Add Item
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        {(['all', 'tool', 'equipment', 'facility', 'specialty', 'certification'] as const).map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              flex: 1,
              padding: '8px 12px',
              fontSize: '8pt',
              border: 'none',
              background: filter === type ? 'var(--white)' : 'transparent',
              borderBottom: filter === type ? '2px solid var(--accent)' : 'none',
              cursor: 'pointer',
              textTransform: 'capitalize',
              color: filter === type ? 'var(--accent)' : 'var(--text)'
            }}
          >
            {type === 'all' ? 'All' : itemTypeLabels[type]} {type !== 'all' && `(${itemTypeCounts[type]})`}
          </button>
        ))}
      </div>

      <div className="card-body">
        {filteredItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
            {filter === 'all' ? 'No inventory items yet' : `No ${filter} items yet`}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {filteredItems.map(item => (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  background: 'var(--white)',
                  transition: '0.12s',
                  cursor: 'pointer'
                }}
                className="hover-lift"
              >
                {/* Image */}
                {item.image_url && (
                  <div
                    style={{
                      height: '160px',
                      backgroundImage: `url(${item.image_url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      position: 'relative'
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      background: 'rgba(0,0,0,0.7)',
                      color: '#fff',
                      padding: '4px 8px',
                      borderRadius: '2px',
                      fontSize: '7pt',
                      fontWeight: 700
                    }}>
                      {itemTypeLabels[item.item_type].toUpperCase()}
                    </div>
                  </div>
                )}

                {/* Details */}
                <div style={{ padding: '12px' }}>
                  <div style={{ fontSize: '11pt', fontWeight: 700, marginBottom: '4px' }}>
                    {item.name}
                  </div>

                  {(item.brand || item.model) && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      {item.brand} {item.model}
                    </div>
                  )}

                  {item.description && (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.4 }}>
                      {item.description}
                    </div>
                  )}

                  {/* Stats Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '8px',
                    marginTop: '8px',
                    padding: '8px',
                    background: 'var(--surface)',
                    borderRadius: '2px'
                  }}>
                    {item.quantity && item.quantity > 1 && (
                      <div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Quantity</div>
                        <div style={{ fontSize: '9pt', fontWeight: 700 }}>{item.quantity}</div>
                      </div>
                    )}
                    {item.value_usd && (
                      <div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Value</div>
                        <div style={{ fontSize: '9pt', fontWeight: 700 }}>${item.value_usd.toLocaleString()}</div>
                      </div>
                    )}
                    {item.condition && (
                      <div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Condition</div>
                        <div style={{ fontSize: '9pt', fontWeight: 700, textTransform: 'capitalize' }}>{item.condition}</div>
                      </div>
                    )}
                    {item.acquisition_date && (
                      <div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>Acquired</div>
                        <div style={{ fontSize: '9pt', fontWeight: 700 }}>
                          {new Date(item.acquisition_date).getFullYear()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Attribution & Actions */}
                  <div style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--border-light)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <img
                        src={item.profiles?.avatar_url || '/default-avatar.png'}
                        alt={item.profiles?.full_name}
                        style={{ width: '20px', height: '20px', borderRadius: '50%' }}
                      />
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                        Added by {item.profiles?.full_name || item.profiles?.username}
                      </div>
                    </div>
                    {currentUserId === item.submitted_by && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingItem(item);
                        }}
                        className="button button-secondary button-small"
                        style={{ fontSize: '7pt', padding: '2px 6px' }}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Item Modal */}
      {showAddModal && (
        <AddInventoryItemModal
          organizationId={organizationId}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false);
            loadInventory();
          }}
        />
      )}

      {/* Edit Item Modal */}
      {editingItem && (
        <EditInventoryItemModal
          organizationId={organizationId}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            loadInventory();
          }}
        />
      )}
    </div>
  );
}

// Add Inventory Item Modal Component
interface AddInventoryItemModalProps {
  organizationId: string;
  onClose: () => void;
  onSaved: () => void;
}

function AddInventoryItemModal({ organizationId, onClose, onSaved }: AddInventoryItemModalProps) {
  const [itemType, setItemType] = useState<'tool' | 'equipment' | 'facility' | 'specialty' | 'certification'>('tool');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [valueUsd, setValueUsd] = useState<number | ''>('');
  const [condition, setCondition] = useState('good');
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      let imageUrl = null;

      // Upload image if provided
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
        const storagePath = `organization-data/${organizationId}/inventory/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(storagePath, imageFile);

        if (uploadError) throw uploadError;

        imageUrl = supabase.storage.from('vehicle-data').getPublicUrl(storagePath).data.publicUrl;
      }

      // Insert inventory item
      const { error: insertError } = await supabase
        .from('organization_inventory')
        .insert({
          organization_id: organizationId,
          item_type: itemType,
          name,
          brand: brand || null,
          model: model || null,
          description: description || null,
          quantity,
          value_usd: valueUsd || null,
          condition,
          acquisition_date: acquisitionDate || null,
          image_url: imageUrl,
          submitted_by: user.id
        });

      if (insertError) throw insertError;

      // Track contribution
      await supabase.from('organization_contributors').upsert({
        organization_id: organizationId,
        user_id: user.id,
        role: 'contributor',
        contribution_count: 1
      });

      // Timeline event
      await supabase.from('business_timeline_events').insert({
        business_id: organizationId,
        created_by: user.id,
        event_type: 'equipment_purchase',
        event_category: 'operational',
        title: `${itemType === 'tool' ? 'Tool' : itemType === 'equipment' ? 'Equipment' : itemType === 'facility' ? 'Facility' : itemType === 'specialty' ? 'Specialty item' : 'Certification'} added: ${name}`,
        description: `${brand ? brand + ' ' : ''}${model || name} added to inventory`,
        event_date: acquisitionDate || new Date().toISOString().split('T')[0],
        image_urls: imageUrl ? [imageUrl] : [],
        metadata: {
          item_type: itemType,
          submitted_by: user.id,
          value_usd: valueUsd || null
        }
      });

      onSaved();
    } catch (error: any) {
      console.error('Error adding inventory item:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10003,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          width: '100%',
          maxWidth: '500px',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          boxShadow: 'var(--shadow)',
          maxHeight: '95vh',
          overflow: 'auto',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        <div style={{ padding: '12px', borderBottom: '2px solid var(--border)', background: 'var(--surface)' }}>
          <h2 style={{ margin: 0, fontSize: '11pt', fontWeight: 700 }}>Add Inventory Item</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '8pt', color: 'var(--text-muted)' }}>
            Showcase your tools, equipment, and capabilities
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Item Type *
            </label>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value as any)}
              className="form-select"
              style={{ width: '100%', fontSize: '9pt' }}
              required
            >
              <option value="tool">Tool</option>
              <option value="equipment">Equipment</option>
              <option value="facility">Facility Feature</option>
              <option value="specialty">Specialty/Unique</option>
              <option value="certification">Certification/License</option>
            </select>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Name/Description *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="form-input"
              style={{ width: '100%', fontSize: '9pt' }}
              placeholder="e.g., 4-Post Lift, Snap-On Diagnostic Scanner"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Brand
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                placeholder="Snap-On, Rotary, etc."
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                placeholder="SPX-40, etc."
              />
            </div>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Details
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', minHeight: '60px' }}
              placeholder="What makes this special? Capabilities, specs, history..."
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Quantity
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                min="1"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Value (USD)
              </label>
              <input
                type="number"
                value={valueUsd}
                onChange={(e) => setValueUsd(e.target.value ? parseFloat(e.target.value) : '')}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                placeholder="0"
                step="0.01"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Condition
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="form-select"
                style={{ width: '100%', fontSize: '9pt' }}
              >
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="needs_repair">Needs Repair</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Acquisition Date
            </label>
            <input
              type="date"
              value={acquisitionDate}
              onChange={(e) => setAcquisitionDate(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '9pt' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
              Photo
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImageFile(file);
                    setSelectedFileName(file.name);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                  zIndex: 2
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="button button-secondary button-small"
                style={{ fontSize: '8pt', cursor: 'pointer', position: 'relative', zIndex: 1 }}
              >
                Choose File
              </button>
              <span style={{ fontSize: '8pt', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFileName || 'No file selected'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={onClose}
              className="button button-secondary button-small"
              style={{ fontSize: '8pt' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name}
              className="button button-primary button-small"
              style={{ fontSize: '8pt' }}
            >
              {submitting ? 'Adding...' : 'Add to Inventory'}
            </button>
          </div>
        </form>

        <div style={{ padding: '12px', background: 'var(--surface)', borderTop: '1px solid var(--border)', fontSize: '7pt', color: 'var(--text-muted)' }}>
          Your submission will be attributed to you and appear in the org timeline
        </div>
      </div>
    </div>
  );
}

// Edit Inventory Item Modal Component
interface EditInventoryItemModalProps {
  organizationId: string;
  item: InventoryItem;
  onClose: () => void;
  onSaved: () => void;
}

function EditInventoryItemModal({ organizationId, item, onClose, onSaved }: EditInventoryItemModalProps) {
  const [itemType, setItemType] = useState<'tool' | 'equipment' | 'facility' | 'specialty' | 'certification'>(item.item_type);
  const [name, setName] = useState(item.name);
  const [brand, setBrand] = useState(item.brand || '');
  const [model, setModel] = useState(item.model || '');
  const [description, setDescription] = useState(item.description || '');
  const [quantity, setQuantity] = useState(item.quantity || 1);
  const [valueUsd, setValueUsd] = useState<number | ''>(item.value_usd || '');
  const [condition, setCondition] = useState(item.condition || 'good');
  const [acquisitionDate, setAcquisitionDate] = useState(item.acquisition_date || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      let imageUrl = item.image_url;

      // Upload new image if provided
      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
        const storagePath = `organization-data/${organizationId}/inventory/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-data')
          .upload(storagePath, imageFile);

        if (uploadError) throw uploadError;

        imageUrl = supabase.storage.from('vehicle-data').getPublicUrl(storagePath).data.publicUrl;
      }

      // Update inventory item
      const { error: updateError } = await supabase
        .from('organization_inventory')
        .update({
          item_type: itemType,
          name,
          brand: brand || null,
          model: model || null,
          description: description || null,
          quantity,
          value_usd: valueUsd || null,
          condition,
          acquisition_date: acquisitionDate || null,
          image_url: imageUrl,
        })
        .eq('id', item.id);

      if (updateError) throw updateError;

      onSaved();
    } catch (error: any) {
      console.error('Error updating inventory item:', error);
      alert(`Failed: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this inventory item? This cannot be undone.')) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('organization_inventory')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      onSaved();
    } catch (error: any) {
      console.error('Error deleting inventory item:', error);
      alert(`Failed: ${error.message}`);
      setDeleting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10003,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--white)',
          width: '100%',
          maxWidth: '500px',
          border: '2px solid var(--border)',
          borderRadius: '4px',
          boxShadow: 'var(--shadow)',
          maxHeight: '90vh',
          overflow: 'auto'
        }}
      >
        <div style={{ padding: '16px', borderBottom: '2px solid var(--border)', background: 'var(--surface)' }}>
          <h2 style={{ margin: 0, fontSize: '12pt', fontWeight: 700 }}>Edit Inventory Item</h2>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Item Type *
            </label>
            <select
              value={itemType}
              onChange={(e) => setItemType(e.target.value as any)}
              className="form-select"
              style={{ width: '100%', fontSize: '9pt' }}
              required
            >
              <option value="tool">Tool</option>
              <option value="equipment">Equipment</option>
              <option value="facility">Facility Feature</option>
              <option value="specialty">Specialty/Unique</option>
              <option value="certification">Certification/License</option>
            </select>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Name/Description *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="form-input"
              style={{ width: '100%', fontSize: '9pt' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Brand
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Model
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Details
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '9pt', minHeight: '60px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Quantity
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                min="1"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Value (USD)
              </label>
              <input
                type="number"
                value={valueUsd}
                onChange={(e) => setValueUsd(e.target.value ? parseFloat(e.target.value) : '')}
                className="form-input"
                style={{ width: '100%', fontSize: '9pt' }}
                step="0.01"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                Condition
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="form-select"
                style={{ width: '100%', fontSize: '9pt' }}
              >
                <option value="excellent">Excellent</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="needs_repair">Needs Repair</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '8pt', fontWeight: 700, marginBottom: '2px' }}>
              Acquisition Date
            </label>
            <input
              type="date"
              value={acquisitionDate}
              onChange={(e) => setAcquisitionDate(e.target.value)}
              className="form-input"
              style={{ width: '100%', fontSize: '9pt' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
              Photo {item.image_url && '(upload new to replace)'}
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImageFile(file);
                    setSelectedFileName(file.name);
                  }
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                  zIndex: 2
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="button button-secondary button-small"
                style={{ fontSize: '8pt', cursor: 'pointer', position: 'relative', zIndex: 1 }}
              >
                Choose File
              </button>
              <span style={{ fontSize: '8pt', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedFileName || (item.image_url ? 'Current image' : 'No file selected')}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="button button-small"
              style={{ fontSize: '8pt', background: 'var(--danger)', color: 'white', border: 'none' }}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={onClose}
                className="button button-secondary button-small"
                style={{ fontSize: '8pt' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name}
                className="button button-primary button-small"
                style={{ fontSize: '8pt' }}
              >
                {submitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

