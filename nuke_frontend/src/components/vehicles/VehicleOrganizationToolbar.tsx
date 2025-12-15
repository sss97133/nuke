import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleOrganizationToolbarProps {
  vehicleId: string;
  userId: string;
  onUpdate?: () => void;
}

interface VehiclePreferences {
  is_favorite: boolean;
  is_hidden: boolean;
  collection_name: string | null;
  notes: string | null;
}

const VehicleOrganizationToolbar: React.FC<VehicleOrganizationToolbarProps> = ({
  vehicleId,
  userId,
  onUpdate
}) => {
  const [preferences, setPreferences] = useState<VehiclePreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [collections, setCollections] = useState<string[]>([]);
  const [showCollectionInput, setShowCollectionInput] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');

  useEffect(() => {
    loadPreferences();
    loadCollections();
  }, [vehicleId, userId]);

  const loadPreferences = async () => {
    try {
      const { data, error } = await supabase
        .from('user_vehicle_preferences')
        .select('is_favorite, is_hidden, collection_name, notes')
        .eq('user_id', userId)
        .eq('vehicle_id', vehicleId)
        .maybeSingle();

      if (error) {
        // Table might not exist yet - that's ok
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.log('user_vehicle_preferences table not found - migration may not be applied yet');
          setPreferences({
            is_favorite: false,
            is_hidden: false,
            collection_name: null,
            notes: null
          });
          setLoading(false);
          return;
        }
        if (error.code !== 'PGRST116') throw error;
      }

      setPreferences({
        is_favorite: data?.is_favorite || false,
        is_hidden: data?.is_hidden || false,
        collection_name: data?.collection_name || null,
        notes: data?.notes || null
      });
    } catch (error) {
      console.error('Error loading preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCollections = async () => {
    try {
      const { data, error } = await supabase
        .from('user_vehicle_preferences')
        .select('collection_name')
        .eq('user_id', userId)
        .not('collection_name', 'is', null)
        .order('collection_name');

      if (error) {
        // Table might not exist yet - that's ok
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          console.log('user_vehicle_preferences table not found - migration may not be applied yet');
          return;
        }
        throw error;
      }

      const uniqueCollections = Array.from(
        new Set((data || []).map((p: any) => p.collection_name).filter(Boolean))
      ) as string[];
      setCollections(uniqueCollections);
    } catch (error) {
      console.error('Error loading collections:', error);
    }
  };

  const updatePreference = async (updates: Partial<VehiclePreferences>) => {
    try {
      const { error } = await supabase
        .from('user_vehicle_preferences')
        .upsert({
          user_id: userId,
          vehicle_id: vehicleId,
          ...preferences,
          ...updates
        }, {
          onConflict: 'user_id,vehicle_id'
        });

      if (error) {
        // Table might not exist yet
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          alert('Please apply the database migration first. The user_vehicle_preferences table is required.');
          return;
        }
        throw error;
      }

      setPreferences(prev => ({ ...prev, ...updates } as VehiclePreferences));
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error updating preference:', error);
      alert('Failed to update preference');
    }
  };

  const toggleFavorite = () => {
    updatePreference({ is_favorite: !preferences?.is_favorite });
  };

  const toggleHidden = () => {
    updatePreference({ is_hidden: !preferences?.is_hidden });
  };

  const addToCollection = async (collectionName: string) => {
    if (!collectionName.trim()) return;
    await updatePreference({ collection_name: collectionName.trim() });
    setShowCollectionInput(false);
    setNewCollectionName('');
    loadCollections();
  };

  const removeFromCollection = () => {
    updatePreference({ collection_name: null });
  };

  if (loading) {
    return (
      <div style={{ padding: '4px', fontSize: '7pt', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      gap: '6px',
      alignItems: 'center',
      flexWrap: 'wrap',
      padding: '4px 0'
    }}>
      {/* Favorite Button */}
      <button
        onClick={toggleFavorite}
        style={{
          padding: '4px 8px',
          fontSize: '7pt',
          fontWeight: 600,
          border: '1px solid var(--border)',
          background: preferences?.is_favorite ? '#fef3c7' : 'white',
          color: preferences?.is_favorite ? '#92400e' : 'var(--text-muted)',
          cursor: 'pointer',
          borderRadius: '3px',
          transition: 'all 0.12s ease'
        }}
        title={preferences?.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        {preferences?.is_favorite ? 'FAVORITE' : 'FAVORITE'}
      </button>

      {/* Hide Button */}
      <button
        onClick={toggleHidden}
        style={{
          padding: '4px 8px',
          fontSize: '7pt',
          fontWeight: 600,
          border: '1px solid var(--border)',
          background: preferences?.is_hidden ? '#fee2e2' : 'white',
          color: preferences?.is_hidden ? '#991b1b' : 'var(--text-muted)',
          cursor: 'pointer',
          borderRadius: '3px',
          transition: 'all 0.12s ease'
        }}
        title={preferences?.is_hidden ? 'Show in personal view' : 'Hide from personal view'}
      >
        {preferences?.is_hidden ? 'HIDDEN' : 'HIDE'}
      </button>

      {/* Collection Dropdown */}
      {preferences?.collection_name ? (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <span style={{
            padding: '4px 8px',
            fontSize: '7pt',
            fontWeight: 600,
            background: '#dbeafe',
            color: '#1e40af',
            borderRadius: '3px',
            border: '1px solid #93c5fd'
          }}>
            {preferences.collection_name}
          </span>
          <button
            onClick={removeFromCollection}
            style={{
              padding: '2px 6px',
              fontSize: '7pt',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              borderRadius: '3px'
            }}
            title="Remove from collection"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          {showCollectionInput ? (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    addToCollection(newCollectionName);
                  } else if (e.key === 'Escape') {
                    setShowCollectionInput(false);
                    setNewCollectionName('');
                  }
                }}
                placeholder="Collection name"
                style={{
                  padding: '4px 8px',
                  fontSize: '7pt',
                  border: '1px solid var(--border)',
                  borderRadius: '3px',
                  width: '120px'
                }}
                autoFocus
              />
              <button
                onClick={() => addToCollection(newCollectionName)}
                style={{
                  padding: '4px 8px',
                  fontSize: '7pt',
                  border: '1px solid var(--accent)',
                  background: 'var(--accent)',
                  color: 'white',
                  cursor: 'pointer',
                  borderRadius: '3px'
                }}
              >
                ADD
              </button>
              <button
                onClick={() => {
                  setShowCollectionInput(false);
                  setNewCollectionName('');
                }}
                style={{
                  padding: '4px 8px',
                  fontSize: '7pt',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: '3px'
                }}
              >
                CANCEL
              </button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowCollectionInput(true)}
                style={{
                  padding: '4px 8px',
                  fontSize: '7pt',
                  fontWeight: 600,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  borderRadius: '3px',
                  transition: 'all 0.12s ease'
                }}
                title="Add to collection"
              >
                COLLECTION
              </button>
              {collections.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  zIndex: 1000,
                  minWidth: '150px',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}>
                  {collections.map((collection) => (
                    <button
                      key={collection}
                      onClick={() => addToCollection(collection)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 12px',
                        fontSize: '7pt',
                        textAlign: 'left',
                        border: 'none',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        transition: 'background 0.12s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                      {collection}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

    </div>
  );
};

export default VehicleOrganizationToolbar;

