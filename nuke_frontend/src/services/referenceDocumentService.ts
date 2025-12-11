/**
 * Reference Document Service
 * Handles upload, indexing, and management of reference documents
 * (brochures, manuals, spec sheets, parts catalogs, etc.)
 */

import { supabase } from '../lib/supabase';

export interface ReferenceDocument {
  id: string;
  owner_id: string;
  owner_type: 'user' | 'organization';
  document_type: string;
  title: string;
  description?: string;
  file_url: string;
  thumbnail_url?: string;
  file_size_bytes?: number;
  page_count?: number;
  mime_type?: string;
  year?: number;
  year_range_start?: number;
  year_range_end?: number;
  make?: string;
  series?: string;
  body_style?: string;
  year_published?: number;
  publisher?: string;
  part_number?: string;
  edition?: string;
  language?: string;
  is_public: boolean;
  is_factory_original: boolean;
  is_verified: boolean;
  tags?: string[];
  quality_rating?: number;
  view_count: number;
  download_count: number;
  bookmark_count: number;
  link_count: number;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentUploadOptions {
  file: File;
  document_type: string;
  title: string;
  description?: string;
  year?: number;
  year_range_start?: number;
  year_range_end?: number;
  make?: string;
  series?: string;
  body_style?: string;
  is_public?: boolean;
  is_factory_original?: boolean;
  tags?: string[];
  auto_index?: boolean; // Automatically trigger indexing after upload
}

export class ReferenceDocumentService {
  /**
   * Upload a reference document
   * 1. Uploads file to Supabase Storage
   * 2. Creates reference_documents record
   * 3. Optionally triggers indexing
   */
  static async uploadDocument(
    userId: string,
    options: DocumentUploadOptions
  ): Promise<ReferenceDocument> {
    try {
      const { file, document_type, title, description, auto_index = true, ...metadata } = options;

      // 1. Upload file to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${userId}/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('reference-docs')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // 2. Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('reference-docs')
        .getPublicUrl(filePath);

      // 3. Extract basic metadata from file
      const mimeType = file.type;
      const fileSizeBytes = file.size;

      // 4. Create document record
      const { data: document, error: docError } = await supabase
        .from('reference_documents')
        .insert({
          owner_id: userId,
          owner_type: 'user',
          document_type,
          title,
          description,
          file_url: publicUrl,
          file_size_bytes: fileSizeBytes,
          mime_type: mimeType,
          year: metadata.year,
          year_range_start: metadata.year_range_start,
          year_range_end: metadata.year_range_end,
          make: metadata.make,
          series: metadata.series,
          body_style: metadata.body_style,
          is_public: metadata.is_public || false,
          is_factory_original: metadata.is_factory_original || false,
          tags: metadata.tags || []
        })
        .select()
        .single();

      if (docError) throw docError;

      // 5. Trigger indexing if requested and document type supports it
      if (auto_index && document) {
        await this.triggerIndexing(document.id, document_type, publicUrl, userId);
      }

      return document;
    } catch (error: any) {
      console.error('Error uploading reference document:', error);
      throw error;
    }
  }

  /**
   * Trigger appropriate indexing based on document type
   */
  static async triggerIndexing(
    documentId: string,
    documentType: string,
    fileUrl: string,
    userId: string
  ): Promise<void> {
    try {
      // Determine which indexing function to use based on document type
      if (documentType === 'parts_catalog') {
        // Use index-reference-document for parts catalogs
        const { error } = await supabase.functions.invoke('index-reference-document', {
          body: {
            document_id: documentId,
            pdf_url: fileUrl,
            user_id: userId,
            mode: 'structure' // Start with structure analysis
          }
        });

        if (error) {
          console.error('Error triggering parts catalog indexing:', error);
          // Don't throw - indexing can happen later
        }
      } else if (['service_manual', 'material_manual', 'tds'].includes(documentType)) {
        // Use index-service-manual for service manuals, material manuals, TDS sheets
        const { error } = await supabase.functions.invoke('index-service-manual', {
          body: {
            document_id: documentId,
            mode: 'structure' // Start with structure analysis
          }
        });

        if (error) {
          console.error('Error triggering service manual indexing:', error);
          // Don't throw - indexing can happen later
        }
      } else {
        // For brochures, spec sheets, etc. - no automatic indexing
        // They can be indexed manually later if needed
        console.log(`Document type ${documentType} does not support automatic indexing`);
      }
    } catch (error) {
      console.error('Error in triggerIndexing:', error);
      // Don't throw - indexing failure shouldn't block upload
    }
  }

