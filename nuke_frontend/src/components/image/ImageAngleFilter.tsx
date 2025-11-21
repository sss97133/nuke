/**
 * Image Angle Filter Component
 * 
 * Provides UI for filtering images by angle classification
 */

import React, { useState, useEffect } from 'react';
import { getImagesByAngle, ImageAngleFilter as ImageAngleFilterType, ClassifiedImage } from '../../services/imageAngleService';

interface ImageAngleFilterProps {
  vehicleId: string;
  onFilteredImages: (images: ClassifiedImage[]) => void;
  onClose?: () => void;
}

const ANGLE_FAMILIES = [
  { value: 'front_corner', label: 'Front Corner' },
  { value: 'side', label: 'Side' },
  { value: 'rear_corner', label: 'Rear Corner' },
  { value: 'rear', label: 'Rear' },
  { value: 'front', label: 'Front' },
  { value: 'engine_bay', label: 'Engine Bay' },
  { value: 'interior', label: 'Interior' },
  { value: 'dash', label: 'Dashboard' },
  { value: 'detail', label: 'Detail/Close-up' },
  { value: 'labor', label: 'Labor/Repair' },
  { value: 'document', label: 'Document' },
  { value: 'vin_plate', label: 'VIN Plate' }
];

const VIEW_AXES = [
  { value: 'front_left', label: 'Front Left' },
  { value: 'front_right', label: 'Front Right' },
  { value: 'rear_left', label: 'Rear Left' },
  { value: 'rear_right', label: 'Rear Right' },
  { value: 'left', label: 'Left Side' },
  { value: 'right', label: 'Right Side' },
  { value: 'front', label: 'Front' },
  { value: 'rear', label: 'Rear' }
];

const ELEVATIONS = [
  { value: 'ground', label: 'Ground Level' },
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'eye', label: 'Eye Level' },
  { value: 'high', label: 'High' },
  { value: 'overhead', label: 'Overhead' }
];

const DISTANCES = [
  { value: 'close', label: 'Close-up' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'ultra_wide', label: 'Ultra Wide' }
];

export const ImageAngleFilter: React.FC<ImageAngleFilterProps> = ({
  vehicleId,
  onFilteredImages,
  onClose
}) => {
  const [filter, setFilter] = useState<ImageAngleFilterType>({
    vehicleId,
    minConfidence: 80
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ClassifiedImage[]>([]);

  useEffect(() => {
    applyFilter();
  }, [filter]);

  const applyFilter = async () => {
    setLoading(true);
    try {
      const images = await getImagesByAngle(filter);
      setResults(images);
      onFilteredImages(images);
    } catch (error) {
      console.error('Error applying filter:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (updates: Partial<ImageAngleFilterType>) => {
    setFilter(prev => ({ ...prev, ...updates }));
  };

  const clearFilter = () => {
    setFilter({
      vehicleId,
      minConfidence: 80
    });
  };

  return (
    <div className="card" style={{ padding: '16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '12pt' }}>Filter by Angle Classification</h3>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18pt', cursor: 'pointer' }}>
            ×
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        {/* Angle Family */}
        <div>
          <label style={{ display: 'block', fontSize: '9pt', marginBottom: '4px', fontWeight: 600 }}>
            Angle Family
          </label>
          <select
            value={filter.angleFamily as string || ''}
            onChange={(e) => updateFilter({ angleFamily: e.target.value || undefined })}
            style={{ width: '100%', padding: '6px', fontSize: '9pt' }}
          >
            <option value="">All</option>
            {ANGLE_FAMILIES.map(f => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        {/* View Axis */}
        <div>
          <label style={{ display: 'block', fontSize: '9pt', marginBottom: '4px', fontWeight: 600 }}>
            View Axis
          </label>
          <select
            value={filter.viewAxis as string || ''}
            onChange={(e) => updateFilter({ viewAxis: e.target.value || undefined })}
            style={{ width: '100%', padding: '6px', fontSize: '9pt' }}
          >
            <option value="">All</option>
            {VIEW_AXES.map(v => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </div>

        {/* Elevation */}
        <div>
          <label style={{ display: 'block', fontSize: '9pt', marginBottom: '4px', fontWeight: 600 }}>
            Elevation
          </label>
          <select
            value={filter.elevation as string || ''}
            onChange={(e) => updateFilter({ elevation: e.target.value || undefined })}
            style={{ width: '100%', padding: '6px', fontSize: '9pt' }}
          >
            <option value="">All</option>
            {ELEVATIONS.map(e => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>

        {/* Distance */}
        <div>
          <label style={{ display: 'block', fontSize: '9pt', marginBottom: '4px', fontWeight: 600 }}>
            Distance
          </label>
          <select
            value={filter.distance as string || ''}
            onChange={(e) => updateFilter({ distance: e.target.value || undefined })}
            style={{ width: '100%', padding: '6px', fontSize: '9pt' }}
          >
            <option value="">All</option>
            {DISTANCES.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        {/* Min Confidence */}
        <div>
          <label style={{ display: 'block', fontSize: '9pt', marginBottom: '4px', fontWeight: 600 }}>
            Min Confidence
          </label>
          <input
            type="number"
            min="0"
            max="100"
            value={filter.minConfidence || 80}
            onChange={(e) => updateFilter({ minConfidence: parseInt(e.target.value) || undefined })}
            style={{ width: '100%', padding: '6px', fontSize: '9pt' }}
          />
        </div>
      </div>

      <div style={{ marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={clearFilter}
          style={{
            padding: '6px 12px',
            fontSize: '9pt',
            background: 'var(--background-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Clear
        </button>
        <button
          onClick={applyFilter}
          disabled={loading}
          style={{
            padding: '6px 12px',
            fontSize: '9pt',
            background: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Loading...' : 'Apply Filter'}
        </button>
      </div>

      {results.length > 0 && (
        <div style={{ marginTop: '12px', fontSize: '9pt', color: 'var(--text-muted)' }}>
          Found {results.length} image{results.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

