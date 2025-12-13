/**
 * Dealer Dropbox Import - Bulk import for Viva! Las Vegas Autos
 * Scans "Yucca Car Inventory" folder and creates vehicle profiles + dealer inventory
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DropboxService } from '../services/dropboxService';
import { supabase } from '../lib/supabase';
import exifr from 'exifr';

const DealerDropboxImport: React.FC = () => {
  const { orgId } = useParams();
  const [isConnected, setIsConnected] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [vehicleFolders, setVehicleFolders] = useState<any[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [importProgress, setImportProgress] = useState({ total: 0, completed: 0, created: 0 });
  const [autoSyncInProgress, setAutoSyncInProgress] = useState(false);
  const navigate = useNavigate();

  const dropboxClientId = import.meta.env.VITE_DROPBOX_CLIENT_ID;
  const INVENTORY_PATH = '/Yucca Car Inventory';

  useEffect(() => {
    const storedToken = localStorage.getItem('dropbox_access_token');
    if (storedToken) {
      setIsConnected(true);
      scanInventory();
    }
  }, []);

  const connectDropbox = () => {
    if (!dropboxClientId) {
      alert('Dropbox not configured. Add VITE_DROPBOX_CLIENT_ID to .env');
      return;
    }

    const dropboxService = DropboxService.getInstance({ clientId: dropboxClientId });
    const authUrl = dropboxService.generateAuthUrl();
    window.location.href = authUrl;
  };

  const disconnectDropbox = () => {
    localStorage.removeItem('dropbox_access_token');
    localStorage.removeItem('dropbox_oauth_state');
    setIsConnected(false);
    setNeedsReconnect(false);
    setVehicleFolders([]);
    setSelectedFolders(new Set());
  };

  const scanInventory = async () => {
    setScanning(true);
    setVehicleFolders([]);

    try {
      const accessToken = localStorage.getItem('dropbox_access_token');
      if (!accessToken) throw new Error('No Dropbox token');

      const dropboxService = DropboxService.getInstance({ 
        clientId: dropboxClientId,
        accessToken 
      });

      console.log(`📁 Scanning ${INVENTORY_PATH}...`);

      // First, try to list root folders to help debug
      try {
        const rootFolders = await dropboxService.listFolders('');
        console.log('📂 Root folders found:', rootFolders.map(f => f.name));
      } catch (rootError) {
        console.warn('Could not list root folders:', rootError);
      }

      // Scan for vehicle folders
      const folders = await dropboxService.scanVehicleInventory(INVENTORY_PATH);
      
      console.log(`✅ Found ${folders.length} vehicle folders`);
      setVehicleFolders(folders);

      // Auto-sync: Check which vehicles need images and trigger import
      autoSyncMissingImages(folders);

    } catch (error: any) {
      console.error('Scan error:', error);
      
      // Check if it's a missing scope error
      const errorMessage = error.message || '';
      const errorSummary = error.error?.error_summary || '';
      
      if (errorMessage.includes('missing_scope') || errorSummary.includes('missing_scope') || error.status === 401) {
        setNeedsReconnect(true);
        alert(`Dropbox token is missing required permissions.\n\nPlease reconnect to grant file access permissions.`);
      } else {
        alert(`Scan failed: ${error.message}\n\nTip: Check the browser console for a list of your Dropbox folders.`);
      }
    } finally {
      setScanning(false);
    }
  };

  const autoSyncMissingImages = async (folders: any[]) => {
    if (!orgId || folders.length === 0) return;

    setAutoSyncInProgress(true);
    console.log(`Auto-sync: Checking ${folders.length} vehicles for missing images...`);

    try {
      // Get user with retry on network errors
      let user = null;
      try {
        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        user = authUser;
      } catch (authErr: any) {
        console.error('Auth error during auto-sync:', authErr);
        console.log('⏭ Skipping auto-sync - authentication failed. Please try manually.');
        setAutoSyncInProgress(false);
        return;
      }
      
      if (!user) {
        console.log('⏭ No user found, skipping auto-sync');
        setAutoSyncInProgress(false);
        return;
      }

      // Get all vehicles linked to this org
      const { data: orgVehicles } = await supabase
        .from('organization_vehicles')
        .select(`
          vehicle_id,
          vehicles:vehicle_id (
            id,
            vin,
            year,
            make,
            model
          )
        `)
        .eq('organization_id', orgId)
        .eq('status', 'active');

      if (!orgVehicles || orgVehicles.length === 0) {
        console.log(`⏭ No linked vehicles found, skipping auto-sync`);
        setAutoSyncInProgress(false);
        return;
      }

      // Check which vehicles have 0 images
      const vehiclesNeedingImages: any[] = [];
      for (const ov of orgVehicles) {
        const vehicle = ov.vehicles;
        if (!vehicle) continue;

        const { count } = await supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id);

        if (count === 0) {
          vehiclesNeedingImages.push(vehicle);
        }
      }

      if (vehiclesNeedingImages.length === 0) {
        console.log(`✅ All vehicles have images, no sync needed`);
        setAutoSyncInProgress(false);
        return;
      }

      console.log(`📸 Auto-sync: ${vehiclesNeedingImages.length} vehicles need images`);

      // Match folders to vehicles and auto-select them
      const foldersToSync = new Set<string>();
      for (const vehicle of vehiclesNeedingImages) {
        const vehicleString = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.toLowerCase();
        
        // Find matching folder
        const matchingFolder = folders.find(f => {
          const folderName = f.name.toLowerCase();
          return folderName.includes(vehicle.year?.toString() || '') &&
                 folderName.includes(vehicle.make?.toLowerCase() || '') &&
                 folderName.includes(vehicle.model?.toLowerCase() || '');
        });

        if (matchingFolder) {
          foldersToSync.add(matchingFolder.name);
          console.log(`  ✓ Matched: ${matchingFolder.name} → ${vehicleString}`);
        }
      }

      if (foldersToSync.size > 0) {
        console.log(`🚀 Auto-starting import for ${foldersToSync.size} vehicles...`);
        setSelectedFolders(foldersToSync);
        
        // Trigger import automatically after a brief delay
        setTimeout(() => {
          startImport(foldersToSync);
        }, 1000);
      } else {
        console.log(`⚠️ Could not match Dropbox folders to vehicles needing images`);
        setAutoSyncInProgress(false);
      }

    } catch (error: any) {
      console.error('Auto-sync error:', error);
      setAutoSyncInProgress(false);
    }
  };

  const toggleFolderSelection = (folderPath: string) => {
    const newSelection = new Set(selectedFolders);
    if (newSelection.has(folderPath)) {
      newSelection.delete(folderPath);
    } else {
      newSelection.add(folderPath);
    }
    setSelectedFolders(newSelection);
  };

  const selectAll = () => {
    setSelectedFolders(new Set(vehicleFolders.map(f => f.path)));
  };

  const deselectAll = () => {
    setSelectedFolders(new Set());
  };

  const startImport = async (foldersToImport?: Set<string>) => {
    const folders = foldersToImport || selectedFolders;
    
    if (folders.size === 0) {
      alert('Please select at least one vehicle folder');
      return;
    }

    // Skip confirmation for auto-sync
    if (!foldersToImport && !confirm(`Import ${folders.size} vehicles? This will create profiles and upload all images.`)) {
      return;
    }

    setImporting(true);
    setImportProgress({ total: folders.size, completed: 0, created: 0 });

    const accessToken = localStorage.getItem('dropbox_access_token');
    const dropboxService = DropboxService.getInstance({ 
      clientId: dropboxClientId,
      accessToken: accessToken! 
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Please log in');
      return;
    }

    let completed = 0;
    let created = 0;

    for (const folderPath of Array.from(folders)) {
      try {
        const folder = vehicleFolders.find(f => f.path === folderPath || f.name === folderPath);
        if (!folder) continue;

        console.log(`\n🚗 Importing: ${folder.name}`);

        // Parse folder name for vehicle info
        const vehicleInfo = parseFolderName(folder.name);
        
        // Use Dropbox service extracted VIN if found
        if (folder.extractedVIN && !vehicleInfo.vin) {
          vehicleInfo.vin = folder.extractedVIN;
          console.log(`  🔑 VIN extracted from folder name: ${folder.extractedVIN}`);
        }
        
        // Log document count if any
        if (folder.documents && folder.documents.length > 0) {
          console.log(`  📄 Found ${folder.documents.length} documents`);
        }
        
        if (!vehicleInfo.year || !vehicleInfo.make || !vehicleInfo.model) {
          console.log(`  ⏭ Skipping - couldn't parse: ${folder.name}`);
          completed++;
          continue;
        }

        // Check if vehicle exists by VIN OR year/make/model
        let vehicleId = null;
        let isNewVehicle = false;
        
        // First: Check by VIN (canonical identifier)
        if (vehicleInfo.vin && vehicleInfo.vin.length === 17) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id, uploaded_by, make, model, year')
            .eq('vin', vehicleInfo.vin)
            .single();
          
          if (existing) {
            vehicleId = existing.id;
            console.log(`  🔗 VIN match found - merging with existing profile`);
            console.log(`     Original uploader: ${existing.uploaded_by}`);
          }
        }
        
        // Second: Check by year/make/model if no VIN or no VIN match
        if (!vehicleId) {
          const { data: ymMatch } = await supabase
            .from('vehicles')
            .select('id, uploaded_by, vin')
            .eq('year', vehicleInfo.year)
            .eq('make', vehicleInfo.make)
            .eq('model', vehicleInfo.model)
            .limit(1)
            .maybeSingle();
          
          if (ymMatch) {
            vehicleId = ymMatch.id;
            console.log(`  🔗 Year/Make/Model match found - merging with existing profile`);
            console.log(`     Existing VIN: ${ymMatch.vin || 'none'}`);
            
            // Update VIN if we have one and existing doesn't
            if (vehicleInfo.vin && !ymMatch.vin) {
              await supabase
                .from('vehicles')
                .update({ vin: vehicleInfo.vin })
                .eq('id', vehicleId);
              console.log(`     ✓ Updated VIN: ${vehicleInfo.vin}`);
            }
          }
        }

        // Create vehicle only if no match found
        if (!vehicleId) {
          const { data: newVehicle, error } = await supabase
            .from('vehicles')
            .insert({
              vin: vehicleInfo.vin || null, // Allow null VIN for vehicles without one
              year: vehicleInfo.year,
              make: vehicleInfo.make,
              model: vehicleInfo.model,
              trim: vehicleInfo.trim,
              uploaded_by: user.id,
              discovery_source: 'dropbox_bulk_import',
              is_public: true
            })
            .select('id')
            .single();

          if (error) throw error;
          
          vehicleId = newVehicle!.id;
          isNewVehicle = true;
          created++;
          console.log(`  ✅ Created new vehicle profile`);
        }

        // Upload images
        let uploadedCount = 0;
        for (const img of folder.images) {
          try {
            // Get temporary download URL from Dropbox
            const downloadUrl = await dropboxService.getImageDownloadUrl(img.path);
            
            // Download from Dropbox
            const imgResponse = await fetch(downloadUrl);
            if (!imgResponse.ok) {
              throw new Error(`Dropbox download failed: ${imgResponse.status}`);
            }
            
            const imgBlob = await imgResponse.blob();
            console.log(`    📥 Downloaded ${img.name} (${(imgBlob.size / 1024).toFixed(1)}KB)`);

            // Extract EXIF data
            let exifData: any = {
              dropbox_path: img.path,
              dropbox_filename: img.name,
              original_size: img.size
            };

            try {
              const exif = await exifr.parse(imgBlob, {
                xmp: true,
                ifd0: true,
                ifd1: true,
                exif: true,
                gps: true,
                interop: true,
              });

              if (exif) {
                exifData = {
                  ...exifData,
                  ...exif,
                  // Ensure dates are in ISO format
                  DateTimeOriginal: exif.DateTimeOriginal?.toISOString?.() || exif.DateTimeOriginal,
                  CreateDate: exif.CreateDate?.toISOString?.() || exif.CreateDate,
                  ModifyDate: exif.ModifyDate?.toISOString?.() || exif.ModifyDate,
                };
                console.log(`    📅 EXIF date: ${exif.DateTimeOriginal || exif.CreateDate || 'none'}`);
              }
            } catch (exifError) {
              console.warn(`    ⚠️ Could not extract EXIF from ${img.name}`);
            }

            // Upload to Supabase
            const fileExt = img.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${fileExt}`;
            const storagePath = `vehicles/${vehicleId}/dropbox/${fileName}`;

            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('vehicle-data')
              .upload(storagePath, imgBlob);

            if (uploadError) {
              throw uploadError;
            }

            const publicUrl = supabase.storage
              .from('vehicle-data')
              .getPublicUrl(storagePath).data.publicUrl;

            // Determine taken_at date from EXIF
            const takenAt = exifData.DateTimeOriginal || exifData.CreateDate || exifData.ModifyDate || new Date().toISOString();

            const { data: imageData, error: insertError } = await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicleId,
                user_id: user.id,
                image_url: publicUrl,
                category: 'general',
                source: 'dropbox_import',
                taken_at: takenAt,
                exif_data: exifData
              })
              .select('id')
              .single();

            if (insertError) {
              throw insertError;
            }

            // Create vehicle timeline event with the correct date from EXIF
            const { error: timelineError } = await supabase
              .from('timeline_events')
              .insert({
                vehicle_id: vehicleId,
                user_id: user.id,
                event_type: 'image_upload',
                source: 'dropbox_import',
                title: 'Photo added',
                event_date: takenAt,
                image_urls: [publicUrl],
                metadata: {
                  image_id: imageData.id,
                  filename: img.name
                }
              });

            if (timelineError) {
              console.warn(`    ⚠️ Vehicle timeline event error:`, timelineError.message);
            }

            // Also create organization timeline event
            if (orgId) {
              const { error: orgTimelineError } = await supabase
                .from('business_timeline_events')
                .insert({
                  business_id: orgId,
                  created_by: user.id,
                  event_type: 'other',
                  event_category: 'operational',
                  title: `Inventory photo: ${folder.year} ${folder.make} ${folder.model}`,
                  event_date: takenAt,
                  image_urls: [publicUrl],
                  metadata: {
                    image_id: imageData.id,
                    vehicle_id: vehicleId,
                    filename: img.name,
                    source: 'dropbox_import'
                  }
                });

              if (orgTimelineError) {
                console.warn(`    ⚠️ Org timeline event error:`, orgTimelineError.message);
              }
            }

            uploadedCount++;
            console.log(`    ✅ Uploaded ${uploadedCount}/${folder.images.length}`);
          } catch (imgError: any) {
            console.error(`    ❌ Error with ${img.name}:`, imgError.message || imgError);
          }
        }

        console.log(`  📸 Uploaded ${uploadedCount}/${folder.images.length} images`);

        // Link to Viva (dealer inventory) - only if not already linked
        if (orgId) {
          // Check if already linked
          const { data: existing } = await supabase
            .from('organization_vehicles')
            .select('id')
            .eq('organization_id', orgId)
            .eq('vehicle_id', vehicleId)
            .maybeSingle();

          if (!existing) {
            const { error: linkError } = await supabase
              .from('organization_vehicles')
              .insert({
                organization_id: orgId,
                vehicle_id: vehicleId,
                relationship_type: 'owner', // Dealer owns inventory
                status: 'active',
                notes: `Dealer inventory - imported from Dropbox: ${folder.name}`,
                linked_by_user_id: user.id,
                auto_tagged: false
              });

            if (linkError) {
              console.warn(`  ⚠️ Could not link to dealer:`, linkError.message);
            } else {
              console.log(`  🔗 Linked to dealer inventory`);
            }
          } else {
            console.log(`  ✓ Already linked to dealer`);
          }
        }

        // Add contributor record (for merged vehicles)
        if (!isNewVehicle) {
          await supabase
            .from('vehicle_contributors')
            .upsert({
              vehicle_id: vehicleId,
              user_id: user.id,
              role: 'photographer',
              status: 'active',
              notes: `Contributed ${uploadedCount} images via Dropbox bulk import`
            }, {
              // Matches DB constraint: UNIQUE(vehicle_id, user_id, role)
              onConflict: 'vehicle_id,user_id,role',
              ignoreDuplicates: false
            });

          console.log(`  👤 Added as contributor to existing profile`);
        }

        completed++;
        setImportProgress({ total: selectedFolders.size, completed, created });

      } catch (error: any) {
        console.error(`Error importing ${folderPath}:`, error.message);
      }
    }

    setImporting(false);
    setAutoSyncInProgress(false);
    
    if (foldersToImport) {
      // Auto-sync completed silently
      console.log(`✅ Auto-sync complete! Uploaded images for ${completed} vehicles`);
    } else {
      // Manual import - show alert
      alert(`Import complete!\n\nProcessed: ${completed}\nCreated: ${created} new vehicles\n\nRefresh to see results.`);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => navigate(`/org/${orgId}`)}
          className="button button-secondary"
          style={{ fontSize: '9pt', marginBottom: '12px' }}
        >
          ← Back to Organization
        </button>
        <h1 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>
          Dealer Inventory Import
        </h1>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 style={{ fontSize: '14pt', fontWeight: 700, margin: 0 }}>
            Dropbox Bulk Import - Yucca Car Inventory
          </h2>
        </div>
        <div className="card-body">
          {!isConnected ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <div style={{ fontSize: '10pt', marginBottom: '20px', color: 'var(--text-secondary)' }}>
                  Connect Dropbox to import vehicles from "Yucca Car Inventory"
                </div>
                <button onClick={connectDropbox} className="button button-primary">
                  Connect Dropbox
                </button>
              </div>
          ) : (
            <div>
                <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {needsReconnect ? (
                    <>
                      <div style={{ fontSize: '9pt', color: 'var(--error)', fontWeight: 700 }}>
                        Missing Permissions - Reconnect Required
                      </div>
                      <button
                        onClick={disconnectDropbox}
                        className="button button-secondary button-small"
                        style={{ fontSize: '8pt' }}
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={connectDropbox}
                        className="button button-primary button-small"
                        style={{ fontSize: '8pt' }}
                      >
                        Reconnect Dropbox
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '9pt', color: 'var(--success)' }}>
                        Dropbox connected
                      </div>
                      <button
                        onClick={disconnectDropbox}
                        className="button button-secondary button-small"
                        style={{ fontSize: '8pt' }}
                      >
                        Disconnect
                      </button>
                      <button
                        onClick={scanInventory}
                        disabled={scanning}
                        className="button button-secondary button-small"
                        style={{ fontSize: '8pt' }}
                      >
                        {scanning ? 'Scanning...' : 'Rescan Inventory'}
                      </button>
                      <button
                        onClick={() => {
                          if (vehicleFolders.length > 0) {
                            autoSyncMissingImages(vehicleFolders);
                          } else {
                            alert('Scan inventory first');
                          }
                        }}
                        disabled={autoSyncInProgress || importing}
                        className="button button-primary button-small"
                        style={{ fontSize: '8pt' }}
                      >
                        {autoSyncInProgress ? 'Syncing...' : 'Sync Images'}
                      </button>
                    </>
                  )}
                </div>

                {autoSyncInProgress && !importing && (
                  <div style={{
                    padding: '12px',
                    background: '#fff3cd',
                    border: '1px solid #ffc107',
                    borderRadius: '4px',
                    marginBottom: '12px',
                    fontSize: '9pt'
                  }}>
                    Auto-syncing missing images for existing vehicles...
                  </div>
                )}

                {importing && (
                  <div style={{
                    padding: '16px',
                    background: '#d1ecf1',
                    border: '1px solid #bee5eb',
                    borderRadius: '4px',
                    marginBottom: '20px'
                  }}>
                    <div style={{ fontSize: '10pt', fontWeight: 700, marginBottom: '8px' }}>
                      Importing...
                    </div>
                    <div style={{ fontSize: '9pt' }}>
                      {importProgress.completed} / {importProgress.total} folders processed
                    </div>
                    <div style={{ fontSize: '9pt' }}>
                      {importProgress.created} new vehicles created
                    </div>
                  </div>
                )}

                {vehicleFolders.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ fontSize: '10pt', fontWeight: 700 }}>
                        Found {vehicleFolders.length} vehicles
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={selectAll} className="button button-small" style={{ fontSize: '8pt' }}>
                          Select All
                        </button>
                        <button onClick={deselectAll} className="button button-small" style={{ fontSize: '8pt' }}>
                          Deselect All
                        </button>
                        <button
                          onClick={() => startImport()}
                          disabled={importing || selectedFolders.size === 0}
                          className="button button-primary button-small"
                          style={{ fontSize: '8pt' }}
                        >
                          Import {selectedFolders.size} Selected
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
                      {vehicleFolders.map(folder => (
                        <div
                          key={folder.path}
                          onClick={() => toggleFolderSelection(folder.path)}
                          style={{
                            padding: '12px',
                            border: selectedFolders.has(folder.path) ? '2px solid var(--accent)' : '1px solid var(--border)',
                            borderRadius: '4px',
                            background: selectedFolders.has(folder.path) ? 'var(--accent-dim)' : 'var(--white)',
                            cursor: 'pointer',
                            transition: 'all 0.12s ease'
                          }}
                        >
                          <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
                            {folder.name}
                          </div>
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                            {folder.images.length} images
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {vehicleFolders.length === 0 && !scanning && (
                  <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '9pt' }}>
                    No vehicle folders found. Click "Rescan Inventory" to check Dropbox.
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Parse folder name: "1977 K5 Blazer" or "1974 Bronco - VIN123"
function parseFolderName(name: string): {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vin?: string;
} {
  const result: any = {};

  // Extract VIN (17 chars after dash or #)
  const vinMatch = name.match(/[-#]\s*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) {
    result.vin = vinMatch[1].toUpperCase();
  }

  // Extract year
  const yearMatch = name.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    result.year = parseInt(yearMatch[0]);
  }

  // Remove VIN and year
  let cleaned = name
    .replace(/[-#]\s*[A-HJ-NPR-Z0-9]{17}/gi, '')
    .replace(/\b(19|20)\d{2}\b/, '')
    .replace(/[-_]/g, ' ')
    .trim();

  const parts = cleaned.split(/\s+/).filter(p => p.length > 0);

  if (parts.length >= 2) {
    result.make = parts[0];
    result.model = parts[1];
    if (parts.length > 2) {
      result.trim = parts.slice(2).join(' ');
    }
  }

  return result;
}

export default DealerDropboxImport;

