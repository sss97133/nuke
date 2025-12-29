/**
 * CAMERA POSITION OUTPUT MODULE
 * 
 * Converts AI-detected angles to proper 3D camera positions.
 * Uses spherical coordinates (azimuth, elevation, distance) which can
 * be converted to Cartesian (x, y, z) relative to vehicle center.
 * 
 * COORDINATE SYSTEM:
 * - Origin: Center of vehicle (computed from factory LxWxH)
 * - Azimuth: 0° = front, 90° = driver side, 180° = rear, 270° = passenger
 * - Elevation: 0° = level, positive = above vehicle
 * - Distance: mm from vehicle/subject center
 */

interface CameraPosition {
  // Subject being photographed
  subject_key: string;
  
  // Spherical coordinates
  azimuth_deg: number;
  elevation_deg: number;
  distance_mm: number;
  
  // Cartesian coordinates (computed from spherical)
  camera_x_mm: number;
  camera_y_mm: number;
  camera_z_mm: number;
  
  // Confidence in this position (0-1)
  confidence: number;
  
  // Whether this needs re-analysis
  needs_reanalysis: boolean;
}

/**
 * Map detected angle labels to camera positions.
 * Returns proper 3D coordinates based on the angle label and any additional context.
 */
export function angleToCameraPosition(
  angle_label: string,
  ai_confidence: number = 0.5,
  additional_context?: {
    is_close_up?: boolean;
    is_full_vehicle?: boolean;
    detected_side?: 'driver' | 'passenger' | 'unknown';
    detected_position?: 'front' | 'rear' | 'side' | 'unknown';
  }
): CameraPosition {
  const ctx = additional_context || {};
  const label = (angle_label || '').toLowerCase().replace(/[_\s]+/g, '_');
  
  // Default values
  let azimuth = 45;  // Front three-quarter (ambiguous)
  let elevation = 15;
  let distance = 8000;  // ~8m for full vehicle
  let subject = 'vehicle';
  let confidence = Math.min(ai_confidence, 0.5); // Cap at 50% for label-derived
  let needs_reanalysis = true;
  
  // ============================================================
  // EXTERIOR FULL VEHICLE SHOTS
  // ============================================================
  if (label.includes('front') && !label.includes('interior') && !label.includes('suspension')) {
    elevation = 15;
    distance = 8000;
    subject = 'vehicle';
    
    if (label.includes('straight') || label === 'front' || label === 'exterior_front') {
      azimuth = 0;
      confidence = ai_confidence * 0.8;
      needs_reanalysis = false;
    } else if (label.includes('quarter') || label.includes('three_quarter')) {
      if (label.includes('driver') || ctx.detected_side === 'driver') {
        azimuth = 45;
        confidence = ai_confidence * 0.9;
        needs_reanalysis = false;
      } else if (label.includes('passenger') || ctx.detected_side === 'passenger') {
        azimuth = 315;
        confidence = ai_confidence * 0.9;
        needs_reanalysis = false;
      } else {
        // Ambiguous - could be either side
        azimuth = 45;  // Assume driver (more common)
        confidence = ai_confidence * 0.3;  // Very low confidence
        needs_reanalysis = true;
      }
    }
  }
  
  // Rear shots
  else if (label.includes('rear') && !label.includes('interior') && !label.includes('suspension')) {
    elevation = 15;
    distance = 8000;
    subject = 'vehicle';
    
    if (label.includes('straight') || label === 'rear' || label === 'exterior_rear') {
      azimuth = 180;
      confidence = ai_confidence * 0.8;
      needs_reanalysis = false;
    } else if (label.includes('quarter') || label.includes('three_quarter')) {
      if (label.includes('driver') || ctx.detected_side === 'driver') {
        azimuth = 135;
        confidence = ai_confidence * 0.9;
        needs_reanalysis = false;
      } else if (label.includes('passenger') || ctx.detected_side === 'passenger') {
        azimuth = 225;
        confidence = ai_confidence * 0.9;
        needs_reanalysis = false;
      } else {
        azimuth = 135;  // Assume driver
        confidence = ai_confidence * 0.3;
        needs_reanalysis = true;
      }
    }
  }
  
  // Side/Profile shots
  else if (label.includes('profile') || label.includes('side')) {
    elevation = 8;
    distance = 8000;
    subject = 'vehicle';
    
    if (label.includes('driver') || ctx.detected_side === 'driver') {
      azimuth = 90;
      confidence = ai_confidence * 0.9;
      needs_reanalysis = false;
    } else if (label.includes('passenger') || ctx.detected_side === 'passenger') {
      azimuth = 270;
      confidence = ai_confidence * 0.9;
      needs_reanalysis = false;
    } else {
      // Exterior side with unknown which side
      azimuth = 90;  // Assume driver
      confidence = ai_confidence * 0.3;
      needs_reanalysis = true;
    }
  }
  
  // ============================================================
  // ENGINE BAY
  // ============================================================
  else if (label.includes('engine')) {
    subject = 'engine.bay';
    distance = 1500;
    
    if (label.includes('full') || label === 'engine_bay' || label === 'engine') {
      azimuth = 0;
      elevation = 60;
      confidence = ai_confidence * 0.8;
      needs_reanalysis = false;
    } else if (label.includes('driver')) {
      azimuth = 70;
      elevation = 45;
      confidence = ai_confidence * 0.8;
      needs_reanalysis = false;
    } else if (label.includes('passenger')) {
      azimuth = 290;
      elevation = 45;
      confidence = ai_confidence * 0.8;
      needs_reanalysis = false;
    } else if (label.includes('component') || label.includes('detail')) {
      azimuth = 0;
      elevation = 45;
      distance = 800;
      confidence = ai_confidence * 0.5;
      needs_reanalysis = true;
    } else {
      azimuth = 0;
      elevation = 55;
      confidence = ai_confidence * 0.6;
      needs_reanalysis = false;
    }
  }
  
  // ============================================================
  // INTERIOR
  // ============================================================
  else if (label.includes('interior') || label.includes('dash') || label.includes('seat')) {
    distance = 800;
    
    if (label.includes('dashboard') || label.includes('dash')) {
      subject = 'interior.dashboard';
      azimuth = 0;
      elevation = -30;
      confidence = ai_confidence * 0.8;
      needs_reanalysis = false;
    } else if (label.includes('driver_seat') || label.includes('driver seat')) {
      subject = 'interior.seat.front.driver';
      azimuth = 90;
      elevation = 0;
      distance = 700;
      confidence = ai_confidence * 0.7;
      needs_reanalysis = false;
    } else if (label.includes('passenger_seat') || label.includes('passenger seat')) {
      subject = 'interior.seat.front.passenger';
      azimuth = 270;
      elevation = 0;
      distance = 700;
      confidence = ai_confidence * 0.7;
      needs_reanalysis = false;
    } else if (label.includes('rear') || label.includes('back')) {
      subject = 'interior.seat.rear';
      azimuth = 180;
      elevation = 0;
      distance = 900;
      confidence = ai_confidence * 0.7;
      needs_reanalysis = false;
    } else if (label.includes('door')) {
      subject = 'interior.door.panel.front.driver';
      azimuth = 90;
      elevation = 0;
      distance = 500;
      confidence = ai_confidence * 0.6;
      needs_reanalysis = true;  // Which door?
    } else {
      // Generic interior
      subject = 'interior.cabin';
      azimuth = 0;
      elevation = -15;
      distance = 1000;
      confidence = ai_confidence * 0.4;
      needs_reanalysis = true;
    }
  }
  
  // ============================================================
  // UNDERCARRIAGE
  // ============================================================
  else if (label.includes('undercarriage') || label.includes('frame') || label.includes('suspension')) {
    subject = 'undercarriage';
    distance = 1500;
    elevation = -45;
    
    if (label.includes('front')) {
      azimuth = 0;
      elevation = -30;
      confidence = ai_confidence * 0.7;
    } else if (label.includes('rear')) {
      azimuth = 180;
      elevation = -30;
      confidence = ai_confidence * 0.7;
    } else if (label.includes('driver')) {
      azimuth = 90;
      elevation = -50;
      confidence = ai_confidence * 0.6;
    } else if (label.includes('passenger')) {
      azimuth = 270;
      elevation = -50;
      confidence = ai_confidence * 0.6;
    } else {
      // Generic undercarriage
      azimuth = 0;
      elevation = -45;
      confidence = ai_confidence * 0.4;
      needs_reanalysis = true;
    }
    needs_reanalysis = needs_reanalysis || confidence < 0.5;
  }
  
  // ============================================================
  // DETAIL SHOTS (USELESS WITHOUT MORE INFO)
  // ============================================================
  else if (label.includes('detail') || label.includes('close')) {
    // Detail shots are USELESS for positioning without knowing WHAT they're showing
    subject = 'vehicle';  // Unknown subject
    azimuth = 45;
    elevation = 15;
    distance = 600;  // Assume close-up
    confidence = ai_confidence * 0.1;  // Very low confidence
    needs_reanalysis = true;  // MUST re-analyze
  }
  
  // ============================================================
  // VAGUE/UNKNOWN (USELESS)
  // ============================================================
  else if (label === 'exterior' || label === 'exterior_three_quarter' || label === 'unknown') {
    // These labels tell us almost nothing
    subject = 'vehicle';
    azimuth = 45;  // Guess
    elevation = 15;
    distance = 8000;
    confidence = ai_confidence * 0.1;  // Very low
    needs_reanalysis = true;
  }
  
  // ============================================================
  // DOCUMENTS (not spatial)
  // ============================================================
  else if (label.includes('vin') || label.includes('receipt') || label.includes('title') || label.includes('document')) {
    subject = 'document';
    azimuth = 0;
    elevation = -90;  // Looking straight down
    distance = 400;
    confidence = ai_confidence * 0.9;
    needs_reanalysis = false;
  }
  
  // ============================================================
  // FALLBACK
  // ============================================================
  else {
    // Unknown label
    needs_reanalysis = true;
    confidence = Math.min(ai_confidence * 0.2, 0.2);
  }
  
  // Convert spherical to Cartesian
  const { x, y, z } = sphericalToCartesian(azimuth, elevation, distance);
  
  return {
    subject_key: subject,
    azimuth_deg: azimuth,
    elevation_deg: elevation,
    distance_mm: distance,
    camera_x_mm: x,
    camera_y_mm: y,
    camera_z_mm: z,
    confidence: confidence,
    needs_reanalysis: needs_reanalysis,
  };
}

