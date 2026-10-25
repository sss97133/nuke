import { Dropbox } from 'dropbox';
import { DROPBOX_OAUTH_STATE_KEY, validDropboxImportPath } from './dropboxOAuth';

export interface DropboxConfig {
  clientId: string;
  accessToken?: string;
}

export interface VehicleFolder {
  name: string;
  path: string;
  images: DropboxImage[];
  documents: DropboxDocument[];
  extractedVIN?: string;
}

export interface DropboxDocument {
  name: string;
  path: string;
  size: number;
  modified: string;
  type: 'pdf' | 'image';
}

export interface DropboxImage {
  name: string;
  path: string;
  size: number;
  modified: string;
  downloadUrl?: string;
}

export class DropboxService {
  private dbx: Dropbox;
  private clientId: string;
  private static instance: DropboxService;

  constructor(config: DropboxConfig) {
    this.clientId = config.clientId;
    this.dbx = new Dropbox({
      clientId: config.clientId,
      accessToken: config.accessToken,
      fetch: fetch.bind(window)
    });
  }

  /**
   * Extract VIN from text (folder name, filename, etc.)
   * VIN format: 17 alphanumeric characters (no I, O, Q to avoid confusion with 1, 0)
   */
  private extractVIN(text: string): string | null {
    const vinPattern = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
    const matches = text.toUpperCase().match(vinPattern);
    return matches ? matches[0] : null;
  }

  static getInstance(config?: DropboxConfig): DropboxService {
    if (!DropboxService.instance && config) {
      DropboxService.instance = new DropboxService(config);
    } else if (config && DropboxService.instance) {
      // Update existing instance with new config (especially access token)
      DropboxService.instance.dbx = new Dropbox({
        clientId: config.clientId,
        accessToken: config.accessToken,
        fetch: fetch.bind(window)
      });
    }
    return DropboxService.instance;
  }

  // Force refresh instance with new token
  static refreshInstance(config: DropboxConfig): DropboxService {
    DropboxService.instance = new DropboxService(config);
    return DropboxService.instance;
  }

  generateAuthUrl(returnPath: string): string {
    const clientId = import.meta.env.VITE_DROPBOX_CLIENT_ID;
    if (!clientId) {
      throw new Error('Dropbox client ID not configured');
    }
    const importPath = validDropboxImportPath(returnPath);
    if (!importPath) {
      throw new Error('Open Dropbox import from your organization before connecting.');
    }

    const redirectUri = `${window.location.origin}/dropbox-callback`;
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    
    // One atomic record prevents concurrent tabs from pairing a nonce with the
    // other tab's organization. Only the latest pending authorization is valid.
    localStorage.setItem(DROPBOX_OAUTH_STATE_KEY, JSON.stringify({ state, returnPath: importPath }));

    // Force re-approval to ensure fresh token with updated scopes
    const authUrl = `https://www.dropbox.com/oauth2/authorize?` +
      `client_id=${clientId}&` +
      `response_type=token&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=files.metadata.read files.content.read account_info.read&` +
      `state=${state}&` +
      `force_reapproval=true`;
    
    return authUrl;
  }

  /**
   * Set access token after OAuth flow
   */
  setAccessToken(token: string): void {
    this.dbx = new Dropbox({
      clientId: this.clientId,
      accessToken: token,
      fetch: fetch.bind(window)
    });
  }

