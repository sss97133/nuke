/**
 * Image Set Service - Professional Photo Album Management
 * Handles CRUD operations for image sets and set memberships
 */

import { supabase } from '../lib/supabase';

export interface ImageSet {
  id: string;
  vehicle_id: string;
  created_by: string;
  name: string;
  description?: string;
  color: string;
  icon?: string;
  is_primary: boolean;
  display_order: number;
  timeline_event_id?: string;
  event_date?: string;
  tags: string[];
  metadata: any;
  created_at: string;
  updated_at: string;
  image_count?: number;
}

export interface ImageSetMember {
  id: string;
  image_set_id: string;
  image_id: string;
  priority: number;
  display_order: number;
  caption?: string;
  notes?: string;
  role?: string;
  added_by: string;
  added_at: string;
  created_at: string;
  updated_at: string;
}

export class ImageSetService {
  /**
   * Get all image sets for a vehicle
   */
  static async getImageSets(vehicleId: string): Promise<ImageSet[]> {
    const { data, error } = await supabase
      .from('image_sets')
      .select(`
        *,
        image_count:image_set_members(count)
      `)
      .eq('vehicle_id', vehicleId)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching image sets:', error);
      throw error;
    }

    return (data || []).map((set: any) => ({
      ...set,
      image_count: set.image_count?.[0]?.count || 0
    }));
  }

  /**
   * Get personal albums (image sets not yet tied to a vehicle)
   */
  static async getPersonalAlbums(): Promise<ImageSet[]> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Must be logged in to load personal albums');
    }

    const userId = session.session.user.id;

    const { data, error } = await supabase
      .from('image_sets')
      .select(
        `
        *,
        image_count:image_set_members(count)
      `
      )
      .eq('user_id', userId)
      .eq('is_personal', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching personal albums:', error);
      throw error;
    }

    return (data || []).map((set: any) => ({
      ...set,
      image_count: set.image_count?.[0]?.count || 0
    }));
  }

  /**
   * Get a single image set by ID
   */
  static async getImageSet(setId: string): Promise<ImageSet | null> {
    const { data, error } = await supabase
      .from('image_sets')
      .select('*')
      .eq('id', setId)
      .single();

    if (error) {
      console.error('Error fetching image set:', error);
      return null;
    }

    return data;
  }

  /**
   * Create a new image set for a vehicle
   */
  static async createImageSet(params: {
    vehicleId: string;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    timelineEventId?: string;
    eventDate?: string;
  }): Promise<ImageSet | null> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Must be logged in to create image sets');
    }

    const { data, error } = await supabase
      .from('image_sets')
      .insert({
        vehicle_id: params.vehicleId,
        created_by: session.session.user.id,
        name: params.name,
        description: params.description,
        color: params.color || '#808080',
        icon: params.icon,
        timeline_event_id: params.timelineEventId,
        event_date: params.eventDate
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating image set:', error);
      throw error;
    }

    return data;
  }

  /**
   * Create a new personal album (not yet tied to a vehicle)
   */
  static async createPersonalAlbum(params: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  }): Promise<ImageSet | null> {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) {
      throw new Error('Must be logged in to create personal albums');
    }

    const { data, error } = await supabase
      .from('image_sets')
      .insert({
        created_by: session.session.user.id,
        user_id: session.session.user.id,
        is_personal: true,
        name: params.name,
        description: params.description,
        color: params.color || '#808080',
        icon: params.icon
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating personal album:', error);
      throw error;
    }

    return data;
  }

  /**
   * Update an existing image set
   */
  static async updateImageSet(
    setId: string,
    updates: Partial<Omit<ImageSet, 'id' | 'vehicle_id' | 'created_by' | 'created_at'>>
  ): Promise<ImageSet | null> {
    const { data, error } = await supabase
      .from('image_sets')
      .update(updates)
      .eq('id', setId)
      .select()
      .single();

    if (error) {
      console.error('Error updating image set:', error);
      throw error;
    }

    return data;
  }

  /**
   * Delete an image set
   */
  static async deleteImageSet(setId: string): Promise<boolean> {
    const { error } = await supabase
      .from('image_sets')
      .delete()
      .eq('id', setId);

    if (error) {
      console.error('Error deleting image set:', error);
      throw error;
    }

    return true;
  }

  /**
   * Get all images in a set
   */
  static async getSetImages(setId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('image_set_members')
      .select(`
        *,
        vehicle_images (*)
      `)
      .eq('image_set_id', setId)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('Error fetching set images:', error);
      throw error;
    }

    return (data || []).map(member => ({
      ...member.vehicle_images,
      membership: {
        id: member.id,
        priority: member.priority,
        display_order: member.display_order,
        caption: member.caption,
        notes: member.notes,
        role: member.role
      }
    }));
  }

  /**
   * Get all sets that contain a specific image
   */
  static async getSetsForImage(imageId: string): Promise<ImageSet[]> {
    const { data, error } = await supabase
      .from('image_set_members')
      .select(`
        image_sets (*)
      `)
      .eq('image_id', imageId);

    if (error) {
      console.error('Error fetching sets for image:', error);
      throw error;
    }

    return (data || []).map((item: any) => item.image_sets).filter(Boolean);
  }

  /**
   * Add images to a set (bulk operation)
   */
  static async addImagesToSet(setId: string, imageIds: string[]): Promise<number> {
    const { data, error } = await supabase.rpc('bulk_add_to_image_set', {
      set_id: setId,
      image_ids: imageIds
    });

    if (error) {
      console.error('Error adding images to set:', error);
      throw error;
    }

    return data || 0;
  }

  /**
   * Convert a personal album into a full vehicle profile.
   * This will create a vehicle, attach all album images to it,
   * and flip the album to a vehicle-linked image set.
   */
  static async convertPersonalAlbumToVehicle(params: {
    imageSetId: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    vin?: string;
  }): Promise<string> {
    const { data, error } = await supabase.rpc('convert_personal_album_to_vehicle', {
      p_image_set_id: params.imageSetId,
      p_year: params.year,
      p_make: params.make,
      p_model: params.model,
      p_trim: params.trim || null,
      p_vin: params.vin || null
    });

    if (error) {
      console.error('Error converting personal album to vehicle:', error);
      throw error;
    }

    return data as string;
  }

  /**
   * Remove an image from a set
   */
  static async removeImageFromSet(setId: string, imageId: string): Promise<boolean> {
    const { error } = await supabase
      .from('image_set_members')
      .delete()
      .eq('image_set_id', setId)
      .eq('image_id', imageId);

    if (error) {
      console.error('Error removing image from set:', error);
      throw error;
    }

    return true;
  }

  /**
   * Reorder images in a set
   */
  static async reorderImages(setId: string, imageIds: string[]): Promise<boolean> {
    const { error } = await supabase.rpc('reorder_image_set', {
      set_id: setId,
      image_ids: imageIds
    });

    if (error) {
      console.error('Error reordering images:', error);
      throw error;
    }

    return true;
  }

  /**
   * Update image priority globally
   */
  static async setImagePriority(imageId: string, priority: number): Promise<boolean> {
    const { error } = await supabase.rpc('set_image_priority', {
      img_id: imageId,
      new_priority: priority
    });

    if (error) {
      console.error('Error setting image priority:', error);
      throw error;
    }

    return true;
  }

  /**
   * Batch update priorities for multiple images
   */
  static async batchSetPriorities(updates: { imageId: string; priority: number }[]): Promise<boolean> {
    const promises = updates.map(({ imageId, priority }) =>
      this.setImagePriority(imageId, priority)
    );

    try {
      await Promise.all(promises);
      return true;
    } catch (error) {
      console.error('Error batch updating priorities:', error);
      throw error;
    }
  }

  /**
   * Get set count for each image (batch operation)
   */
  static async getImageSetCounts(imageIds: string[]): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('image_set_members')
      .select('image_id')
      .in('image_id', imageIds);

    if (error) {
      console.error('Error fetching image set counts:', error);
      return {};
    }

    const counts: Record<string, number> = {};
    (data || []).forEach((row: any) => {
      counts[row.image_id] = (counts[row.image_id] || 0) + 1;
    });

    return counts;
  }
}

