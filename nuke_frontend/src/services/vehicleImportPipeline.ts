import { DropboxService } from './dropboxService';

export interface VehicleFolder {
  folderName: string;
  folderPath: string;
  images: ImageFile[];
  documents: DocumentFile[];
  metadata: {
    createdAt: string;
    modifiedAt: string;
    itemCount: number;
  };
}

export interface ImageFile {
  name: string;
  path: string;
  downloadUrl: string;
  size: number;
  type: string;
}

export interface DocumentFile {
  name: string;
  path: string;
  downloadUrl: string;
  type: 'rtf' | 'txt' | 'pdf' | 'doc';
  content?: string; // Extracted text content
  size: number;
}

export interface VehicleDataSources {
  fromImages: Partial<VehicleProfile>;
  fromDocuments: Partial<VehicleProfile>;
  fromFolderName: Partial<VehicleProfile>;
  confidenceScores: Record<string, number>;
}

export interface VehicleProfile {
  id: string;
  folderName: string;
  year?: number;
  make?: string;
  model?: string;
  color?: string;
  vin?: string;
  mileage?: number;
  purchasePrice?: number;
  condition?: string;
  notes?: string;
  primaryImageUrl: string;
  allImages: string[];
  documents: DocumentFile[];
  dataSource: 'automated' | 'manual' | 'hybrid';
  confidenceScore: number;
  extractionLog: string[];
}

export class VehicleImportPipeline {
  private dropboxService: DropboxService;
  private openaiApiKey: string;

  constructor(dropboxService: DropboxService) {
    this.dropboxService = dropboxService;
    this.openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
  }

