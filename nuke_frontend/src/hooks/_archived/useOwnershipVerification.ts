import { useState } from 'react';
import { supabase } from '../lib/supabase';

export interface OwnershipVerificationResult {
  success: boolean;
  type: 'success' | 'duplicate' | 'error';
  message: string;
  details?: string;
}

export const useOwnershipVerification = () => {
  const [submitting, setSubmitting] = useState(false);

  const submitOwnershipVerification = async (
    userId: string,
    vehicleId: string,
    verificationType: string,
    documents: any[]
  ): Promise<OwnershipVerificationResult> => {
    setSubmitting(true);

    try {
      // First check if there's already an active verification
      const { data: existingVerification, error: checkError } = await supabase
        .from('ownership_verifications')
        .select('id, status, created_at, verification_type')
        .eq('user_id', userId)
        .eq('vehicle_id', vehicleId)
        .in('status', ['pending', 'under_review'])
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        // Error other than "not found"
        throw checkError;
      }

      if (existingVerification) {
        // Update existing verification
        const { error: updateError } = await supabase
          .from('ownership_verifications')
          .update({
            verification_type: verificationType,
            documents: documents,
            status: 'pending',
            updated_at: new Date().toISOString()
          })
          .eq('id', existingVerification.id);

        if (updateError) {
          throw updateError;
        }

        return {
          success: true,
          type: 'duplicate',
          message: 'You have already submitted ownership documentation for this vehicle.',
          details: `Your previous submission from ${new Date(existingVerification.created_at).toLocaleDateString()} has been updated with new information. Our admin team will review your documentation and approve or request additional information.`
        };
      } else {
        // Create new verification
        const { error: insertError } = await supabase
          .from('ownership_verifications')
          .insert({
            user_id: userId,
            vehicle_id: vehicleId,
            verification_type: verificationType,
            documents: documents,
            status: 'pending'
          });

        if (insertError) {
          if (insertError.code === '23505') {
            // Unique constraint violation - race condition, treat as duplicate
            return {
              success: true,
              type: 'duplicate',
              message: 'You have already submitted ownership documentation for this vehicle.',
              details: 'Our admin team will review your documentation and approve or request additional information.'
            };
          }
          throw insertError;
        }

        // Create notification for user
        await supabase.rpc('create_notification', {
          recipient_id_param: userId,
          sender_id_param: null,
          type_param: 'account_update',
          title_param: 'Ownership Documentation Submitted',
          body_param: 'Your ownership documentation has been submitted and is awaiting admin approval.',
          entity_type_param: 'vehicle',
          entity_id_param: vehicleId,
          priority_param: 'normal'
        });

        return {
          success: true,
          type: 'success',
          message: 'Your ownership documentation has been successfully submitted!',
          details: 'Our admin team will review your documentation within 1-3 business days. You will receive a notification once your ownership has been verified.'
        };
      }
    } catch (error) {
      console.error('Ownership verification error:', error);

      return {
        success: false,
        type: 'error',
        message: 'Failed to submit ownership documentation.',
        details: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again later or contact support.'
      };
    } finally {
      setSubmitting(false);
    }
  };

  return {
    submitOwnershipVerification,
    submitting
  };
};