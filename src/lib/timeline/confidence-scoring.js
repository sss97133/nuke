/**
 * Confidence Scoring System for Vehicle Timeline Events
 * 
 * Calculates confidence scores for vehicle data from various sources
 * Used by the multi-source connector framework to resolve conflicting data
 */

/**
 * Calculate a confidence score based on various factors
 * 
 * @param {Object} options - Options for calculating the confidence score
 * @param {number} options.baseScore - Base confidence score (0.0-1.0)
 * @param {Object} options.factors - Factors affecting confidence (each 0.0-1.0)
 * @returns {number} Final confidence score (0.0-1.0)
 */
export function calculateConfidenceScore({ baseScore = 0.5, factors = {} }) {
  // Start with the base score
  let score = baseScore;
  
  // Sum of all factor values
  const factorSum = Object.values(factors).reduce((sum, value) => sum + value, 0);
  
  // Apply factors to adjust the base score
  score += factorSum;
  
  // Ensure the score is within valid range (0.0-1.0)
  return Math.max(0.0, Math.min(1.0, score));
}

/**
 * Resolves conflicting data from multiple sources based on confidence scores
 * 
 * @param {Array} events - Array of timeline events with the same event_type
 * @returns {Object} The event with the highest confidence score
 */
export function resolveConflictingEvents(events) {
  if (!events || events.length === 0) {
    return null;
  }
  
  if (events.length === 1) {
    return events[0];
  }
  
  // Sort events by confidence score (descending)
  const sortedEvents = [...events].sort((a, b) => 
    (b.confidence_score || 0) - (a.confidence_score || 0)
  );
  
  // Return the event with the highest confidence score
  return sortedEvents[0];
}

/**
 * Recalculates confidence scores for timeline events
 * Useful when new data is added or existing data is updated
 * 
 * @param {Array} events - Array of timeline events to recalculate
 * @param {Object} sourceWeights - Weights for different sources
 * @returns {Array} Events with recalculated confidence scores
 */
export function recalculateConfidenceScores(events, sourceWeights = {}) {
  if (!events || events.length === 0) {
    return [];
  }
  
  return events.map(event => {
    // Factors that affect confidence
    const factors = {
      // Source reliability weight
      sourceWeight: sourceWeights[event.source] || 0.5,
      
      // Data completeness factors
      hasMetadata: event.metadata && Object.keys(event.metadata).length > 0 ? 0.1 : 0,
      hasImages: event.image_urls && event.image_urls.length > 0 ? 0.1 : 0,
      hasDescription: event.description && event.description.length > 20 ? 0.1 : 0,
      
      // Age of the data (newer data is more reliable)
      recency: isRecent(event.event_date) ? 0.1 : 0
    };
    
    // Start with a base score that depends on the event type
    const baseScore = getBaseScoreForEventType(event.event_type);
    
    // Calculate new confidence score
    const newScore = calculateConfidenceScore({
      baseScore,
      factors
    });
    
    // Return updated event with new confidence score
    return {
      ...event,
      confidence_score: newScore
    };
  });
}

/**
 * Determines if a date is recent (within the last 90 days)
 * 
 * @param {string} dateString - ISO date string
 * @returns {boolean} Whether the date is recent
 */
function isRecent(dateString) {
  if (!dateString) return false;
  
  const date = new Date(dateString);
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
  
  return date >= ninetyDaysAgo;
}

/**
 * Get a base confidence score for a specific event type
 * 
 * @param {string} eventType - Type of timeline event
 * @returns {number} Base confidence score
 */
function getBaseScoreForEventType(eventType) {
  // Different event types have different base reliability
  const eventTypeScores = {
    'manufacture': 0.9,        // Manufacture data is highly reliable
    'purchase': 0.8,           // Purchase records are reliable
    'service': 0.75,           // Service records are quite reliable
    'listing': 0.6,            // Listings are moderately reliable
    'discovery': 0.6,          // Discoveries are moderately reliable
    'modification': 0.7,       // Modifications are fairly reliable
    'ownership_change': 0.75,  // Ownership changes are reliable
    'valuation': 0.65,         // Valuations are moderately reliable
    'accident': 0.7,           // Accident reports are fairly reliable
    'recall': 0.9,             // Recall information is highly reliable
    'import_export': 0.8,      // Import/export records are reliable
    'registration': 0.85,      // Registration data is very reliable
    'inspection': 0.8,         // Inspection records are reliable
    'mileage': 0.7,            // Mileage reports are fairly reliable
    'auction': 0.75,           // Auction results are reliable
    'insurance': 0.8,          // Insurance records are reliable
    'theft': 0.8,              // Theft reports are reliable
    'restoration': 0.7,        // Restoration records are fairly reliable
    'award': 0.6,              // Awards are moderately reliable
    'racing': 0.7,             // Racing history is fairly reliable
    'media_appearance': 0.6,   // Media appearances are moderately reliable
    'museum_display': 0.8,     // Museum displays are reliable
  };
  
  // Return the score for the event type, or default to 0.5
  return eventTypeScores[eventType] || 0.5;
}