  /**
   * List folders in a given path
   */
  async listFolders(path: string): Promise<any[]> {
    if (!this.dbx) {
      throw new Error('Dropbox not initialized');
    }

    try {
      // Verify account access without exposing account or token diagnostics.
      try {
        await this.dbx.usersGetCurrentAccount();
      } catch {
        throw new Error('Token does not have account access');
      }
      let dropboxPath = path;
      if (path === '/' || path === '') {
        dropboxPath = '';
      }
      
      const response = await this.dbx.filesListFolder({
        path: dropboxPath,
        recursive: false
      });

      return response.result.entries.filter((entry: any) => 
        entry['.tag'] === 'folder'
      ).map((folder: any) => ({
        name: folder.name,
        path: folder.path_lower,
        createdAt: folder.client_modified,
        modifiedAt: folder.server_modified
      }));
    } catch (error: any) {
      // Check if it's an authentication error
      if (error.status === 401) {
        throw new Error('Dropbox access token is invalid or expired. Please reconnect your account.');
      }
      
      // Check if it's a bad request with more details
      if (error.status === 400) {
        const errorTag = error.error?.error?.['.tag'];
        const errorSummary = error.error?.error_summary || error.message;
        
        if (errorTag === 'path' || errorSummary?.includes('path/not_found')) {
          throw new Error(`Folder not found: "${path}". Please check the folder exists in your Dropbox.`);
        }
        
        throw new Error(`Dropbox API error: ${errorSummary || 'Bad request'}`);
      }
      
      throw new Error(`Failed to list folders: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * List contents of a specific folder
   */
  async listFolderContents(path: string): Promise<any[]> {
    if (!this.dbx) {
      throw new Error('Dropbox not initialized');
    }

    try {
      const response = await this.dbx.filesListFolder({
        path: path,
        recursive: false
      });

      return response.result.entries.map((item: any) => ({
        name: item.name,
        path: item.path_lower,
        size: item.size || 0,
        isFolder: item['.tag'] === 'folder',
        createdAt: item.client_modified,
        modifiedAt: item.server_modified
      }));
    } catch (error) {
      console.error('Error listing folder contents:', error);
      throw new Error(`Failed to list contents of ${path}`);
    }
  }

  /**
   * Get temporary download link for a file
   */
  async getTemporaryLink(path: string): Promise<string> {
    if (!this.dbx) {
      throw new Error('Dropbox not initialized');
    }

    try {
      const response = await this.dbx.filesGetTemporaryLink({
        path: path
      });

      return response.result.link;
    } catch (error) {
      console.error('Error getting temporary link:', error);
      throw new Error(`Failed to get download link for ${path}`);
    }
  }

  /**
   * Scan the Yucca Car Inventory folder for vehicle folders
   */
  async scanVehicleInventory(inventoryPath: string = '/Yucca Car Inventory'): Promise<VehicleFolder[]> {
    try {
      const folders = await this.listFolders(inventoryPath);

      const vehicleFolders: VehicleFolder[] = [];

      for (const folder of folders) {
        // Try to extract VIN from folder name
        const extractedVIN = this.extractVIN(folder.name);

        const vehicleFolder: VehicleFolder = {
          name: folder.name,
          path: folder.path,
          images: [],
          documents: [],
          extractedVIN: extractedVIN || undefined
        };

        // Get images and documents in each vehicle folder
        try {
          const folderContents = await this.dbx.filesListFolder({
            path: vehicleFolder.path,
            recursive: false
          });

          // Filter for image files
          const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.heic', '.heif'];
          const imageFiles = folderContents.result.entries.filter(entry => {
            if (entry['.tag'] !== 'file') return false;
            const ext = entry.name.toLowerCase().substring(entry.name.lastIndexOf('.'));
            return imageExtensions.includes(ext);
          });

          vehicleFolder.images = imageFiles.map(file => ({
            name: file.name,
            path: file.path_lower || file.path_display || '',
            size: (file as any).size || 0,
            modified: (file as any).client_modified || (file as any).server_modified || ''
          }));

          // Filter for document files (PDFs and likely title/reg images)
          const docExtensions = ['.pdf'];
          const titleKeywords = ['title', 'registration', 'reg', 'vin', 'plate', 'ownership', 'document'];
          
          const documentFiles = folderContents.result.entries.filter(entry => {
            if (entry['.tag'] !== 'file') return false;
            const nameLower = entry.name.toLowerCase();
            const ext = nameLower.substring(nameLower.lastIndexOf('.'));
            
            // Include PDFs
            if (docExtensions.includes(ext)) return true;
            
            // Include JPG/PNG if filename suggests it's a document
            if (imageExtensions.includes(ext) && titleKeywords.some(kw => nameLower.includes(kw))) {
              return true;
            }
            
            return false;
          });

          vehicleFolder.documents = documentFiles.map(file => ({
            name: file.name,
            path: file.path_lower || file.path_display || '',
            size: (file as any).size || 0,
            modified: (file as any).client_modified || (file as any).server_modified || '',
            type: file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image'
          }));

        } catch (error) {
          console.error(`Error scanning folder ${vehicleFolder.name}:`, error);
        }

        vehicleFolders.push(vehicleFolder);
      }

      return vehicleFolders;
    } catch (error) {
      console.error('Error scanning vehicle inventory:', error);
      throw error;
    }
  }

  /**
   * Download an image file from Dropbox
   */
  async downloadImage(imagePath: string): Promise<Blob> {
    try {
      const response = await this.dbx.filesDownload({
        path: imagePath
      });

      return (response.result as any).fileBinary;
    } catch (error) {
      console.error(`Error downloading image ${imagePath}:`, error);
      throw error;
    }
  }

  /**
   * Get a temporary download link for an image
   */
  async getImageDownloadUrl(imagePath: string): Promise<string> {
    try {
      const response = await this.dbx.filesGetTemporaryLink({
        path: imagePath
      });

      return response.result.link;
    } catch (error) {
      console.error(`Error getting download URL for ${imagePath}:`, error);
      throw error;
    }
  }

  /**
   * Get metadata for a file (includes EXIF data if available)
   */
  async getFileMetadata(filePath: string): Promise<any> {
    try {
      const response = await this.dbx.filesGetMetadata({
        path: filePath,
        include_media_info: true,
        include_deleted: false,
        include_has_explicit_shared_members: false
      });

      return response.result;
    } catch (error) {
      console.error(`Error getting metadata for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Batch process vehicle folders for AI analysis
   */
  async prepareVehiclesForAI(vehicleFolders: VehicleFolder[]): Promise<{
    vehicleName: string;
    folderPath: string;
    images: Array<{
      name: string;
      downloadUrl: string;
      metadata?: any;
    }>;
  }[]> {
    const preparedVehicles = [];

    for (const folder of vehicleFolders) {
      const vehicleData = {
        vehicleName: folder.name,
        folderPath: folder.path,
        images: [] as Array<{
          name: string;
          downloadUrl: string;
          metadata?: any;
        }>
      };

      // Get download URLs for all images
      for (const image of folder.images) {
        try {
          const downloadUrl = await this.getImageDownloadUrl(image.path);
          const metadata = await this.getFileMetadata(image.path);
          
          vehicleData.images.push({
            name: image.name,
            downloadUrl,
            metadata
          });
        } catch (error) {
          console.error(`Error preparing image ${image.name}:`, error);
        }
      }

      preparedVehicles.push(vehicleData);
    }

    return preparedVehicles;
  }
}

export default DropboxService;
