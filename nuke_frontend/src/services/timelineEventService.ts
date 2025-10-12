import { supabase } from '../lib/supabase';

export interface TimelineEventData {
  vehicle_id: string;
  event_type: string;
  source: string;
  event_date: string;
  title: string;
  description?: string;
  confidence_score: number;
  metadata: Record<string, any>;
  source_url?: string;
  image_urls?: string[];
}

export interface VehicleEditMetadata {
  who: {
    user_id?: string;
    user_email?: string;
    user_name?: string;
    is_owner: boolean;
    user_role?: string;
  };
  what: {
    action: 'vehicle_edit';
    fields_changed: string[];
    old_values: Record<string, any>;
    new_values: Record<string, any>;
    change_summary: string;
  };
  when: {
    timestamp: string;
    timezone: string;
  };
  where: {
    ip_address?: string;
    user_agent?: string;
    location?: string;
  };
  why: {
    reason?: string;
    context?: string;
    edit_source: 'manual_edit' | 'bulk_import' | 'ai_correction' | 'verification_update';
  };
}

export class TimelineEventService {
  static async createBATAuctionEvent(
    vehicleId: string,
    batData: {
      auction_url: string;
      sold_price: number;
      sale_date: string;
    },
    userId?: string
  ): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      const saleDate = new Date(batData.sale_date);
      const formattedPrice = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0
      }).format(batData.sold_price);

      const metadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          is_owner: userId === user?.id,
          user_role: user?.user_metadata?.role || 'user'
        },
        what: {
          action: 'bat_auction_sale',
          auction_url: batData.auction_url,
          sold_price: batData.sold_price,
          sale_date: batData.sale_date,
          platform: 'Bring a Trailer'
        },
        when: {
          auction_end: batData.sale_date,
          recorded: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          platform: 'Bring a Trailer',
          auction_url: batData.auction_url
        },
        why: {
          reason: 'Vehicle ownership transfer via auction',
          context: 'BAT auction completed with ownership change',
          significance: 'high' // Ownership transfers are significant events
        }
      };

      const eventData: TimelineEventData = {
        vehicle_id: vehicleId,
        event_type: 'ownership_transfer',
        source: 'bring_a_trailer',
        event_date: batData.sale_date,
        title: 'Sold on Bring a Trailer',
        description: `Vehicle sold for ${formattedPrice} on Bring a Trailer auction`,
        confidence_score: 95, // High confidence for BAT data
        metadata,
        source_url: batData.auction_url
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (error) {
        console.error('Error creating BAT auction timeline event:', error);
      }
    } catch (error) {
      console.error('Error in createBATAuctionEvent:', error);
    }
  }

  static async createTitleIssuedEvent(
    vehicleId: string,
    params: {
      issue_date: string; // ISO date
      owner_name?: string;
      odometer_status?: string;
      odometer_value?: number;
      document_id?: string;
    }
  ): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      const metadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          user_role: user?.user_metadata?.role || 'user'
        },
        what: {
          action: 'title_issued',
          owner_name_on_title: params.owner_name,
          odometer_status: params.odometer_status,
          odometer_value: params.odometer_value,
          document_id: params.document_id
        },
        when: {
          title_issue_date: params.issue_date,
          recorded: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          source: 'title_scan'
        },
        why: {
          reason: 'Legal document recorded',
          context: 'Vehicle title issuance recorded from scanned document',
          edit_source: 'verification_update'
        }
      };

      const eventData: TimelineEventData = {
        vehicle_id: vehicleId,
        event_type: 'title_issued',
        source: 'nuke_platform',
        event_date: params.issue_date,
        title: 'Title Issued',
        description: params.owner_name
          ? `Title issued to ${params.owner_name}`
          : 'Title issuance recorded',
        confidence_score: 85,
        metadata
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (error) {
        console.error('Error creating title issued timeline event:', error);
      }
    } catch (error) {
      console.error('Error in createTitleIssuedEvent:', error);
    }
  }

  static async createDocumentUploadEvent(
    vehicleId: string,
    documentMetadata: {
      fileName: string;
      fileSize: number;
      documentUrl: string;
      uploadDate: Date;
      category: string;
    },
    userId?: string
  ): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      const metadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          is_owner: userId === user?.id,
          user_role: user?.user_metadata?.role || 'user'
        },
        what: {
          action: 'document_upload',
          file_name: documentMetadata.fileName,
          file_size: documentMetadata.fileSize,
          document_category: documentMetadata.category,
          file_type: documentMetadata.fileName.split('.').pop()?.toLowerCase(),
        },
        when: {
          uploaded: new Date().toISOString(),
          document_date: documentMetadata.uploadDate.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          user_agent: navigator.userAgent,
          location: 'web_app'
        },
        why: {
          reason: 'Vehicle documentation',
          context: `Document uploaded to vehicle profile - ${documentMetadata.category}`,
          source: 'document_upload'
        }
      };

      const eventData: any = {
        vehicle_id: vehicleId,
        user_id: user?.id,
        event_type: 'document_added',
        source: 'user_upload',
        event_date: new Date(documentMetadata.uploadDate).toISOString().split('T')[0],
        title: `Document Added: ${documentMetadata.category}`,
        description: `${documentMetadata.fileName} uploaded as ${documentMetadata.category} documentation`,
        metadata
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (error) {
        console.error('Error creating document upload timeline event:', error);
      }
    } catch (error) {
      console.error('Error in createDocumentUploadEvent:', error);
    }
  }

  /**
   * Create a single timeline event for a batch of photos (work session)
   */
  static async createPhotoSessionEvent(
    vehicleId: string,
    photos: Array<{
      fileName: string;
      fileSize: number;
      imageUrl: string;
      dateTaken?: Date;
      gps?: any;
    }>,
    userId?: string
  ): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      // Use earliest photo date for event date
      const photoDate = photos[0]?.dateTaken || new Date();
      const eventDate = photoDate.toISOString();

      // Check if photos have GPS data
      const photosWithGPS = photos.filter(p => p.gps?.latitude && p.gps?.longitude);
      const hasLocation = photosWithGPS.length > 0;

      const title = hasLocation 
        ? `Photo Session (${photos.length} photos) with Location`
        : `Photo Session (${photos.length} photos)`;
      
      const description = `Batch upload of ${photos.length} photos${hasLocation ? ` (${photosWithGPS.length} with GPS data)` : ''}`;

      const metadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          is_owner: userId === user?.id,
          user_role: user?.user_metadata?.role || 'user'
        },
        what: {
          action: 'photo_session_upload',
          source: 'batch_upload',
          photo_count: photos.length,
          total_size: photos.reduce((sum, p) => sum + p.fileSize, 0),
          has_gps_data: hasLocation,
          gps_photo_count: photosWithGPS.length
        },
        when: {
          photo_taken: photoDate.toISOString(),
          uploaded: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          coordinates: hasLocation ? photosWithGPS[0].gps : null,
          user_agent: navigator.userAgent,
          location: 'web_app'
        },
        why: {
          reason: 'Vehicle documentation',
          context: 'Batch photo upload session',
          source: 'batch_upload'
        }
      };

      const eventData: any = {
        vehicle_id: vehicleId,
        user_id: user?.id,
        event_type: 'photo_session',
        source: 'user_upload',
        event_date: new Date(eventDate).toISOString().split('T')[0],
        title,
        description,
        metadata,
        documentation_urls: photos.map(p => p.imageUrl)
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (error) {
        console.error('Error creating photo session timeline event:', error);
      }
    } catch (error) {
      console.error('Error in createPhotoSessionEvent:', error);
    }
  }

  static async createImageUploadEvent(
    vehicleId: string,
    imageMetadata: any,
    userId?: string
  ): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      // Extract meaningful data from EXIF for timeline event
      // Prefer explicit dateTaken, then EXIF DateTimeOriginal/dateTime, else now
      const rawDate = imageMetadata?.dateTaken || imageMetadata?.DateTimeOriginal || imageMetadata?.dateTime;
      const eventDate = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();

      // Determine event title based on available metadata
      let title = 'Photo Added';
      let description = 'Vehicle photo uploaded';
      
      if (imageMetadata.gpsDecimal) {
        title = 'Photo Added with Location';
        description = `Vehicle photo taken at coordinates ${imageMetadata.gpsDecimal.latitude.toFixed(4)}, ${imageMetadata.gpsDecimal.longitude.toFixed(4)}`;
      }
      
      if (imageMetadata.camera) {
        description += ` using ${imageMetadata.camera}`;
        if (imageMetadata.cameraModel) {
          description += ` ${imageMetadata.cameraModel}`;
        }
      }

      const metadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          is_owner: userId === user?.id,
          user_role: user?.user_metadata?.role || 'user'
        },
        what: {
          action: 'image_upload',
          source: imageMetadata?.source || 'web_upload',
          file_name: imageMetadata.fileName,
          file_size: imageMetadata.fileSize,
          camera_info: {
            make: imageMetadata.camera,
            model: imageMetadata.cameraModel,
            settings: {
              iso: imageMetadata.iso,
              focal_length: imageMetadata.focalLength,
              aperture: imageMetadata.aperture,
              shutter_speed: imageMetadata.shutterSpeed
            }
          },
          location: imageMetadata.gpsDecimal,
          image_dimensions: {
            width: imageMetadata.imageWidth,
            height: imageMetadata.imageHeight
          },
          exif: {
            date_taken: imageMetadata?.dateTaken || null,
            date_time: imageMetadata?.dateTime || null,
            orientation: imageMetadata?.orientation || null,
            color_space: imageMetadata?.colorSpace || null
          }
        },
        when: {
          photo_taken: imageMetadata?.dateTaken || imageMetadata?.dateTime,
          uploaded: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          coordinates: imageMetadata.gpsDecimal,
          user_agent: navigator.userAgent,
          location: 'web_app'
        },
        why: {
          reason: 'Vehicle documentation',
          context: 'Photo uploaded to vehicle profile',
          source: 'image_upload'
        }
      };

      const eventData: any = {
        vehicle_id: vehicleId,
        user_id: user?.id,
        event_type: 'photo_added',
        source: 'user_upload',
        event_date: new Date(eventDate).toISOString().split('T')[0], // Date only format
        title,
        description,
        metadata
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (error) {
        console.error('Error creating image upload timeline event (timeline_events):', error);
      }
    } catch (error) {
      console.error('Error in createImageUploadEvent:', error);
    }
  }


  static async createVehicleCreationEvent(
    vehicleId: string,
    vehicleData: any,
    initialImages?: string[]
  ): Promise<void> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      const metadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          is_creator: true,
          user_role: 'creator'
        },
        what: {
          action: 'vehicle_creation',
          vehicle_info: {
            make: vehicleData.make,
            model: vehicleData.model,
            year: vehicleData.year,
            vin: vehicleData.vin,
            color: vehicleData.color,
            mileage: vehicleData.mileage
          },
          initial_images_count: initialImages?.length || 0
        },
        when: {
          created_at: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          user_agent: navigator.userAgent,
          location: 'web_app'
        },
        why: {
          reason: 'Vehicle profile created',
          context: 'Initial vehicle registration in system',
          significance: 'high'
        }
      };

      const eventData: any = {
        vehicle_id: vehicleId,
        user_id: user?.id,
        event_type: 'vehicle_created',
        source: 'user_input',
        event_date: new Date().toISOString().split('T')[0], // Date only format
        title: 'Vehicle Profile Created',
        description: `${vehicleData.year} ${vehicleData.make} ${vehicleData.model} profile created${initialImages?.length ? ` with ${initialImages.length} photo${initialImages.length > 1 ? 's' : ''}` : ''}`,
        confidence_score: 100,
        metadata,
        documentation_urls: initialImages || []
      };

      const { error: createErr } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (createErr) {
        console.error('Error creating vehicle creation timeline event (timeline_events):', createErr);
      }
    } catch (error) {
      console.error('Error in createVehicleCreationEvent:', error);
    }
  }

  static async createVehicleEditEvent(
    vehicleId: string,
    oldVehicleData: any,
    newVehicleData: any,
    userId?: string,
    editContext?: {
      reason?: string;
      source?: 'manual_edit' | 'bulk_import' | 'ai_correction' | 'verification_update';
    }
  ): Promise<void> {
    try {
      // Get current user info
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      // Determine what fields changed
      const changedFields: string[] = [];
      const oldValues: Record<string, any> = {};
      const newValues: Record<string, any> = {};

      // Compare all fields (support both camelCase and snake_case for visibility)
      const fieldsToCheck = [
        'make', 'model', 'year', 'vin', 'color', 'mileage', 'condition',
        'description', 'price', 'location', 'isPublic', 'is_public', 'tags'
      ];

      fieldsToCheck.forEach(field => {
        // Normalize visibility comparison
        const oldVal = field === 'isPublic' ? (oldVehicleData.isPublic ?? oldVehicleData.is_public) : oldVehicleData[field];
        const newVal = field === 'isPublic' ? (newVehicleData.isPublic ?? newVehicleData.is_public) : newVehicleData[field];
        if (oldVal !== newVal) {
          changedFields.push(field);
          oldValues[field] = oldVal;
          newValues[field] = newVal;
        }
      });

      if (changedFields.length === 0) {
        return; // No changes to track
      }

      // Create change summary
      const changeSummary = changedFields.map(field => {
        const oldVal = oldValues[field] || 'empty';
        const newVal = newValues[field] || 'empty';
        return `${field}: "${oldVal}" → "${newVal}"`;
      }).join(', ');

      // Build metadata
      const metadata: VehicleEditMetadata = {
        who: {
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.user_metadata?.full_name || user?.email?.split('@')[0],
          is_owner: userId === user?.id,
          user_role: user?.user_metadata?.role || 'user'
        },
        what: {
          action: 'vehicle_edit',
          fields_changed: changedFields,
          old_values: oldValues,
          new_values: newValues,
          change_summary: changeSummary
        },
        when: {
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        where: {
          user_agent: navigator.userAgent,
          location: 'web_app'
        },
        why: {
          reason: editContext?.reason || 'User initiated edit',
          context: `Vehicle information updated via ${editContext?.source || 'manual_edit'}`,
          edit_source: editContext?.source || 'manual_edit'
        }
      };

      // Create timeline event
      const eventData: any = {
        vehicle_id: vehicleId,
        event_type: 'vehicle_edit',
        source: 'user_input',
        event_date: new Date().toISOString().split('T')[0],
        title: `Vehicle Information Updated`,
        description: `Updated ${changedFields.length} field${changedFields.length > 1 ? 's' : ''}: ${changedFields.join(', ')}`,
        confidence_score: 100,
        metadata
      };

      const { error } = await supabase
        .from('timeline_events')
        .insert([eventData]);

      if (error) {
        console.error('Error creating timeline event:', error);
      }
    } catch (error) {
      console.error('Error in createVehicleEditEvent:', error);
    }
  }

  static async updateTimelineEvent(
    eventId: string,
    updates: {
      title?: string;
      description?: string;
      event_date?: string;
      metadata?: any;
    },
    userId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // First check if user is the creator
      const { data: event, error: fetchError } = await supabase
        .from('timeline_events')
        .select('metadata')
        .eq('id', eventId)
        .single();

      if (fetchError || !event) {
        return { success: false, error: 'Event not found' };
      }

      // Check if user is the creator
      if (event.metadata?.who?.user_id !== userId) {
        return { success: false, error: 'Only the event creator can edit this event' };
      }

      // Update the event
      const { error: updateError } = await supabase
        .from('timeline_events')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', eventId);

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating timeline event:', error);
      return { success: false, error: 'Failed to update event' };
    }
  }
}
