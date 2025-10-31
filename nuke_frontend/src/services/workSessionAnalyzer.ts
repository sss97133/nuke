import { supabase } from '../lib/supabase';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

interface ImageGroup {
  images: Array<{
    id: string;
    image_url: string;
    taken_at: string;
    category?: string;
  }>;
  startTime: Date;
  endTime: Date;
  vehicleId: string;
  userId: string;
}

interface WorkSessionAnalysis {
  title: string;
  description: string;
  workType: string; // 'repair', 'restoration', 'maintenance', 'modification', 'inspection'
  components: string[]; // parts/systems worked on
  estimatedHours?: number;
  confidence: number;
}

/**
 * Intelligent Work Session Analyzer
 * 
 * Instead of creating individual "Photo Added" events, this service:
 * 1. Groups images uploaded in the same session (same day, close time window)
 * 2. Uses AI to analyze what work was actually performed
 * 3. Creates ONE meaningful timeline event with all images attached
 */
export class WorkSessionAnalyzer {
  
  /**
   * Analyze a batch of newly uploaded images and create intelligent work session event
   */
  static async analyzeAndCreateWorkSession(
    vehicleId: string,
    imageIds: string[],
    userId: string
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    try {
      // 1. Fetch image data
      const { data: images, error: fetchError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, taken_at, category, variants')
        .in('id', imageIds)
        .eq('vehicle_id', vehicleId);

      if (fetchError || !images || images.length === 0) {
        return { success: false, error: 'Failed to fetch images' };
      }

      // 2. Group images by time window (within 4 hours = same work session)
      const groups = this.groupImagesBySession(images, vehicleId, userId);

      // 3. For each group, analyze and create work session event
      const results = await Promise.all(
        groups.map(group => this.processWorkSessionGroup(group))
      );

      const successfulEvents = results.filter(r => r.success);
      
      return {
        success: successfulEvents.length > 0,
        eventId: successfulEvents[0]?.eventId,
        error: successfulEvents.length === 0 ? 'Failed to create work sessions' : undefined
      };

    } catch (error: any) {
      console.error('Work session analysis failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Group images by upload session (same day, within 4 hour window)
   */
  private static groupImagesBySession(
    images: any[],
    vehicleId: string,
    userId: string
  ): ImageGroup[] {
    if (images.length === 0) return [];

    // Sort by taken_at time
    const sorted = [...images].sort((a, b) => 
      new Date(a.taken_at || a.created_at).getTime() - 
      new Date(b.taken_at || b.created_at).getTime()
    );

    const groups: ImageGroup[] = [];
    let currentGroup: ImageGroup | null = null;

    for (const img of sorted) {
      const imgTime = new Date(img.taken_at || img.created_at);

      if (!currentGroup) {
        // Start new group
        currentGroup = {
          images: [img],
          startTime: imgTime,
          endTime: imgTime,
          vehicleId,
          userId
        };
      } else {
        const timeDiff = imgTime.getTime() - currentGroup.endTime.getTime();
        const fourHoursMs = 4 * 60 * 60 * 1000;

        if (timeDiff <= fourHoursMs) {
          // Add to current group
          currentGroup.images.push(img);
          currentGroup.endTime = imgTime;
        } else {
          // Finalize current group, start new one
          groups.push(currentGroup);
          currentGroup = {
            images: [img],
            startTime: imgTime,
            endTime: imgTime,
            vehicleId,
            userId
          };
        }
      }
    }

    // Add final group
    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Process a group of images: analyze with AI and create work session event
   */
  private static async processWorkSessionGroup(
    group: ImageGroup
  ): Promise<{ success: boolean; eventId?: string }> {
    try {
      // 1. Analyze images with AI
      const analysis = await this.analyzeWorkSession(group);

      if (!analysis) {
        // Fallback: create generic photo upload event
        return await this.createGenericPhotoEvent(group);
      }

      // 2. Create timeline event with AI-generated title and description
      const { data: event, error: eventError } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: group.vehicleId,
          user_id: group.userId,
          event_type: 'work_session',
          title: analysis.title,
          description: analysis.description,
          event_date: group.startTime.toISOString().split('T')[0],
          metadata: {
            work_type: analysis.workType,
            components: analysis.components,
            estimated_hours: analysis.estimatedHours,
            confidence: analysis.confidence,
            image_count: group.images.length,
            session_duration_hours: (group.endTime.getTime() - group.startTime.getTime()) / (1000 * 60 * 60)
          }
        })
        .select('id')
        .single();

      if (eventError) {
        console.error('Failed to create timeline event:', eventError);
        return { success: false };
      }

      // 3. Link all images to this single event
      const imageUpdates = group.images.map(img => ({
        id: img.id,
        timeline_event_id: event.id,
        // Clear any old "photo added" events these might have been linked to
        event_id: event.id
      }));

      await supabase
        .from('vehicle_images')
        .upsert(imageUpdates, { onConflict: 'id' });

      // 4. Delete old individual "Photo Added" events for these images
      await this.cleanupOldPhotoEvents(group.images.map(i => i.id));

      return { success: true, eventId: event.id };

    } catch (error) {
      console.error('Error processing work session group:', error);
      return { success: false };
    }
  }

  /**
   * Use OpenAI Vision to analyze what work was performed
   */
  private static async analyzeWorkSession(
    group: ImageGroup
  ): Promise<WorkSessionAnalysis | null> {
    try {
      // Use medium-sized variants for AI analysis (balance quality vs cost)
      const imageUrls = group.images.map(img => 
        img.variants?.medium || img.variants?.large || img.image_url
      ).slice(0, 10); // Limit to 10 images for cost control

      const prompt = `You are analyzing photos from a vehicle restoration/repair session. 
Look at these ${group.images.length} photos and determine:
1. What work was performed? (be specific but concise)
2. What vehicle components/systems were worked on?
3. What type of work: repair, restoration, maintenance, modification, or inspection?
4. Roughly how many hours of work does this represent?

Respond in JSON format:
{
  "title": "Brief title (e.g., 'Interior seat restoration' or 'Engine bay cleaning')",
  "description": "1-2 sentence description of the work performed",
  "workType": "repair|restoration|maintenance|modification|inspection",
  "components": ["component1", "component2"],
  "estimatedHours": 2.5,
  "confidence": 0.85
}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...imageUrls.map(url => ({
                type: 'image_url' as const,
                image_url: { url, detail: 'low' as const }
              }))
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.3 // Lower temperature for more factual analysis
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const analysis: WorkSessionAnalysis = JSON.parse(jsonMatch[0]);
      return analysis;

    } catch (error) {
      console.error('AI analysis failed:', error);
      return null;
    }
  }

  /**
   * Fallback: create generic photo upload event if AI fails
   */
  private static async createGenericPhotoEvent(
    group: ImageGroup
  ): Promise<{ success: boolean; eventId?: string }> {
    try {
      const { data: event, error } = await supabase
        .from('timeline_events')
        .insert({
          vehicle_id: group.vehicleId,
          user_id: group.userId,
          event_type: 'documentation',
          title: `${group.images.length} photos uploaded`,
          description: `Batch upload of ${group.images.length} photos`,
          event_date: group.startTime.toISOString().split('T')[0],
          metadata: {
            image_count: group.images.length,
            session_duration_hours: (group.endTime.getTime() - group.startTime.getTime()) / (1000 * 60 * 60)
          }
        })
        .select('id')
        .single();

      if (error) return { success: false };

      // Link images to event
      await supabase
        .from('vehicle_images')
        .update({ timeline_event_id: event.id, event_id: event.id })
        .in('id', group.images.map(i => i.id));

      return { success: true, eventId: event.id };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Clean up old individual "Photo Added" events
   */
  private static async cleanupOldPhotoEvents(imageIds: string[]): Promise<void> {
    try {
      // Find timeline events that were auto-created for these images
      const { data: oldEvents } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('event_type', 'user_upload')
        .ilike('title', '%Photo Added%')
        .in('metadata->>image_id', imageIds);

      if (oldEvents && oldEvents.length > 0) {
        await supabase
          .from('timeline_events')
          .delete()
          .in('id', oldEvents.map(e => e.id));
      }
    } catch (error) {
      console.warn('Failed to cleanup old photo events:', error);
    }
  }

  /**
   * Reprocess existing "Photo Added" events into intelligent work sessions
   * Run this as a one-time migration to clean up existing timeline
   */
  static async reprocessExistingPhotoEvents(vehicleId: string): Promise<{
    success: boolean;
    sessionsCreated: number;
    eventsRemoved: number;
  }> {
    try {
      // 1. Get all images for this vehicle
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('id, image_url, taken_at, created_at, user_id, category, variants')
        .eq('vehicle_id', vehicleId)
        .order('taken_at', { ascending: true });

      if (!images || images.length === 0) {
        return { success: true, sessionsCreated: 0, eventsRemoved: 0 };
      }

      // 2. Group by user and session
      const userGroups = this.groupByUser(images);
      let sessionsCreated = 0;

      for (const [userId, userImages] of Object.entries(userGroups)) {
        const sessionGroups = this.groupImagesBySession(userImages as any[], vehicleId, userId);
        
        for (const group of sessionGroups) {
          const result = await this.processWorkSessionGroup(group);
          if (result.success) sessionsCreated++;
        }
      }

      // 3. Delete all old "Photo Added" events for this vehicle
      const { data: oldEvents } = await supabase
        .from('timeline_events')
        .select('id')
        .eq('vehicle_id', vehicleId)
        .eq('event_type', 'user_upload')
        .ilike('title', '%Photo Added%');

      let eventsRemoved = 0;
      if (oldEvents && oldEvents.length > 0) {
        const { error } = await supabase
          .from('timeline_events')
          .delete()
          .in('id', oldEvents.map(e => e.id));
        
        if (!error) eventsRemoved = oldEvents.length;
      }

      return { success: true, sessionsCreated, eventsRemoved };

    } catch (error) {
      console.error('Reprocessing failed:', error);
      return { success: false, sessionsCreated: 0, eventsRemoved: 0 };
    }
  }

  private static groupByUser(images: any[]): Record<string, any[]> {
    return images.reduce((acc, img) => {
      const userId = img.user_id || 'unknown';
      if (!acc[userId]) acc[userId] = [];
      acc[userId].push(img);
      return acc;
    }, {} as Record<string, any[]>);
  }
}

