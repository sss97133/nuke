import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface QuickVehicleAddProps {
  onVehicleAdded?: () => void;
}

const QuickVehicleAdd = ({ onVehicleAdded }: QuickVehicleAddProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    year: '',
    make: '',
    model: '',
    color: '',
    description: '',
    isContribution: false,
    sourceUrl: '',
    images: [] as File[]
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.year || !formData.make || !formData.model) {
      alert('Please fill in Year, Make, and Model');
      return;
    }

    try {
      setLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Please sign in to add vehicles');
        return;
      }

      // Create the vehicle record
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .insert({
          year: parseInt(formData.year),
          make: formData.make,
          model: formData.model,
          color: formData.color,
          description: formData.description,
          uploaded_by: user.id,
          is_public: true,
          source: formData.isContribution ? 'user_contribution' : 'user_owned',
          source_url: formData.sourceUrl || null
        })
        .select()
        .single();

      if (vehicleError) throw vehicleError;

      // Upload images if provided
      if (formData.images.length > 0 && vehicle) {
        for (let i = 0; i < formData.images.length; i++) {
          const file = formData.images[i];
          const fileName = `${Date.now()}-${i}-${file.name}`;

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from('vehicle-images')
            .upload(fileName, file);

          if (!uploadError) {
            // Get public URL
            const { data: urlData } = supabase.storage
              .from('vehicle-images')
              .getPublicUrl(fileName);

            // Insert image record
            await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicle.id,
                image_url: urlData.publicUrl,
                uploaded_by: user.id,
                is_primary: i === 0 // First image is primary
              });
          }
        }
      }

      // Create timeline event for the addition
      await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: vehicle.id,
          user_id: user.id,
          event_type: formData.isContribution ? 'vehicle_contributed' : 'vehicle_added',
          title: `${formData.isContribution ? 'Contributed' : 'Added'} ${formData.year} ${formData.make} ${formData.model}`,
          description: formData.description || `${formData.color} ${formData.make} ${formData.model}`,
          event_date: new Date().toISOString().split('T')[0]
        });

      // Reset form
      setFormData({
        year: '',
        make: '',
        model: '',
        color: '',
        description: '',
        isContribution: false,
        sourceUrl: '',
        images: []
      });
      setIsOpen(false);

      if (onVehicleAdded) onVehicleAdded();

    } catch (error) {
      console.error('Error adding vehicle:', error);
      alert('Failed to add vehicle. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setFormData(prev => ({ ...prev, images: files }));
  };

  if (!isOpen) {
    return (
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 1000
      }}>
        <button
          onClick={() => setIsOpen(true)}
          className="button button-primary"
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            fontSize: '24px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}
          title="Add Vehicle"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '500px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h2 className="heading-2" style={{ margin: 0 }}>Add Vehicle</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="button button-secondary"
            style={{ padding: '4px 8px' }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Contribution Toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={formData.isContribution}
                onChange={(e) => setFormData(prev => ({
                  ...prev,
                  isContribution: e.target.checked
                }))}
              />
              <span className="text">
                This is a contribution (I found this vehicle online)
              </span>
            </label>
          </div>

          {/* Basic Info */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr 2fr',
            gap: '12px',
            marginBottom: '16px'
          }}>
            <div>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
                Year *
              </label>
              <input
                type="number"
                className="input"
                value={formData.year}
                onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                placeholder="2020"
                min="1900"
                max={new Date().getFullYear() + 1}
                required
              />
            </div>
            <div>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
                Make *
              </label>
              <input
                type="text"
                className="input"
                value={formData.make}
                onChange={(e) => setFormData(prev => ({ ...prev, make: e.target.value }))}
                placeholder="Toyota"
                required
              />
            </div>
            <div>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
                Model *
              </label>
              <input
                type="text"
                className="input"
                value={formData.model}
                onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
                placeholder="Camry"
                required
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
              Color
            </label>
            <input
              type="text"
              className="input"
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              placeholder="Red"
            />
          </div>

          {/* Source URL for contributions */}
          {formData.isContribution && (
            <div style={{ marginBottom: '16px' }}>
              <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
                Source URL
              </label>
              <input
                type="url"
                className="input"
                value={formData.sourceUrl}
                onChange={(e) => setFormData(prev => ({ ...prev, sourceUrl: e.target.value }))}
                placeholder="https://bringatrailer.com/..."
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
              Description
            </label>
            <textarea
              className="input"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Tell us about this vehicle..."
              rows={3}
            />
          </div>

          {/* Image Upload */}
          <div style={{ marginBottom: '20px' }}>
            <label className="text text-bold" style={{ display: 'block', marginBottom: '4px' }}>
              Images
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={{ width: '100%' }}
            />
            {formData.images.length > 0 && (
              <p className="text text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
                {formData.images.length} image{formData.images.length !== 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end'
          }}>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="button button-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={loading}
            >
              {loading ? 'Adding...' : formData.isContribution ? 'Contribute Vehicle' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default QuickVehicleAdd;