import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface SimpleImageTestProps {
  vehicleId: string;
}

interface ImageTag {
  id: string;
  x: number;
  y: number;
  text: string;
  type: string;
  isEditing?: boolean;
}

const TAG_TYPES = [
  { value: 'part', label: 'Part' },
  { value: 'damage', label: 'Damage' },
  { value: 'modification', label: 'Modification' },
  { value: 'tool', label: 'Tool' }
];

const SimpleImageTest: React.FC<SimpleImageTestProps> = ({ vehicleId }) => {
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [showTags, setShowTags] = useState(false);
  const [imageTags, setImageTags] = useState<ImageTag[]>([]);
  const [tagText, setTagText] = useState('');
  const [selectedTagType, setSelectedTagType] = useState('part');
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  useEffect(() => {
    loadImages();
  }, [vehicleId]);

  useEffect(() => {
    if (selectedImage && showTags) {
      loadImageTags(selectedImage.id);
    }
  }, [selectedImage, showTags]);

  const loadImages = async () => {
    try {
      console.log('Loading images for vehicle:', vehicleId);

      const { data, error } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading images:', error);
        return;
      }

      console.log('Loaded images:', data?.length || 0);
      setImages(data || []);
    } catch (error) {
      console.error('Failed to load images:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadImageTags = async (imageId: string) => {
    try {
      const { data, error } = await supabase
        .from('image_tags')
        .select('*')
        .eq('image_id', imageId)
        .order('inserted_at', { ascending: false });

      if (error) {
        console.error('Failed to load image tags:', error);
        return;
      }

      const tags = data?.map((tag: any) => ({
        id: tag.id,
        x: tag.x_position,
        y: tag.y_position,
        text: tag.text,
        type: tag.tag_type,
        isEditing: false
      })) || [];

      console.log('Loaded tags:', tags.length);
      setImageTags(tags);
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  };

  const handleImageClick = (e: React.MouseEvent) => {
    if (!showTags) return;

    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    const newTagId = `tag-${Date.now()}`;
    const newTag: ImageTag = {
      id: newTagId,
      x: x,
      y: y,
      text: '',
      type: selectedTagType,
      isEditing: true
    };

    setImageTags(prev => [...prev, newTag]);
    setActiveTagId(newTagId);
    setTagText('');
  };

  const saveTag = async (tagId: string) => {
    if (!tagText.trim()) return;

    const tag = imageTags.find(t => t.id === tagId);
    if (!tag) return;

    try {
      const { data: newTag, error } = await supabase
        .from('image_tags')
        .insert({
          id: crypto.randomUUID(),
          image_id: selectedImage.id,
          x_position: tag.x,
          y_position: tag.y,
          tag_type: selectedTagType,
          text: tagText.trim(),
          inserted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (!error && newTag) {
        setImageTags(prev => prev.map(t =>
          t.id === tagId
            ? {
              id: newTag.id,
              x: newTag.x_position,
              y: newTag.y_position,
              text: newTag.text,
              type: newTag.tag_type,
              isEditing: false
            }
            : t
        ));
        console.log('Tag saved successfully:', newTag.text);
      } else {
        console.error('Failed to save tag:', error);
      }
    } catch (error) {
      console.error('Error saving tag:', error);
    }

    setActiveTagId(null);
    setTagText('');
  };

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading images...</div>;
  }

  if (images.length === 0) {
    return <div style={{ padding: '20px' }}>No images found for vehicle {vehicleId}</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Vehicle Images ({images.length} images)</h2>

      {!selectedImage ? (
        // Clean Gallery Grid
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
          gap: '20px',
          marginTop: '20px'
        }}>
          {images.map((image) => (
            <div
              key={image.id}
              style={{
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                backgroundColor: 'var(--surface)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}
              onClick={() => {
                console.log('Opening lightbox for image:', image.id);
                setSelectedImage(image);
                setShowTags(false);
                setImageTags([]);
                loadImageTags(image.id);
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
              }}
            >
              <img
                src={image.image_url}
                alt="Vehicle"
                style={{
                  width: '100%',
                  height: '200px',
                  objectFit: 'cover'
                }}
              />
              <div style={{
                padding: '12px',
                textAlign: 'center',
                fontSize: '14px',
                color: '#495057',
                fontWeight: '500'
              }}>
                Click to view and tag
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Streamlined Lightbox with Sidebar
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#000',
          zIndex: 1000,
          display: 'flex'
        }}>
          {/* Main Image Area */}
          <div style={{
            flex: '1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            padding: '20px'
          }}>
            <img
              src={selectedImage.image_url}
              alt="Vehicle"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                cursor: showTags ? 'crosshair' : 'default'
              }}
              onClick={handleImageClick}
            />

            {/* Tag Overlays */}
            {showTags && imageTags.map((tag) => (
              <div
                key={tag.id}
                style={{
                  position: 'absolute',
                  left: `${tag.x}%`,
                  top: `${tag.y}%`,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: tag.isEditing ? '#424242' : '#212121',
                  color: 'white',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                  pointerEvents: 'none',
                  zIndex: 1001,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  minWidth: tag.isEditing ? '24px' : 'auto',
                  minHeight: tag.isEditing ? '24px' : 'auto'
                }}
              >
                {tag.text || (tag.isEditing ? '●' : '')}
              </div>
            ))}

            {/* Close Button */}
            <button
              onClick={() => setSelectedImage(null)}
              style={{
                position: 'absolute',
                top: '20px',
                left: '20px',
                background: 'var(--surface-glass)',
                border: 'none',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                fontSize: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                zIndex: 1002
              }}
            >
              ✕
            </button>
          </div>

          {/* Right Sidebar */}
          <div style={{
            width: '360px',
            backgroundColor: '#f8f9fa',
            borderLeft: '1px solid #dee2e6',
            display: 'flex',
            flexDirection: 'column',
            height: '100vh'
          }}>
            {/* Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid #dee2e6',
              backgroundColor: 'var(--surface)'
            }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', fontWeight: '600' }}>
                Image Tools
              </h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#6c757d' }}>
                Tag parts and add comments
              </p>
            </div>

            {/* Tool Controls */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid #dee2e6',
              backgroundColor: 'var(--surface)'
            }}>
              <button
                onClick={() => {
                  setShowTags(!showTags);
                  if (!showTags) {
                    loadImageTags(selectedImage.id);
                  }
                }}
                style={{
                  width: '100%',
                  background: showTags ? '#424242' : '#757575',
                  color: 'white',
                  border: 'none',
                  padding: '12px 16px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  marginBottom: '16px',
                  transition: 'all 0.2s ease'
                }}
              >
                {showTags ? '✓ Tagging Mode ON' : 'Enable Tagging'}
              </button>

              {showTags && (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#e7f3ff',
                  borderRadius: '6px',
                  border: '1px solid #b8daff'
                }}>
                  <label style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#495057',
                    marginBottom: '6px'
                  }}>
                    TAG TYPE
                  </label>
                  <select
                    value={selectedTagType}
                    onChange={(e) => setSelectedTagType(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #ced4da',
                      borderRadius: '4px',
                      fontSize: '14px',
                      marginBottom: '12px'
                    }}
                  >
                    {TAG_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>

                  {activeTagId ? (
                    <div>
                      <label style={{
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#495057',
                        marginBottom: '6px'
                      }}>
                        PART NAME
                      </label>
                      <input
                        type="text"
                        value={tagText}
                        onChange={(e) => setTagText(e.target.value)}
                        onKeyPress={(e) => {
                          if (e.key === 'Enter') {
                            saveTag(activeTagId);
                          }
                        }}
                        placeholder="Enter part name..."
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #ced4da',
                          borderRadius: '4px',
                          fontSize: '14px',
                          marginBottom: '12px'
                        }}
                        autoFocus
                      />
                      <button
                        onClick={() => saveTag(activeTagId)}
                        style={{
                          width: '100%',
                          background: '#28a745',
                          color: 'white',
                          border: 'none',
                          padding: '10px 16px',
                          borderRadius: '4px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Save Tag
                      </button>
                    </div>
                  ) : (
                    <div style={{
                      fontSize: '13px',
                      color: '#6c757d',
                      fontStyle: 'italic'
                    }}>
                      Click on the image to place a tag
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tagged Parts List */}
            <div style={{
              padding: '20px',
              flex: '1',
              overflowY: 'auto'
            }}>
              <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: '600',
                color: '#495057'
              }}>
                Tagged Parts ({imageTags.filter(t => !t.isEditing).length})
              </h4>

              {imageTags.filter(t => !t.isEditing).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {imageTags.filter(t => !t.isEditing).map((tag) => (
                    <div key={tag.id} style={{
                      padding: '12px',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid #dee2e6',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}>
                      <div style={{ fontWeight: '600', color: '#495057' }}>
                        {tag.text}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6c757d', marginTop: '4px' }}>
                        Type: {tag.type}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: '#6c757d',
                  fontSize: '14px'
                }}>
                  No parts tagged yet.<br />
                  Enable tagging and click on the image to add tags.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SimpleImageTest;