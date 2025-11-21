import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface VehicleDescriptionCardProps {
  vehicleId: string;
  initialDescription?: string | null;
  isEditable: boolean;
  onUpdate?: (description: string) => void;
}

export const VehicleDescriptionCard: React.FC<VehicleDescriptionCardProps> = ({
  vehicleId,
  initialDescription,
  isEditable,
  onUpdate
}) => {
  const [description, setDescription] = useState(initialDescription || '');
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [isAIGenerated, setIsAIGenerated] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    loadDescriptionMetadata();
  }, [vehicleId]);

  const loadDescriptionMetadata = async () => {
    try {
      const { data } = await supabase
        .from('vehicles')
        .select('description, description_source, description_generated_at')
        .eq('id', vehicleId)
        .single();

      if (data) {
        setDescription(data.description || '');
        setIsAIGenerated(data.description_source === 'ai_generated');
        setGeneratedAt(data.description_generated_at);
      }
    } catch (err) {
      console.warn('Failed to load description metadata:', err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({
          description: editValue,
          description_source: 'user_input',
          updated_at: new Date().toISOString()
        })
        .eq('id', vehicleId);

      if (!error) {
        setDescription(editValue);
        setIsAIGenerated(false);
        setIsEditing(false);
        if (onUpdate) onUpdate(editValue);
      }
    } catch (err) {
      console.error('Failed to save description:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = () => {
    setEditValue(description);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setEditValue('');
    setIsEditing(false);
  };

  const isEmpty = !description || description.trim().length === 0;

  return (
    <div className="card">
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', fontWeight: 700 }}>Description</span>
        {isEditable && !isEditing && (
          <button
            className="btn-utility"
            style={{ fontSize: '8px', padding: '2px 6px' }}
            onClick={handleEdit}
          >
            Edit
          </button>
        )}
      </div>
      <div className="card-body">
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              maxLength={500}
              rows={6}
              placeholder="Describe the vehicle, modifications, history..."
              style={{
                width: '100%',
                fontSize: '9pt',
                padding: '8px',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
            />
            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textAlign: 'right' }}>
              {editValue.length}/500
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                className="button button-secondary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : isEmpty ? (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
              No description yet.
            </div>
            {isEditable && (
              <button
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
                onClick={handleEdit}
              >
                Add Description
              </button>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '9pt', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {description}
            </div>
            {isAIGenerated && (
              <div style={{
                marginTop: '12px',
                padding: '8px',
                background: 'var(--bg-secondary)',
                borderRadius: '4px',
                fontSize: '7pt',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span>AI-generated from vehicle images</span>
                {generatedAt && (
                  <span>• {new Date(generatedAt).toLocaleDateString()}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VehicleDescriptionCard;

