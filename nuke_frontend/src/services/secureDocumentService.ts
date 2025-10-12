import { supabase } from '../lib/supabase';

export interface SecureDocument {
  id: string;
  user_id: string;
  document_type: string;
  file_hash: string;
  file_size: number;
  mime_type: string;
  storage_path: string;
  upload_metadata: any;
  verification_status: 'pending' | 'approved' | 'rejected';
  verified_by?: string;
  verified_at?: string;
  retention_until: string;
  created_at: string;
  updated_at: string;
}

export interface PIIAuditLog {
  id: string;
  user_id: string;
  accessed_by: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  access_reason?: string;
  created_at: string;
}

class SecureDocumentService {
  /**
   * Upload a secure document with encryption and audit logging
   */
  async uploadSecureDocument(
    file: File,
    documentType: string,
    metadata: any = {}
  ): Promise<{ document: SecureDocument; error?: string }> {
    try {
      // Generate file hash for integrity verification
      const fileHash = await this.generateFileHash(file);
      
      // Create secure storage path with user ID prefix
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      const fileName = `${user.id}/${Date.now()}_${file.name}`;
      
      // Upload to encrypted storage bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('user-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });
      
      if (uploadError) throw uploadError;
      
      // Create secure document record
      const documentData = {
        user_id: user.id,
        document_type: documentType,
        file_hash: fileHash,
        file_size: file.size,
        mime_type: file.type,
        storage_path: uploadData.path,
        upload_metadata: {
          ...metadata,
          original_filename: file.name,
          upload_timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent
        }
      };
      
      const { data: document, error: dbError } = await supabase
        .from('secure_documents')
        .insert(documentData)
        .select()
        .single();
      
      if (dbError) throw dbError;
      
      // Log the upload action
      await this.logPIIAccess(user.id, 'upload', 'id_document', document.id, 'Document upload');
      
      return { document };
    } catch (error) {
      console.error('Secure document upload error:', error);
      return { 
        document: null as any, 
        error: error instanceof Error ? error.message : 'Upload failed' 
      };
    }
  }
  
  /**
   * Get user's secure documents
   */
  async getUserDocuments(userId?: string): Promise<SecureDocument[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      const targetUserId = userId || user.id;
      
      // Check if user can access these documents
      if (targetUserId !== user.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_type')
          .eq('id', user.id)
          .single();
        
        if (!profile || !['moderator', 'admin'].includes(profile.user_type)) {
          throw new Error('Insufficient permissions');
        }
      }
      
      const { data: documents, error } = await supabase
        .from('secure_documents')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Log access for audit trail
      await this.logPIIAccess(
        targetUserId, 
        'view', 
        'id_document', 
        undefined, 
        userId ? 'Moderator document review' : 'User viewing own documents'
      );
      
      return documents || [];
    } catch (error) {
      console.error('Error fetching secure documents:', error);
      return [];
    }
  }
  
  /**
   * Get signed URL for secure document access
   */
  async getSecureDocumentUrl(documentId: string, accessReason: string): Promise<string | null> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      // Get document details
      const { data: document, error: docError } = await supabase
        .from('secure_documents')
        .select('*')
        .eq('id', documentId)
        .single();
      
      if (docError || !document) throw new Error('Document not found');
      
      // Check access permissions
      if (document.user_id !== user.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_type')
          .eq('id', user.id)
          .single();
        
        if (!profile || !['moderator', 'admin'].includes(profile.user_type)) {
          throw new Error('Insufficient permissions');
        }
      }
      
      // Generate signed URL (expires in 1 hour)  
      const { data: urlData, error: urlError } = await supabase.storage
        .from('user-documents')
        .createSignedUrl(document.storage_path, 3600);
      
      if (urlError) throw urlError;
      
      // Log the access
      await this.logPIIAccess(
        document.user_id,
        'download',
        'id_document',
        documentId,
        accessReason
      );
      
      return urlData.signedUrl;
    } catch (error) {
      console.error('Error generating secure document URL:', error);
      return null;
    }
  }
  
  /**
   * Update document verification status (moderators only)
   */
  async updateVerificationStatus(
    documentId: string,
    status: 'approved' | 'rejected',
    notes?: string
  ): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      // Verify moderator permissions
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_type')
        .eq('id', user.id)
        .single();
      
      if (!profile || !['moderator', 'admin'].includes(profile.user_type)) {
        throw new Error('Insufficient permissions');
      }
      
      const { error } = await supabase
        .from('secure_documents')
        .update({
          verification_status: status,
          verified_by: user.id,
          verified_at: new Date().toISOString()
        })
        .eq('id', documentId);
      
      if (error) throw error;
      
      // Log the verification action
      await this.logPIIAccess(
        user.id,
        'verify',
        'id_document',
        documentId,
        `Document ${status}: ${notes || 'No notes'}`
      );
      
      return true;
    } catch (error) {
      console.error('Error updating verification status:', error);
      return false;
    }
  }
  
  /**
   * Get audit logs for a user (user can see their own, moderators can see all)
   */
  async getAuditLogs(userId?: string, limit: number = 50): Promise<PIIAuditLog[]> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      
      const targetUserId = userId || user.id;
      
      // Check permissions for viewing other users' logs
      if (targetUserId !== user.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_type')
          .eq('id', user.id)
          .single();
        
        if (!profile || !['moderator', 'admin'].includes(profile.user_type)) {
          throw new Error('Insufficient permissions');
        }
      }
      
      const { data: logs, error } = await supabase
        .from('pii_audit_log')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      
      return logs || [];
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return [];
    }
  }
  
  /**
   * Generate SHA-256 hash of file for integrity verification
   */
  private async generateFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  /**
   * Log PII access for audit trail
   */
  private async logPIIAccess(
    userId: string,
    action: string,
    resourceType: string,
    resourceId?: string,
    reason?: string
  ): Promise<void> {
    try {
      await supabase.rpc('log_pii_access', {
        p_user_id: userId,
        p_action: action,
        p_resource_type: resourceType,
        p_resource_id: resourceId,
        p_access_reason: reason
      });
    } catch (error) {
      console.error('Error logging PII access:', error);
    }
  }
}

export const secureDocumentService = new SecureDocumentService();