  /**
   * Scan Dropbox folder structure and identify vehicle folders
   */
  async scanVehicleFolders(rootPath: string = ''): Promise<VehicleFolder[]> {
    try {
      const folders = await this.dropboxService.listFolders(rootPath);
      const vehicleFolders: VehicleFolder[] = [];

      for (const folder of folders) {
        const folderContents = await this.dropboxService.listFolderContents(folder.path);
        
        const images = folderContents.filter(item => 
          this.isImageFile(item.name)
        ).map(item => ({
          name: item.name,
          path: item.path,
          downloadUrl: '', // Will be populated when needed
          size: item.size,
          type: this.getFileExtension(item.name)
        }));

        const documents = folderContents.filter(item => 
          this.isDocumentFile(item.name)
        ).map(item => ({
          name: item.name,
          path: item.path,
          downloadUrl: '', // Will be populated when needed
          type: this.getDocumentType(item.name),
          size: item.size
        }));

        // Only include folders that have images (vehicle folders)
        if (images.length > 0) {
          vehicleFolders.push({
            folderName: folder.name,
            folderPath: folder.path,
            images,
            documents,
            metadata: {
              createdAt: folder.createdAt || new Date().toISOString(),
              modifiedAt: folder.modifiedAt || new Date().toISOString(),
              itemCount: folderContents.length
            }
          });
        }
      }

      return vehicleFolders;
    } catch (error) {
      console.error('Error scanning vehicle folders:', error);
      throw new Error(`Failed to scan vehicle folders: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract vehicle data from images using AI vision
   */
  async extractDataFromImages(images: ImageFile[]): Promise<Partial<VehicleProfile>> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Use the first image as primary for analysis
    const primaryImage = images[0];
    if (!primaryImage) {
      return {};
    }

    // Get download URL for the image
    primaryImage.downloadUrl = await this.dropboxService.getTemporaryLink(primaryImage.path);

    const prompt = `Analyze this vehicle image and extract the following information in JSON format:
    {
      "year": estimated year (number),
      "make": vehicle manufacturer,
      "model": vehicle model,
      "color": primary color,
      "condition": overall condition assessment,
      "vin": VIN number if visible,
      "confidence": confidence level (0-1)
    }
    
    Be as accurate as possible and indicate your confidence level.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: primaryImage.downloadUrl }
                }
              ]
            }
          ],
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const analysisText = data.choices[0]?.message?.content || '';
      
      // Try to extract JSON from the response
      try {
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            year: parsed.year,
            make: parsed.make,
            model: parsed.model,
            color: parsed.color,
            condition: parsed.condition,
            vin: parsed.vin
          };
        }
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        return this.extractDataFromText(analysisText);
      }

      return {};
    } catch (error) {
      console.error('Error analyzing images:', error);
      return {};
    }
  }

  /**
   * Extract vehicle data from RTF and text documents
   */
  async extractDataFromDocuments(documents: DocumentFile[]): Promise<Partial<VehicleProfile>> {
    const extractedData: Partial<VehicleProfile> = {};
    const extractionLog: string[] = [];

    for (const doc of documents) {
      try {
        // Get download URL and fetch content
        doc.downloadUrl = await this.dropboxService.getTemporaryLink(doc.path);
        
        if (doc.type === 'rtf') {
          doc.content = await this.parseRTFContent(doc.downloadUrl);
        } else if (doc.type === 'txt') {
          doc.content = await this.parseTextContent(doc.downloadUrl);
        }

        if (doc.content) {
          // Use AI to extract structured data from document content
          const docData = await this.extractDataFromDocumentContent(doc.content, doc.name);
          
          // Merge data with confidence tracking
          Object.assign(extractedData, docData);
          extractionLog.push(`Extracted data from ${doc.name}`);
        }
      } catch (error) {
        console.error(`Error processing document ${doc.name}:`, error);
        extractionLog.push(`Failed to process ${doc.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return extractedData;
  }

  /**
   * Extract vehicle data from folder name patterns
   */
  extractDataFromFolderName(folderName: string): Partial<VehicleProfile> {
    const data: Partial<VehicleProfile> = {};
    
    // Common patterns: "2015_Honda_Civic", "BMW_X5_Blue", "Car_001", etc.
    const yearMatch = folderName.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year >= 1900 && year <= new Date().getFullYear() + 1) {
        data.year = year;
      }
    }

    // Common car manufacturers
    const makes = ['Toyota', 'Honda', 'Ford', 'Chevrolet', 'BMW', 'Mercedes', 'Audi', 'Volkswagen', 'Nissan', 'Hyundai', 'Lexus', 'Acura', 'Infiniti'];
    for (const make of makes) {
      if (folderName.toLowerCase().includes(make.toLowerCase())) {
        data.make = make;
        break;
      }
    }

    // Common colors
    const colors = ['Red', 'Blue', 'Black', 'White', 'Silver', 'Gray', 'Green', 'Yellow', 'Orange', 'Purple'];
    for (const color of colors) {
      if (folderName.toLowerCase().includes(color.toLowerCase())) {
        data.color = color;
        break;
      }
    }

    return data;
  }

  /**
   * Fuse data from multiple sources with conflict resolution
   */
  async fuseVehicleData(sources: VehicleDataSources): Promise<VehicleProfile> {
    // AI-powered conflict resolution and data fusion
    const prompt = `Given vehicle data from multiple sources, resolve conflicts and create the most accurate vehicle profile:

    Image Analysis: ${JSON.stringify(sources.fromImages)}
    Document Analysis: ${JSON.stringify(sources.fromDocuments)}
    Folder Name: ${JSON.stringify(sources.fromFolderName)}
    
    Return the best consolidated data in JSON format with confidence scores.`;

    // For now, implement simple priority-based fusion
    // Priority: Documents > Images > Folder Name
    const fusedData: Partial<VehicleProfile> = {
      ...sources.fromFolderName,
      ...sources.fromImages,
      ...sources.fromDocuments
    };

    return {
      id: crypto.randomUUID(),
      folderName: '',
      primaryImageUrl: '',
      allImages: [],
      documents: [],
      dataSource: 'automated',
      confidenceScore: 0.8,
      extractionLog: [],
      ...fusedData
    } as VehicleProfile;
  }

  /**
   * Process a single vehicle folder through the complete pipeline
   */
  async processVehicleFolder(folder: VehicleFolder): Promise<VehicleProfile> {
    const extractionLog: string[] = [];
    
    try {
      // Extract data from all sources
      extractionLog.push(`Processing folder: ${folder.folderName}`);
      
      const fromImages = await this.extractDataFromImages(folder.images);
      extractionLog.push(`Analyzed ${folder.images.length} images`);
      
      const fromDocuments = await this.extractDataFromDocuments(folder.documents);
      extractionLog.push(`Processed ${folder.documents.length} documents`);
      
      const fromFolderName = this.extractDataFromFolderName(folder.folderName);
      extractionLog.push(`Extracted data from folder name`);

      // Fuse all data sources
      const sources: VehicleDataSources = {
        fromImages,
        fromDocuments,
        fromFolderName,
        confidenceScores: {} // TODO: Implement confidence tracking
      };

      const vehicleProfile = await this.fuseVehicleData(sources);
      
      // Set folder-specific data
      vehicleProfile.folderName = folder.folderName;
      vehicleProfile.primaryImageUrl = folder.images[0]?.downloadUrl || '';
      vehicleProfile.allImages = folder.images.map(img => img.downloadUrl);
      vehicleProfile.documents = folder.documents;
      vehicleProfile.extractionLog = extractionLog;

      return vehicleProfile;
    } catch (error) {
      extractionLog.push(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new Error(`Failed to process vehicle folder ${folder.folderName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Helper methods
  private isImageFile(filename: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    return imageExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  private isDocumentFile(filename: string): boolean {
    const docExtensions = ['.rtf', '.txt', '.pdf', '.doc', '.docx'];
    return docExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  private getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toLowerCase() || '';
  }

  private getDocumentType(filename: string): 'rtf' | 'txt' | 'pdf' | 'doc' {
    const ext = this.getFileExtension(filename);
    if (['rtf', 'txt', 'pdf', 'doc'].includes(ext)) {
      return ext as 'rtf' | 'txt' | 'pdf' | 'doc';
    }
    return 'txt'; // Default fallback
  }

  private async parseRTFContent(downloadUrl: string): Promise<string> {
    // TODO: Implement RTF parsing
    // For now, fetch as text and strip RTF formatting
    const response = await fetch(downloadUrl);
    const rtfContent = await response.text();
    
    // Basic RTF stripping (remove control codes)
    return rtfContent.replace(/\\[a-z]+\d*\s?/g, '').replace(/[{}]/g, '');
  }

  private async parseTextContent(downloadUrl: string): Promise<string> {
    const response = await fetch(downloadUrl);
    return await response.text();
  }

  private async extractDataFromDocumentContent(content: string, filename: string): Promise<Partial<VehicleProfile>> {
    // Use AI to extract structured data from document content
    if (!this.openaiApiKey) {
      return {};
    }

    const prompt = `Extract vehicle information from this document content and return as JSON:
    
    Document: ${filename}
    Content: ${content}
    
    Extract: year, make, model, vin, mileage, purchasePrice, condition, notes
    Return only valid JSON.`;

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const analysisText = data.choices[0]?.message?.content || '';
      
      try {
        const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Error parsing document analysis:', parseError);
      }

      return {};
    } catch (error) {
      console.error('Error analyzing document content:', error);
      return {};
    }
  }

  private extractDataFromText(text: string): Partial<VehicleProfile> {
    // Fallback text parsing if JSON extraction fails
    const data: Partial<VehicleProfile> = {};
    
    // Try to extract year
    const yearMatch = text.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      if (year >= 1900 && year <= new Date().getFullYear() + 1) {
        data.year = year;
      }
    }
    
    // Common car manufacturers
    const makes = ['Toyota', 'Honda', 'Ford', 'Chevrolet', 'BMW', 'Mercedes', 'Audi', 'Volkswagen', 'Nissan', 'Hyundai'];
    for (const make of makes) {
      if (text.toLowerCase().includes(make.toLowerCase())) {
        data.make = make;
        break;
      }
    }
    
    return data;
  }
}

export default VehicleImportPipeline;
