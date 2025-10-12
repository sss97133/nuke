import { Dropbox } from 'dropbox';

interface DropboxConfig {
  clientId: string;
  accessToken?: string;
}

interface VehicleFolder {
  name: string;
  path: string;
  images: DropboxImage[];
}

interface DropboxImage {
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

  static getInstance(config?: DropboxConfig): DropboxService {
    if (!DropboxService.instance && config) {
      DropboxService.instance = new DropboxService(config);
    } else if (config && DropboxService.instance) {
      // Update existing instance with new config (especially access token)
      console.log('Updating DropboxService with new token:', config.accessToken?.substring(0, 20) + '...');
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
    console.log('Force refreshing DropboxService instance with new token');
    DropboxService.instance = new DropboxService(config);
    return DropboxService.instance;
  }

  generateAuthUrl(): string {
    const clientId = import.meta.env.VITE_DROPBOX_CLIENT_ID;
    if (!clientId) {
      throw new Error('Dropbox client ID not configured');
    }

    const redirectUri = `${window.location.origin}/dropbox-callback`;
    const state = Math.random().toString(36).substring(2, 15);
    
    // Store state for CSRF protection
    localStorage.setItem('dropbox_oauth_state', state);

    // Force re-approval to ensure fresh token with updated scopes
    const authUrl = `https://www.dropbox.com/oauth2/authorize?` +
      `client_id=${clientId}&` +
      `response_type=token&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=files.metadata.read files.content.read account_info.read&` +
      `state=${state}&` +
      `force_reapproval=true`;
    
    console.log('Generated OAuth URL:', authUrl);
    console.log('Requested scopes: files.metadata.read files.content.read account_info.read');
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
      // Debug: Test account access to verify token scopes
      console.log('Testing account access to verify token scopes...');
      try {
        const accountInfo = await this.dbx.usersGetCurrentAccount();
        console.log('Account access successful:', accountInfo.result.name.display_name);
        
        // Try to get token info to see actual granted scopes
        try {
          const tokenInfo = await this.dbx.checkUser({});
          console.log('Token info:', tokenInfo);
        } catch (tokenError) {
          console.log('Could not get token info:', tokenError);
        }
        
      } catch (error) {
        console.error('Account access failed:', error);
        throw new Error('Token does not have account access');
      }
      let dropboxPath = path;
      if (path === '/' || path === '') {
        dropboxPath = '';
      }
      
      console.log('Listing folders for path:', dropboxPath);
      console.log('Using access token from localStorage:', localStorage.getItem('dropbox_access_token')?.substring(0, 20) + '...');
      
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
      console.error('Error listing folders:', error);
      console.error('Error details:', {
        status: error.status,
        message: error.message,
        error: error.error,
        response: error.response
      });
      
      // Check if it's an authentication error
      if (error.status === 401) {
        throw new Error('Dropbox access token is invalid or expired. Please reconnect your account.');
      }
      
      // Check if it's a bad request with more details
      if (error.status === 400) {
        const errorMsg = error.error?.error_summary || error.message || 'Bad request';
        throw new Error(`Dropbox API error: ${errorMsg}`);
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
        const vehicleFolder: VehicleFolder = {
          name: folder.name,
          path: folder.path,
          images: []
        };

        // Get images in each vehicle folder
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
