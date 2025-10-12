/**
 * Document Verification Service
 * Uses OCR to extract and verify names from title and ID documents
 */

import { supabase } from '../lib/supabase';

export interface VerificationResult {
  success: boolean;
  extractedData?: {
    titleName?: string;
    idName?: string;
    vin?: string;
    vehicleInfo?: string;
  };
  confidence?: number;
  errors?: string[];
}

export class DocumentVerificationService {
  /**
   * Extract text from document using OpenAI Vision API
   */
  static async extractTextFromDocument(
    imageUrl: string,
    documentType: 'title' | 'drivers_license'
  ): Promise<{ text: string; extractedData: any }> {
    const apiKey = import.meta.env?.VITE_OPENAI_API_KEY;
    
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const prompt = documentType === 'title' 
        ? `Extract the following from this vehicle title document:
           1. Owner's full name
           2. VIN number
           3. Vehicle year, make, and model
           4. Any lienholder information
           Format as JSON with keys: ownerName, vin, year, make, model, lienholder`
        : `Extract the following from this driver's license or ID:
           1. Full name
           2. Date of birth
           3. License/ID number
           4. Address
           Format as JSON with keys: fullName, dateOfBirth, idNumber, address`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                    detail: 'high'
                  }
                }
              ]
            }
          ],
          max_tokens: 500,
          temperature: 0.1 // Low temperature for accuracy
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const extractedText = data.choices[0]?.message?.content || '';
      
      // Try to parse as JSON
      let extractedData = {};
      try {
        extractedData = JSON.parse(extractedText);
      } catch (e) {
        // If not valid JSON, extract manually from text
        console.log('Could not parse as JSON, using text extraction');
        extractedData = this.extractDataFromText(extractedText, documentType);
      }

      return {
        text: extractedText,
        extractedData
      };
    } catch (error) {
      console.error('OCR extraction error:', error);
      throw error;
    }
  }

  /**
   * Fallback text extraction if JSON parsing fails
   */
  static extractDataFromText(text: string, documentType: string): any {
    const result: any = {};
    
    if (documentType === 'title') {
      // Look for name patterns
      const nameMatch = text.match(/(?:owner|name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
      if (nameMatch) result.ownerName = nameMatch[1].trim();
      
      // Look for VIN
      const vinMatch = text.match(/(?:VIN|vin)[:\s]+([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) result.vin = vinMatch[1];
      
      // Look for year
      const yearMatch = text.match(/(?:year)[:\s]+(\d{4})/i);
      if (yearMatch) result.year = yearMatch[1];
    } else {
      // Driver's license
      const nameMatch = text.match(/(?:name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
      if (nameMatch) result.fullName = nameMatch[1].trim();
    }
    
    return result;
  }

  /**
   * Compare names with fuzzy matching
   */
  static compareNames(name1: string, name2: string): number {
    if (!name1 || !name2) return 0;
    
    // Normalize names
    const normalize = (name: string) => 
      name.toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .trim()
        .split(/\s+/)
        .sort()
        .join(' ');
    
    const normalized1 = normalize(name1);
    const normalized2 = normalize(name2);
    
    if (normalized1 === normalized2) return 100;
    
    // Check if one name contains the other (partial match)
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      return 85;
    }
    
    // Calculate similarity score
    const words1 = normalized1.split(' ');
    const words2 = normalized2.split(' ');
    const matches = words1.filter(w => words2.includes(w)).length;
    const totalWords = Math.max(words1.length, words2.length);
    
    return Math.round((matches / totalWords) * 100);
  }

  /**
   * Verify ownership by comparing title and ID documents
   */
  static async verifyOwnership(
    titleDocUrl: string,
    idDocUrl: string,
    vehicleId: string,
    userId: string
  ): Promise<VerificationResult> {
    try {
      console.log('Starting document verification...');
      
      // Extract text from both documents
      const [titleData, idData] = await Promise.all([
        this.extractTextFromDocument(titleDocUrl, 'title'),
        this.extractTextFromDocument(idDocUrl, 'drivers_license')
      ]);

      const titleName = titleData.extractedData?.ownerName || '';
      const idName = idData.extractedData?.fullName || '';
      const vin = titleData.extractedData?.vin || '';
      
      console.log('Extracted names:', { titleName, idName });
      
      // Compare names
      const nameMatchScore = this.compareNames(titleName, idName);
      const isVerified = nameMatchScore >= 80; // 80% match threshold
      
      // Save verification results
      const { error: updateError } = await supabase
        .from('ownership_verifications')
        .update({
          title_extracted_name: titleName,
          id_extracted_name: idName,
          extracted_vin: vin,
          name_match_score: nameMatchScore,
          auto_verified: isVerified,
          verification_status: isVerified ? 'verified' : 'manual_review',
          verified_at: isVerified ? new Date().toISOString() : null,
          verification_notes: `Name match score: ${nameMatchScore}%. ${
            isVerified ? 'Auto-verified' : 'Requires manual review'
          }`
        })
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId);

      if (updateError) {
        console.error('Failed to update verification record:', updateError);
      }

      // Update vehicle ownership if verified
      if (isVerified) {
        const { error: vehicleError } = await supabase
          .from('vehicles')
          .update({
            verified_owner_id: userId,
            ownership_verified_at: new Date().toISOString()
          })
          .eq('id', vehicleId);
          
        if (vehicleError) {
          console.error('Failed to update vehicle ownership:', vehicleError);
        }
      }

      return {
        success: isVerified,
        extractedData: {
          titleName,
          idName,
          vin,
          vehicleInfo: `${titleData.extractedData?.year || ''} ${titleData.extractedData?.make || ''} ${titleData.extractedData?.model || ''}`.trim()
        },
        confidence: nameMatchScore,
        errors: isVerified ? [] : [`Name match confidence too low: ${nameMatchScore}%`]
      };
    } catch (error: any) {
      console.error('Verification error:', error);
      return {
        success: false,
        errors: [error.message || 'Verification failed']
      };
    }
  }

  /**
   * Process uploaded documents for verification
   */
  static async processDocumentUpload(
    documentType: 'title' | 'drivers_license',
    documentUrl: string,
    vehicleId: string,
    userId: string
  ) {
    try {
      // Check if we have both documents
      const { data: verification } = await supabase
        .from('ownership_verifications')
        .select('title_document_url, drivers_license_url')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', userId)
        .single();

      if (!verification) {
        console.log('No verification record found');
        return;
      }

      // If we have both documents, run verification
      if (verification.title_document_url && 
          verification.drivers_license_url && 
          verification.drivers_license_url !== 'pending') {
        
        console.log('Both documents available, running verification...');
        
        const result = await this.verifyOwnership(
          verification.title_document_url,
          verification.drivers_license_url,
          vehicleId,
          userId
        );

        return result;
      }

      return {
        success: false,
        errors: ['Waiting for both documents to be uploaded']
      };
    } catch (error: any) {
      console.error('Document processing error:', error);
      return {
        success: false,
        errors: [error.message]
      };
    }
  }
}
