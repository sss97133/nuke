/**
 * Shared Data Primitives
 * Core data structures used across the entire application
 */

/**
 * Vehicle Primitive
 * Single source of truth for vehicle data structure
 */
class Vehicle {
  constructor(data = {}) {
    // Required fields
    this.id = data.id || null;
    this.vin = data.vin || null;
    this.make = data.make || null;
    this.model = data.model || null;
    this.year = data.year || null;
    
    // Optional fields
    this.user_id = data.user_id || null;
    this.mileage = data.mileage || null;
    this.price = data.price || null;
    this.exterior_color = data.exterior_color || null;
    this.interior_color = data.interior_color || null;
    this.engine = data.engine || null;
    this.transmission = data.transmission || null;
    this.drivetrain = data.drivetrain || null;
    this.stock_number = data.stock_number || null;
    this.title = data.title || null;
    this.description = data.description || null;
    this.notes = data.notes || {};
    
    // Metadata
    this.created_at = data.created_at || new Date().toISOString();
    this.updated_at = data.updated_at || null;
    this.source = data.source || null;
    this.confidence = data.confidence || {};
  }
  
  // Validation
  validate() {
    const errors = [];
    if (!this.vin) errors.push('VIN is required');
    if (!this.make) errors.push('Make is required');
    if (!this.model) errors.push('Model is required');
    if (!this.year) errors.push('Year is required');
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  // Serialization
  toDatabase() {
    return {
      vin: this.vin,
      make: this.make,
      model: this.model,
      year: this.year,
      user_id: this.user_id,
      mileage: this.mileage,
      price: this.price,
      exterior_color: this.exterior_color,
      interior_color: this.interior_color,
      engine: this.engine,
      transmission: this.transmission,
      drivetrain: this.drivetrain,
      stock_number: this.stock_number,
      notes: this.notes
    };
  }
  
  toDisplay() {
    return {
      title: this.title || `${this.year} ${this.make} ${this.model}`,
      subtitle: `VIN: ${this.vin}`,
      details: {
        mileage: this.mileage,
        price: this.price,
        color: this.exterior_color
      }
    };
  }
}

/**
 * Timeline Event Primitive
 */
class TimelineEvent {
  constructor(data = {}) {
    this.id = data.id || null;
    this.user_id = data.user_id || null;
    this.event_type = data.event_type || null;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.metadata = data.metadata || {};
    this.vehicle_id = data.vehicle_id || null;
    this.related_event_id = data.related_event_id || null;
  }
  
  static TYPES = {
    SEARCH: 'search',
    VIEW: 'view',
    SAVE: 'save',
    COMPARE: 'compare',
    CONTACT: 'contact',
    PURCHASE: 'purchase',
    EXTRACTION: 'extraction'
  };
  
  toDatabase() {
    return {
      user_id: this.user_id,
      event_type: this.event_type,
      timestamp: this.timestamp,
      metadata: this.metadata,
      vehicle_id: this.vehicle_id,
      related_event_id: this.related_event_id
    };
  }
}

/**
 * User Profile Primitive
 */
class UserProfile {
  constructor(data = {}) {
    this.id = data.id || null;
    this.email = data.email || null;
    this.username = data.username || null;
    this.stats = {
      total_vehicles: data.total_vehicles || 0,
      total_searches: data.total_searches || 0,
      total_contributions: data.total_contributions || 0
    };
    this.preferences = data.preferences || {};
    this.created_at = data.created_at || null;
  }
}

// Export for both Node and Browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Vehicle, TimelineEvent, UserProfile };
} else if (typeof window !== 'undefined') {
  window.DataPrimitives = { Vehicle, TimelineEvent, UserProfile };
}