  /**
   * Get user's reference documents
   */
  static async getUserDocuments(userId: string, includePublic = false): Promise<ReferenceDocument[]> {
    try {
      let query = supabase
        .from('reference_documents')
        .select('*')
        .eq('owner_id', userId)
        .eq('owner_type', 'user')
        .order('uploaded_at', { ascending: false });

      if (!includePublic) {
        // When includePublic is false, we still want all user's documents
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading user documents:', error);
      return [];
    }
  }

  /**
   * Get public reference documents
   */
  static async getPublicDocuments(userId?: string): Promise<ReferenceDocument[]> {
    try {
      const { data, error } = await supabase
        .from('reference_documents')
        .select('*')
        .eq('is_public', true)
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading public documents:', error);
      return [];
    }
  }

  /**
   * Get documents linked to a vehicle
   */
  static async getVehicleDocuments(vehicleId: string): Promise<ReferenceDocument[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_vehicle_documents', { p_vehicle_id: vehicleId });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading vehicle documents:', error);
      return [];
    }
  }

  /**
   * Link a document to a vehicle
   */
  static async linkToVehicle(
    documentId: string,
    vehicleId: string,
    userId: string,
    linkType: 'owner' | 'public' | 'shared' = 'owner',
    notes?: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('vehicle_documents')
        .insert({
          vehicle_id: vehicleId,
          document_id: documentId,
          linked_by: userId,
          link_type: linkType,
          notes
        });

      if (error) throw error;

      // Increment link count
      await supabase.rpc('increment_document_stat', {
        p_document_id: documentId,
        p_stat_type: 'link'
      });
    } catch (error) {
      console.error('Error linking document to vehicle:', error);
      throw error;
    }
  }

  /**
   * Delete a reference document
   */
  static async deleteDocument(documentId: string, userId: string): Promise<void> {
    try {
      // Get document to find file path
      const { data: doc, error: docError } = await supabase
        .from('reference_documents')
        .select('file_url')
        .eq('id', documentId)
        .eq('owner_id', userId)
        .single();

      if (docError) throw docError;

      // Delete from storage (extract path from URL)
      if (doc.file_url) {
        const urlParts = doc.file_url.split('/reference-docs/');
        if (urlParts.length > 1) {
          const filePath = urlParts[1];
          await supabase.storage
            .from('reference-docs')
            .remove([filePath]);
        }
      }

      // Delete document record (cascades to vehicle_documents)
      const { error } = await supabase
        .from('reference_documents')
        .delete()
        .eq('id', documentId)
        .eq('owner_id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  /**
   * Update document metadata
   */
  static async updateDocument(
    documentId: string,
    userId: string,
    updates: Partial<ReferenceDocument>
  ): Promise<ReferenceDocument> {
    try {
      const { data, error } = await supabase
        .from('reference_documents')
        .update(updates)
        .eq('id', documentId)
        .eq('owner_id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error updating document:', error);
      throw error;
    }
  }

  /**
   * Increment view/download count
   */
  static async incrementStat(
    documentId: string,
    statType: 'view' | 'download' | 'bookmark'
  ): Promise<void> {
    try {
      await supabase.rpc('increment_document_stat', {
        p_document_id: documentId,
        p_stat_type: statType
      });
    } catch (error) {
      console.error('Error incrementing stat:', error);
      // Don't throw - stat updates are non-critical
    }
  }
}










