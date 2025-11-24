/**
 * Personal Photo Library
 * 
 * Main page for managing personal photo collection
 * - Bulk upload thousands of photos
 * - View unorganized inbox
 * - Organize into vehicles/albums
 * - Review AI suggestions
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonalPhotoLibraryService, PersonalPhoto, VehicleSuggestion, LibraryStats } from '../services/personalPhotoLibraryService';
import { ImageUploadService } from '../services/imageUploadService';
import { useImageSelection } from '../hooks/useImageSelection';
import { PhotoInboxGrid } from '../components/photos/PhotoInboxGrid';
import { VehicleSuggestionsPanel } from '../components/photos/VehicleSuggestionsPanel';
import { BulkUploadZone } from '../components/photos/BulkUploadZone';
import { PhotoOrganizeToolbar } from '../components/photos/PhotoOrganizeToolbar';

type ViewMode = 'unorganized' | 'organized' | 'all' | 'suggestions';
type GridDensity = 'small' | 'medium' | 'large';

export const PersonalPhotoLibrary: React.FC = () => {
  const navigate = useNavigate();
  
  // State
  const [viewMode, setViewMode] = useState<ViewMode>('unorganized');
  const [gridDensity, setGridDensity] = useState<GridDensity>('medium');
  const [photos, setPhotos] = useState<PersonalPhoto[]>([]);
  const [suggestions, setSuggestions] = useState<VehicleSuggestion[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  
  // Multi-select hook
  const { selectedImages, toggleImage, selectAll, clearSelection, isSelected } = useImageSelection();

  // Load data
  useEffect(() => {
    loadData();
  }, [viewMode]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, suggestionsData] = await Promise.all([
        PersonalPhotoLibraryService.getLibraryStats(),
        PersonalPhotoLibraryService.getVehicleSuggestions()
      ]);

      setStats(statsData);
      setSuggestions(suggestionsData);

      // Load photos based on view mode
      if (viewMode === 'unorganized') {
        const photosData = await PersonalPhotoLibraryService.getUnorganizedPhotos(1000);
        setPhotos(photosData);
      } else if (viewMode === 'organized') {
        const photosData = await PersonalPhotoLibraryService.getOrganizedPhotos(1000);
        setPhotos(photosData);
      } else if (viewMode === 'suggestions') {
        // Show suggestions panel
        setPhotos([]);
      }
    } catch (error) {
      console.error('Error loading photo library:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle bulk upload
  const handleBulkUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress({ current: 0, total: files.length });

    const results = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Upload without vehicle_id (goes to personal library)
        const result = await ImageUploadService.uploadImage(
          undefined as any, // No vehicle_id
          file,
          'general'
        );
        
        results.push({ file: file.name, success: result.success });
        setUploadProgress({ current: i + 1, total: files.length });
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        results.push({ file: file.name, success: false });
      }
    }

    setUploading(false);
    
    // Show summary
    const successCount = results.filter(r => r.success).length;
    alert(`Upload complete: ${successCount}/${files.length} photos uploaded successfully`);
    
    // Reload data
    loadData();
  };

  // Handle linking to vehicle
  const handleLinkToVehicle = async (vehicleId: string) => {
    if (selectedImages.length === 0) {
      alert('Please select photos to organize');
      return;
    }

    try {
      const count = await PersonalPhotoLibraryService.bulkLinkToVehicle(selectedImages, vehicleId);
      alert(`Successfully linked ${count} photos to vehicle`);
      clearSelection();
      loadData();
    } catch (error) {
      console.error('Error linking photos:', error);
      alert('Failed to link photos to vehicle');
    }
  };

  // Handle accepting AI suggestion
  const handleAcceptSuggestion = async (suggestion: VehicleSuggestion) => {
    try {
      const vehicleId = await PersonalPhotoLibraryService.acceptVehicleSuggestion(
        suggestion.id,
        {
          year: suggestion.suggested_year || 2000,
          make: suggestion.suggested_make || 'Unknown',
          model: suggestion.suggested_model || 'Unknown',
          trim: suggestion.suggested_trim,
          vin: suggestion.suggested_vin
        }
      );
      
      alert(`Vehicle profile created! ${suggestion.image_count} photos organized.`);
      loadData();
      
      // Navigate to new vehicle
      navigate(`/vehicles/${vehicleId}`);
    } catch (error) {
      console.error('Error accepting suggestion:', error);
      alert('Failed to create vehicle profile');
    }
  };

  // Handle rejecting AI suggestion
  const handleRejectSuggestion = async (suggestionId: string) => {
    try {
      await PersonalPhotoLibraryService.rejectVehicleSuggestion(suggestionId);
      loadData();
    } catch (error) {
      console.error('Error rejecting suggestion:', error);
    }
  };

  // Handle marking as organized
  const handleMarkAsOrganized = async () => {
    if (selectedImages.length === 0) return;
    
    try {
      await PersonalPhotoLibraryService.markAsOrganized(selectedImages);
      clearSelection();
      loadData();
    } catch (error) {
      console.error('Error marking as organized:', error);
    }
  };

  // Handle deletion
  const handleDelete = async () => {
    if (selectedImages.length === 0) return;
    
    if (!confirm(`Delete ${selectedImages.length} photos permanently?`)) {
      return;
    }
    
    try {
      await PersonalPhotoLibraryService.deletePhotos(selectedImages);
      clearSelection();
      loadData();
    } catch (error) {
      console.error('Error deleting photos:', error);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading your photo library...</div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#e0e0e0'
    }}>
      {/* Header */}
      <div style={{
        borderBottom: '2px solid #222',
        padding: '20px 40px',
        background: '#0f0f0f'
      }}>
        <h1 style={{ 
          fontSize: '28px', 
          fontWeight: '600', 
          margin: '0 0 10px 0',
          color: '#fff'
        }}>
          Photo Library
        </h1>
        <p style={{ 
          margin: 0, 
          color: '#888',
          fontSize: '14px'
        }}>
          Upload, organize, and manage your vehicle photos
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '20px'
        }}>
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div className="text font-bold" style={{ fontSize: '32px', marginBottom: '4px' }}>
                {stats.unorganized_photos.toLocaleString()}
              </div>
              <div className="text text-small text-muted">To Organize</div>
            </div>
          </div>
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div className="text font-bold" style={{ fontSize: '32px', marginBottom: '4px', color: 'var(--primary)' }}>
                {stats.organized_photos.toLocaleString()}
              </div>
              <div className="text text-small text-muted">Organized</div>
            </div>
          </div>
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div className="text font-bold" style={{ fontSize: '32px', marginBottom: '4px', color: '#ff9d00' }}>
                {stats.ai_suggestions_count}
              </div>
              <div className="text text-small text-muted">AI Suggestions</div>
            </div>
          </div>
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center' }}>
              <div className="text font-bold" style={{ fontSize: '32px', marginBottom: '4px' }}>
                {formatFileSize(stats.total_file_size)}
              </div>
              <div className="text text-small text-muted">Storage Used</div>
            </div>
          </div>
        </div>
      )}

      {/* View Mode Tabs */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-body" style={{ padding: '12px' }}>
          <div style={{ display: 'flex', gap: '0', alignItems: 'center' }}>
            <button
              onClick={() => setViewMode('unorganized')}
              className={`button ${viewMode === 'unorganized' ? 'button-primary' : 'button-secondary'}`}
              style={{ 
                borderRadius: '4px 0 0 4px',
                fontSize: '11px',
                padding: '8px 16px'
              }}
            >
              Unorganized ({stats?.unorganized_photos || 0})
            </button>
            <button
              onClick={() => setViewMode('suggestions')}
              className={`button ${viewMode === 'suggestions' ? 'button-primary' : 'button-secondary'}`}
              style={{ 
                borderRadius: '0',
                marginLeft: '-2px',
                fontSize: '11px',
                padding: '8px 16px'
              }}
            >
              AI Suggestions ({stats?.ai_suggestions_count || 0})
            </button>
            <button
              onClick={() => setViewMode('organized')}
              className={`button ${viewMode === 'organized' ? 'button-primary' : 'button-secondary'}`}
              style={{ 
                borderRadius: '0 4px 4px 0',
                marginLeft: '-2px',
                fontSize: '11px',
                padding: '8px 16px'
              }}
            >
              Organized ({stats?.organized_photos || 0})
            </button>

            {/* Grid Density Controls */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0', alignItems: 'center' }}>
              <span className="text text-small text-muted" style={{ marginRight: '12px' }}>Grid:</span>
              {(['small', 'medium', 'large'] as GridDensity[]).map((density, idx) => (
                <button
                  key={density}
                  onClick={() => setGridDensity(density)}
                  className={`button ${gridDensity === density ? '' : 'button-secondary'}`}
                  style={{
                    borderRadius: idx === 0 ? '4px 0 0 4px' : idx === 2 ? '0 4px 4px 0' : '0',
                    marginLeft: idx > 0 ? '-2px' : '0',
                    fontSize: '11px',
                    padding: '8px 12px',
                    textTransform: 'capitalize',
                    minWidth: '60px'
                  }}
                >
                  {density}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Upload Zone (only show in unorganized view) */}
      {viewMode === 'unorganized' && stats && stats.unorganized_photos === 0 && !uploading && (
        <BulkUploadZone onUpload={handleBulkUpload} />
      )}

      {/* Upload Progress */}
      {uploading && (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            <div className="text font-bold" style={{ fontSize: '16px', marginBottom: '20px' }}>
              Uploading Photos...
            </div>
            <div className="text font-bold" style={{ fontSize: '36px', color: 'var(--primary)', marginBottom: '16px' }}>
              {uploadProgress.current} / {uploadProgress.total}
            </div>
            <div style={{
              width: '100%',
              height: '24px',
              background: 'var(--grey-200)',
              border: '2px inset var(--border-medium)',
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{
                width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                height: '100%',
                background: 'var(--primary)',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Organize Toolbar (when photos selected) */}
      {selectedImages.length > 0 && viewMode === 'unorganized' && (
        <PhotoOrganizeToolbar
          selectedCount={selectedImages.length}
          onLinkToVehicle={handleLinkToVehicle}
          onMarkAsOrganized={handleMarkAsOrganized}
          onDelete={handleDelete}
          onCancel={clearSelection}
        />
      )}

      {/* Main Content */}
      {viewMode === 'suggestions' ? (
        <VehicleSuggestionsPanel
          suggestions={suggestions}
          onAccept={handleAcceptSuggestion}
          onReject={handleRejectSuggestion}
        />
      ) : (
        <PhotoInboxGrid
          photos={photos}
          gridDensity={gridDensity}
          selectedImages={selectedImages}
          onToggleImage={toggleImage}
          onSelectAll={selectAll}
          isSelected={isSelected}
          showSelectionMode={viewMode === 'unorganized'}
        />
      )}
    </div>
  );
};

