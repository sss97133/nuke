/**
 * Document Type Detector
 * Analyzes uploaded files to determine if they're images, receipts, titles, or other documents
 */

export type DocumentType = 
  | 'vehicle_photo'
  | 'receipt'
  | 'invoice'
  | 'title'
  | 'registration'
  | 'insurance'
  | 'manual'
  | 'other_document';

export interface DocumentDetectionResult {
  type: DocumentType;
  confidence: number;
  suggestedRoute: 'images' | 'receipts' | 'documents';
  reasoning: string;
}

export class DocumentTypeDetector {
  /**
   * Detect document type from file metadata
   */
  static detectFromFile(file: File): DocumentDetectionResult {
    const fileName = file.name.toLowerCase();
    const mimeType = file.type.toLowerCase();
    
    // Check file name keywords
    if (this.isReceipt(fileName)) {
      return {
        type: 'receipt',
        confidence: 0.9,
        suggestedRoute: 'receipts',
        reasoning: 'Filename contains receipt keywords'
      };
    }
    
    if (this.isInvoice(fileName)) {
      return {
        type: 'invoice',
        confidence: 0.9,
        suggestedRoute: 'receipts',
        reasoning: 'Filename contains invoice keywords'
      };
    }
    
    if (this.isTitle(fileName)) {
      return {
        type: 'title',
        confidence: 0.95,
        suggestedRoute: 'documents',
        reasoning: 'Filename indicates title document'
      };
    }
    
    if (this.isRegistration(fileName)) {
      return {
        type: 'registration',
        confidence: 0.9,
        suggestedRoute: 'documents',
        reasoning: 'Filename indicates registration'
      };
    }
    
    // PDFs are usually documents unless proven otherwise
    if (mimeType === 'application/pdf') {
      if (this.isPDF(fileName)) {
        return {
          type: 'other_document',
          confidence: 0.7,
          suggestedRoute: 'documents',
          reasoning: 'PDF file - likely document'
        };
      }
    }
    
    // Images are photos unless filename suggests otherwise
    if (mimeType.startsWith('image/')) {
      return {
        type: 'vehicle_photo',
        confidence: 0.8,
        suggestedRoute: 'images',
        reasoning: 'Image file type'
      };
    }
    
    return {
      type: 'other_document',
      confidence: 0.5,
      suggestedRoute: 'documents',
      reasoning: 'Unknown file type'
    };
  }
  
  /**
   * Detect from AI scan metadata (after upload)
   */
  static detectFromAIMetadata(metadata: any): DocumentDetectionResult | null {
    if (!metadata) return null;
    
    const docType = metadata.document_type?.toLowerCase();
    const angleCategory = metadata.angle_category?.toLowerCase();
    const containsText = metadata.contains_text === true;
    
    // Check for receipt/invoice indicators
    if (docType?.includes('receipt') || angleCategory?.includes('receipt')) {
      return {
        type: 'receipt',
        confidence: 0.95,
        suggestedRoute: 'receipts',
        reasoning: 'AI detected receipt'
      };
    }
    
    if (docType?.includes('invoice') || angleCategory?.includes('invoice')) {
      return {
        type: 'invoice',
        confidence: 0.95,
        suggestedRoute: 'receipts',
        reasoning: 'AI detected invoice'
      };
    }
    
    // Check for title/registration
    if (docType?.includes('title') || angleCategory?.includes('title')) {
      return {
        type: 'title',
        confidence: 0.95,
        suggestedRoute: 'documents',
        reasoning: 'AI detected title document'
      };
    }
    
    // Heavy text indicates document
    if (containsText && angleCategory?.includes('document')) {
      return {
        type: 'other_document',
        confidence: 0.8,
        suggestedRoute: 'documents',
        reasoning: 'AI detected text-heavy document'
      };
    }
    
    return null;
  }
  
  // Helper methods
  private static isReceipt(fileName: string): boolean {
    const keywords = ['receipt', 'rcpt', 'recipt'];
    return keywords.some(k => fileName.includes(k));
  }
  
  private static isInvoice(fileName: string): boolean {
    const keywords = ['invoice', 'inv', 'bill'];
    return keywords.some(k => fileName.includes(k));
  }
  
  private static isTitle(fileName: string): boolean {
    const keywords = ['title', 'ttl', 'ownership'];
    return keywords.some(k => fileName.includes(k));
  }
  
  private static isRegistration(fileName: string): boolean {
    const keywords = ['registration', 'reg', 'dmv'];
    return keywords.some(k => fileName.includes(k));
  }
  
  private static isPDF(fileName: string): boolean {
    return fileName.endsWith('.pdf');
  }
}