/**
 * Convert spherical coordinates to Cartesian.
 * Azimuth: 0° = front (-Y), 90° = driver side (-X), 180° = rear (+Y), 270° = passenger (+X)
 */
function sphericalToCartesian(
  azimuth_deg: number,
  elevation_deg: number,
  distance_mm: number
): { x: number; y: number; z: number } {
  const az_rad = azimuth_deg * Math.PI / 180;
  const el_rad = elevation_deg * Math.PI / 180;
  
  const horiz_dist = distance_mm * Math.cos(el_rad);
  
  return {
    x: Math.round(-horiz_dist * Math.sin(az_rad)),  // -X = driver side
    y: Math.round(-horiz_dist * Math.cos(az_rad)),  // -Y = front
    z: Math.round(distance_mm * Math.sin(el_rad)),  // +Z = up
  };
}

/**
 * Get the OpenAI prompt addition for requesting camera position data.
 * Add this to any image analysis prompt to get proper coordinates.
 */
export function getCameraPositionPromptAddition(): string {
  return `

CAMERA POSITION:
In addition to your analysis, estimate the camera position relative to the vehicle center.

COORDINATE SYSTEM:
- Azimuth (0-360°): 0° = looking at vehicle front, 90° = driver side, 180° = rear, 270° = passenger side
- Elevation (-90 to 90°): 0° = eye level with vehicle center, positive = above, negative = below
- Distance: estimated distance from camera to main subject in meters

Include in your response:
{
  "camera_position": {
    "subject": "what the camera is focused on (e.g., vehicle, engine.bay, interior.dashboard, wheel.front.driver)",
    "azimuth_deg": number,
    "elevation_deg": number,
    "distance_m": number,
    "position_confidence": number (0-1)
  }
}
`;
}

