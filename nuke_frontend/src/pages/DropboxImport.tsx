import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DropboxService } from '../services/dropboxService';
import type { VehicleImportPipeline } from '../services/vehicleImportPipeline';
import AppLayout from '../components/layout/AppLayout';
import '../design-system.css';

interface VehicleFolder {
  name: string;
  path: string;
  folderPath: string;
  images: Array<{
    name: string;
    downloadUrl: string;
    metadata?: any;
  }>;
}

const DropboxImport: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [vehicleFolders, setVehicleFolders] = useState<VehicleFolder[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showAccountPrompt, setShowAccountPrompt] = useState(false);
  const [showFolderSelection, setShowFolderSelection] = useState(false);
  const [availableFolders, setAvailableFolders] = useState<any[]>([]);
  const [selectedInventoryFolder, setSelectedInventoryFolder] = useState<string | null>(null);
  const navigate = useNavigate();

  const dropboxClientId = import.meta.env.VITE_DROPBOX_CLIENT_ID;

  useEffect(() => {
    // Check if we have an access token from OAuth redirect (hash fragment for token flow)
    const hash = window.location.hash;
    const urlParams = new URLSearchParams(hash.substring(1));
    const accessToken = urlParams.get('access_token');
    
    if (accessToken) {
      localStorage.setItem('dropbox_access_token', accessToken);
      setIsConnected(true);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else {
      // Check if we already have a stored token
      const storedToken = localStorage.getItem('dropbox_access_token');
      if (storedToken) {
        setIsConnected(true);
      }
    }
  }, []);

  const handleDropboxConnect = () => {
    setShowAccountPrompt(true);
  };

  const connectWithCurrentAccount = () => {
    setShowAccountPrompt(false);
    proceedWithDropboxAuth();
  };

  const switchToBusinessAccount = () => {
    setShowAccountPrompt(false);
    // Open Dropbox in new tab to switch accounts
    window.open('https://www.dropbox.com/logout', '_blank');
    setTimeout(() => {
      window.open('https://www.dropbox.com/login', '_blank');
      // Give user time to switch accounts
      setTimeout(() => {
        proceedWithDropboxAuth();
      }, 3000);
    }, 1000);
  };

  const proceedWithDropboxAuth = () => {
    if (!dropboxClientId) {
      setError('Dropbox Client ID not configured. Please add VITE_DROPBOX_CLIENT_ID to your .env file.');
      return;
    }

    const dropboxService = DropboxService.getInstance({ clientId: dropboxClientId });
    const authUrl = dropboxService.generateAuthUrl();
    
    window.location.href = authUrl;
  };

  const showFolderSelector = async () => {
    setLoading(true);
    setError(null);

    try {
      const accessToken = localStorage.getItem('dropbox_access_token');
      if (!accessToken) {
        throw new Error('No access token found');
      }

      const dropboxService = DropboxService.getInstance({ 
        clientId: dropboxClientId,
        accessToken 
      });

      // Get all folders in root directory
      const rootFolders = await dropboxService.listFolders('');
      setAvailableFolders(rootFolders);
      setShowFolderSelection(true);
    } catch (error) {
      console.error('Error loading folders:', error);
      setError(error instanceof Error ? error.message : 'Failed to load Dropbox folders');
    } finally {
      setLoading(false);
    }
  };

  const scanSelectedFolder = async () => {
    if (!selectedInventoryFolder) {
      setError('Please select a folder first');
      return;
    }

    setLoading(true);
    setError(null);
    setShowFolderSelection(false);

    try {
      const accessToken = localStorage.getItem('dropbox_access_token');
      if (!accessToken) {
        throw new Error('No access token found');
      }

      const dropboxService = DropboxService.getInstance({ 
        clientId: dropboxClientId,
        accessToken 
      });

      // Use the new pipeline for intelligent scanning
      const pipeline = new VehicleImportPipeline(dropboxService);
      const folders = await pipeline.scanVehicleFolders(selectedInventoryFolder);
      
      // Transform to match existing interface
      const transformedVehicles = folders.map(folder => ({
        name: folder.folderName,
        path: folder.folderPath,
        folderPath: folder.folderPath,
        images: folder.images.map(img => ({
          name: img.name,
          downloadUrl: img.downloadUrl,
          metadata: { size: img.size, type: img.type }
        }))
      }));

      setVehicleFolders(transformedVehicles);
    } catch (error) {
      console.error('Error scanning vehicle inventory:', error);
      setError(error instanceof Error ? error.message : 'Failed to scan vehicle inventory');
    } finally {
      setLoading(false);
    }
  };

  const toggleFolderSelection = (folderPath: string) => {
    const newSelected = new Set(selectedFolders);
    if (newSelected.has(folderPath)) {
      newSelected.delete(folderPath);
    } else {
      newSelected.add(folderPath);
    }
    setSelectedFolders(newSelected);
  };

  const selectAllFolders = () => {
    setSelectedFolders(new Set(vehicleFolders.map(f => f.folderPath)));
  };

  const clearSelection = () => {
    setSelectedFolders(new Set());
  };

  const processSelected = () => {
    const selectedVehicles = vehicleFolders.filter(folder => 
      selectedFolders.has(folder.folderPath)
    );
    
    if (selectedVehicles.length === 0) {
      setError('Please select at least one vehicle folder to process');
      return;
    }
    
    // Store selected vehicles for AI processing
    localStorage.setItem('dropbox_selected_vehicles', JSON.stringify(selectedVehicles));
    
    // Navigate to AI processing page
    navigate('/dropbox-ai-process');
  };

  const disconnect = () => {
    localStorage.removeItem('dropbox_access_token');
    setIsConnected(false);
    setVehicleFolders([]);
    setSelectedFolders(new Set());
  };

  return (
    <AppLayout
      title="Import from Dropbox"
      showBackButton={true}
      breadcrumbs={[
        { label: "Dashboard", path: "/dashboard" },
        { label: "Import from Dropbox" }
      ]}
    >
      <div className="fade-in">
        {!isConnected ? (
          <section className="section">
            <div className="card">
              <div className="card-header">Connect to Dropbox</div>
              <div className="card-body text-center" style={{ padding: '48px 24px' }}>
                <h2 className="text font-bold" style={{ marginBottom: '12px' }}>
                  Import Your Vehicle Inventory
                </h2>
                <p className="text-small text-muted" style={{ marginBottom: '24px' }}>
                  Connect to your Dropbox account to import vehicles from your "Yucca Car Inventory" folder.
                  Each folder will be processed as a separate vehicle with AI analysis of the images.
                </p>
                {error && (
                  <div className="alert alert-error" style={{ marginBottom: '24px' }}>
                    {error}
                  </div>
                )}
                <button 
                  className="button button-primary"
                  onClick={handleDropboxConnect}
                >
                  Connect to Dropbox
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* Connection Status */}
            <section className="section">
              <div className="card">
                <div className="card-header">Dropbox Connected</div>
                <div className="card-body">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text">Successfully connected to your Dropbox account.</p>
                      <p className="text-small text-muted">Ready to scan your vehicle inventory.</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        className="button button-primary"
                        onClick={showFolderSelector}
                        disabled={loading}
                      >
                        {loading ? 'Loading...' : 'Select Vehicle Folder'}
                      </button>
                      <button 
                        className="button button-secondary"
                        onClick={disconnect}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Error Display */}
            {error && (
              <section className="section">
                <div className="alert alert-error">
                  {error}
                </div>
              </section>
            )}

            {/* Vehicle Folders */}
            {vehicleFolders.length > 0 && (
              <>
                <section className="section">
                  <div className="card">
                    <div className="card-header">
                      <div className="flex items-center justify-between">
                        <span>Found {vehicleFolders.length} Vehicle Folders</span>
                        <div className="flex gap-2">
                          <button 
                            className="button button-small button-secondary"
                            onClick={selectAllFolders}
                          >
                            Select All
                          </button>
                          <button 
                            className="button button-small button-secondary"
                            onClick={clearSelection}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="card-body">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {vehicleFolders.map((folder) => (
                          <div 
                            key={folder.folderPath}
                            className={`card cursor-pointer ${
                              selectedFolders.has(folder.folderPath) ? 'border-primary' : ''
                            }`}
                            onClick={() => toggleFolderSelection(folder.folderPath)}
                          >
                            <div className="card-body">
                              <div className="flex items-center justify-between mb-2">
                                <h3 className="text font-bold">{folder.name}</h3>
                                <input 
                                  type="checkbox"
                                  checked={selectedFolders.has(folder.folderPath)}
                                  onChange={() => toggleFolderSelection(folder.folderPath)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <p className="text-small text-muted mb-2">
                                {folder.images.length} images found
                              </p>
                              
                              {/* Image Preview */}
                              {folder.images.length > 0 && (
                                <div className="grid grid-cols-3 gap-1">
                                  {folder.images.slice(0, 3).map((image, idx) => (
                                    <div 
                                      key={idx}
                                      className="aspect-square bg-gray-200 rounded overflow-hidden"
                                    >
                                      <img 
                                        src={image.downloadUrl}
                                        alt={image.name}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
                                    </div>
                                  ))}
                                  {folder.images.length > 3 && (
                                    <div className="aspect-square bg-gray-100 rounded flex items-center justify-center">
                                      <span className="text-small text-muted">
                                        +{folder.images.length - 3}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Process Button */}
                {selectedFolders.size > 0 && (
                  <section className="section">
                    <div className="card">
                      <div className="card-body text-center">
                        <p className="text mb-4">
                          {selectedFolders.size} vehicle{selectedFolders.size !== 1 ? 's' : ''} selected for AI processing
                        </p>
                        <button 
                          className="button button-primary"
                          onClick={processSelected}
                        >
                          Process Selected Vehicles with AI
                        </button>
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}

        {/* Account Selection Prompt Modal */}
        {showAccountPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="card" style={{ maxWidth: '500px', margin: '20px' }}>
              <div className="card-header">
                <h3 className="text font-bold">Select Dropbox Account</h3>
              </div>
              <div className="card-body">
                <p className="text mb-4">
                  Which Dropbox account contains your vehicle inventory folder?
                </p>
                
                <div className="space-y-3 mb-6">
                  <div className="border rounded p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text font-medium">Business Account</div>
                        <div className="text-small text-muted">skylar@nukemannerheim.com</div>
                        <div className="text-small text-green-600">✓ Recommended for vehicle inventory</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="border rounded p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text font-medium">Current Account</div>
                        <div className="text-small text-muted">Continue with currently logged in account</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    className="button button-primary flex-1"
                    onClick={switchToBusinessAccount}
                  >
                    Switch to Business Account
                  </button>
                  <button 
                    className="button button-secondary flex-1"
                    onClick={connectWithCurrentAccount}
                  >
                    Use Current Account
                  </button>
                </div>
                
                <div className="mt-4 text-center">
                  <button 
                    className="button button-ghost"
                    onClick={() => setShowAccountPrompt(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Folder Selection Modal */}
        {showFolderSelection && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="card" style={{ maxWidth: '600px', margin: '20px' }}>
              <div className="card-header">
                <h3 className="text font-bold">Select Vehicle Inventory Folder</h3>
              </div>
              <div className="card-body">
                <p className="text mb-4">
                  Choose which folder contains your vehicle inventory:
                </p>
                
                <div className="space-y-2 mb-6" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {availableFolders.map((folder) => (
                    <label key={folder.path} className="flex items-center gap-3 p-3 border rounded cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="inventoryFolder"
                        value={folder.path}
                        checked={selectedInventoryFolder === folder.path}
                        onChange={(e) => setSelectedInventoryFolder(e.target.value)}
                      />
                      <div>
                        <div className="text font-medium">{folder.name}</div>
                        <div className="text-small text-muted">{folder.path}</div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button 
                    className="button button-primary flex-1"
                    onClick={scanSelectedFolder}
                    disabled={!selectedInventoryFolder}
                  >
                    Scan This Folder
                  </button>
                  <button 
                    className="button button-secondary"
                    onClick={() => setShowFolderSelection(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default DropboxImport;
