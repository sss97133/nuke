/**
 * Photo Coaching — Real-time feedback for technician photo submissions
 *
 * Evaluates photo quality, coverage, and timing to generate
 * actionable coaching messages appended to SMS responses.
 *
 * Rules:
 * 1. Photo too blurry (quality ≤ 2) → "Can you retake with better light?"
 * 2. Have before but no after (>4 hrs) → "Got an after shot?"
 * 3. All photos same zone → "Can you get the other side too?"
 * 4. Low stage confidence → "Get closer to the surface"
 * 5. No angle match to prior → "Try to match the same angle as your earlier shot"
 */

export interface PhotoCoachingContext {
  /** Current photo analysis results */
  currentPhoto: {
    photoQuality: number;        // 1-5
    vehicleZone: string | null;
    fabricationStage: string | null;
    stageConfidence: number | null;
    zoneConfidence: number | null;
  };
  /** Recent session photos for this vehicle */
  sessionPhotos?: {
    zones: string[];             // zones covered in this session
    stages: string[];            // stages observed
    oldestPhotoAge: number;      // minutes since oldest photo in session
    photoCount: number;
  };
  /** Prior photos of same zone (for angle matching) */
  priorZonePhotos?: {
    count: number;
    lastPhotoAge: number;        // minutes since last photo of this zone
    hadBefore: boolean;          // was there a "before" state photo?
  };
}

export interface CoachingMessage {
  type: string;
  priority: number;              // 1=high, 2=medium, 3=low
  message: string;
  emoji?: string;
}

/**
 * Evaluate a photo submission and generate coaching messages.
 * Returns messages sorted by priority (most important first).
 */
export function evaluatePhotoCoaching(ctx: PhotoCoachingContext): CoachingMessage[] {
  const messages: CoachingMessage[] = [];

  // Rule 1: Photo too blurry
  if (ctx.currentPhoto.photoQuality <= 2) {
    messages.push({
      type: "blurry_photo",
      priority: 1,
      message: "This one's a bit blurry — can you retake it with better lighting or steadier hands?",
    });
  }

  // Rule 2: Before but no after (stale session)
  if (
    ctx.priorZonePhotos?.hadBefore &&
    ctx.priorZonePhotos.lastPhotoAge > 240 && // >4 hours
    ctx.currentPhoto.fabricationStage !== null
  ) {
    messages.push({
      type: "missing_after",
      priority: 1,
      message: "Nice progress! Got an after shot of this area? That before/after pair is gold for the estimate.",
    });
  }

  // Rule 3: All photos same zone
  if (
    ctx.sessionPhotos &&
    ctx.sessionPhotos.photoCount >= 3 &&
    ctx.sessionPhotos.zones.length === 1
  ) {
    const zone = ctx.sessionPhotos.zones[0];
    const otherSideHint = getOtherSideHint(zone);
    if (otherSideHint) {
      messages.push({
        type: "single_zone_coverage",
        priority: 2,
        message: `Great shots of this area. ${otherSideHint}`,
      });
    }
  }

  // Rule 4: Low stage confidence
  if (
    ctx.currentPhoto.stageConfidence !== null &&
    ctx.currentPhoto.stageConfidence < 0.5
  ) {
    messages.push({
      type: "low_stage_confidence",
      priority: 2,
      message: "Hard to tell the surface condition — can you get a closer shot of the finish?",
    });
  }

  // Rule 5: Low zone confidence
  if (
    ctx.currentPhoto.zoneConfidence !== null &&
    ctx.currentPhoto.zoneConfidence < 0.4
  ) {
    messages.push({
      type: "low_zone_confidence",
      priority: 3,
      message: "Tip: Back up a bit so I can tell which part of the car this is.",
    });
  }

  // Rule 6: Good photo acknowledgment (positive reinforcement)
  if (
    ctx.currentPhoto.photoQuality >= 4 &&
    ctx.currentPhoto.stageConfidence !== null &&
    ctx.currentPhoto.stageConfidence >= 0.8 &&
    messages.length === 0
  ) {
    messages.push({
      type: "good_photo",
      priority: 3,
      message: "Great shot — clear and easy to analyze.",
    });
  }

  // Sort by priority
  messages.sort((a, b) => a.priority - b.priority);

  return messages;
}

/**
 * Format coaching messages for SMS (max 1-2 messages to avoid spam).
 * Returns empty string if no coaching needed.
 */
export function formatCoachingForSms(messages: CoachingMessage[]): string {
  if (messages.length === 0) return "";

  // Only include highest priority messages, max 2
  const topMessages = messages.slice(0, 2);

  return "\n\n" + topMessages.map(m => m.message).join("\n");
}

/**
 * Get a hint for covering the other side/area of the vehicle.
 */
function getOtherSideHint(zone: string): string | null {
  const hints: Record<string, string> = {
    "ext_driver_side": "Can you grab the passenger side too?",
    "ext_passenger_side": "Can you grab the driver side too?",
    "ext_front": "Don't forget a shot from the back!",
    "ext_rear": "Don't forget a shot from the front!",
    "panel_fender_fl": "Can you get the right side fender too?",
    "panel_fender_fr": "Can you get the left side fender too?",
    "panel_fender_rl": "Can you get the other rear quarter?",
    "panel_fender_rr": "Can you get the other rear quarter?",
    "panel_door_fl": "Can you get the passenger door too?",
    "panel_door_fr": "Can you get the driver door too?",
    "int_front_seats": "Grab a shot of the rear seats too if you can.",
    "int_dashboard": "Can you get the rear interior too?",
  };

  return hints[zone] || null;
}

/**
 * Check if a photo gap nudge should be sent.
 * Returns true if the last submission for any assigned vehicle is >4 hours ago.
 */
export function shouldSendPhotoGapNudge(
  lastSubmissionAt: Date | null,
  hasActiveVehicles: boolean,
): boolean {
  if (!hasActiveVehicles) return false;
  if (!lastSubmissionAt) return true; // never submitted

  const hoursSince = (Date.now() - lastSubmissionAt.getTime()) / (60 * 60 * 1000);
  return hoursSince > 4;
}

/**
 * Generate a photo gap nudge message.
 */
export function generatePhotoGapNudge(
  techName: string | null,
  vehicleName: string | null,
  hoursSinceLastPhoto: number,
): string {
  const name = techName || "Hey";
  const vehicle = vehicleName || "the project";

  if (hoursSinceLastPhoto > 24) {
    return `${name}, haven't seen photos of ${vehicle} in a while. Send a progress shot when you get a chance!`;
  }

  return `${name}, how's ${vehicle} coming along? A quick photo helps us track the hours.`;
}
