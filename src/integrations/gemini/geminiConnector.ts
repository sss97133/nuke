// Using the vehicle types from the project
interface VehicleData {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  trim?: string;
  color?: string;
  mileage?: number;
  data_source?: string;
  confidence?: number;
  additional_details?: Record<string, unknown>;
  last_updated?: string;
  [key: string]: unknown;
}

interface TimelineEventData {
  id: string;
  vehicle_id: string;
  event_type: string;
  event_date: string;
  description: string;
  data_source: string;
  confidence: number;
  details?: Record<string, unknown>;
}

// Define configuration options for Gemini API calls
interface GeminiOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  maxOutputTokens?: number;
}

import { ConnectorInterface } from '@/types/connectors';

/**
 * Gemini 2.5 Connector
 * 
 * This connector integrates with Google's Gemini 2.5 API to provide AI-enhanced 
 * vehicle data processing capabilities:
 * 
 * 1. Vehicle data enrichment - augmenting existing vehicle information
 * 2. Smart timeline generation - synthesizing logical timeline events
 * 3. Confidence scoring - evaluate and score multi-source data
 * 4. Vehicle description generation - create comprehensive descriptions
 */
export class GeminiConnector implements ConnectorInterface {
  private apiKey: string;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private model = 'models/gemini-1.5-pro-latest';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * Main method to fetch data from Gemini by sending a structured prompt
   */
  private async fetchFromGemini(prompt: string, options: GeminiOptions = {}) {
    try {
      const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt }
              ]
            }
          ],
          generationConfig: {
            temperature: options.temperature || 0.2,
            topK: options.topK || 40,
            topP: options.topP || 0.95,
            maxOutputTokens: options.maxOutputTokens || 1024,
          }
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini API error: ${error}`);
      }
      
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Error fetching from Gemini:', error);
      throw error;
    }
  }
  
  /**
   * Enrich vehicle data with additional context and information
   */
  async enrichVehicleData(vehicle: VehicleData): Promise<VehicleData> {
    const vehicleDetails = `
      Make: ${vehicle.make}
      Model: ${vehicle.model}
      Year: ${vehicle.year}
      VIN: ${vehicle.vin || 'Not provided'}
      Color: ${vehicle.color || 'Not provided'}
      Trim: ${vehicle.trim || 'Not provided'}
    `;
    
    const prompt = `
      You are an automotive expert. Enrich the following vehicle information with additional
      technical specifications, historically accurate details, and notable facts.
      
      Vehicle information:
      ${vehicleDetails}
      
      Return your response in a valid JSON format with the following fields:
      - additional_specs: Object containing technical specifications
      - historical_context: String with historical context about this model
      - notable_features: Array of strings listing notable features
      - market_position: String describing the vehicle's position in the market
      - estimated_value_factors: Array of factors that impact this vehicle's value
      
      Keep your response precise, factual, and historically accurate.
    `;
    
    try {
      const enrichmentText = await this.fetchFromGemini(prompt);
      const enrichment = JSON.parse(enrichmentText);
      
      // Create a new vehicle object with enriched data
      return {
        ...vehicle,
        additional_details: {
          ...vehicle.additional_details,
          ...enrichment
        },
        confidence: 0.85, // Gemini-enriched data confidence level
        data_source: 'gemini_ai'
      };
    } catch (error) {
      console.error('Error enriching vehicle data:', error);
      return vehicle;
    }
  }
  
  /**
   * Generate synthetic timeline events based on vehicle data
   */
  async generateSmartTimeline(vehicle: VehicleData): Promise<TimelineEventData[]> {
    const prompt = `
      Generate a historically plausible timeline for the following vehicle:
      
      Make: ${vehicle.make}
      Model: ${vehicle.model}
      Year: ${vehicle.year}
      VIN: ${vehicle.vin || 'Not provided'}
      
      Create a JSON array of 5-8 timeline events that follow this structure:
      [
        {
          "id": "generated-event-1", // Use unique IDs
          "vehicle_id": "${vehicle.id}",
          "event_type": "maintenance|ownership|recall|award|modification",
          "event_date": "YYYY-MM-DDTHH:MM:SSZ", // ISO format, historically accurate
          "description": "Detailed event description",
          "data_source": "gemini_ai",
          "confidence": 0.7, // Number between 0-1
          "details": {
            // Additional details specific to the event type
          }
        },
        // More events...
      ]
      
      The timeline should:
      1. Be historically accurate (events must match the vehicle's era)
      2. Include diverse event types (maintenance, ownership changes, etc.)
      3. Follow a logical chronological order
      4. Include realistic details
      
      Return ONLY the JSON array, no additional text.
    `;
    
    try {
      const timelineText = await this.fetchFromGemini(prompt);
      const timeline = JSON.parse(timelineText);
      
      return Array.isArray(timeline) ? timeline : [];
    } catch (error) {
      console.error('Error generating smart timeline:', error);
      return [];
    }
  }
  
  /**
   * Evaluate confidence scores for conflicting vehicle data from multiple sources
   */
  async evaluateConfidence(vehicleData: VehicleData[], field: string): Promise<{ 
    recommendedValue: unknown; 
    confidence: number;
    reasoning: string;
  }> {
    const conflictingData = vehicleData.map(v => ({
      value: v[field as keyof VehicleData],
      source: v.data_source,
      confidence: v.confidence
    }));
    
    const prompt = `
      You are an automotive data expert. Evaluate these conflicting data points for a vehicle's ${field}:
      ${JSON.stringify(conflictingData, null, 2)}
      
      Analyze the conflicts and determine:
      1. Which value is most likely correct
      2. A confidence score (0-1) for your determination
      3. Your reasoning for this determination
      
      Return your response as a JSON object with these fields:
      {
        "recommendedValue": <the value you determine is most likely correct>,
        "confidence": <your confidence score as a number>,
        "reasoning": <brief explanation of your reasoning>
      }
    `;
    
    try {
      const evaluationText = await this.fetchFromGemini(prompt);
      return JSON.parse(evaluationText);
    } catch (error) {
      console.error('Error evaluating confidence:', error);
      
      // Fallback to the highest confidence item
      const highestConfidenceItem = vehicleData.reduce((prev, current) => 
        (current.confidence || 0) > (prev.confidence || 0) ? current : prev, vehicleData[0]);
      
      return {
        recommendedValue: highestConfidenceItem[field as keyof VehicleData],
        confidence: highestConfidenceItem.confidence || 0.5,
        reasoning: "Fallback to highest confidence source due to Gemini processing error"
      };
    }
  }
  
  /**
   * Generate a comprehensive vehicle description
   */
  async generateVehicleDescription(vehicle: VehicleData): Promise<string> {
    const prompt = `
      Create a detailed, engaging description for this vehicle:
      
      Make: ${vehicle.make}
      Model: ${vehicle.model}
      Year: ${vehicle.year}
      VIN: ${vehicle.vin || 'Not provided'}
      Color: ${vehicle.color || 'Not provided'}
      Trim: ${vehicle.trim || 'Not provided'}
      
      The description should:
      1. Highlight historically significant aspects of this make/model/year
      2. Mention technical specifications in an accessible way
      3. Describe what makes this vehicle special or notable
      4. Be engaging and informative for automotive enthusiasts
      5. Be factually accurate and 2-3 paragraphs in length
      
      Return only the description text, no additional formatting.
    `;
    
    try {
      return await this.fetchFromGemini(prompt);
    } catch (error) {
      console.error('Error generating vehicle description:', error);
      return `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    }
  }
}

/**
 * Create a singleton instance of the Gemini connector
 */
let geminiConnectorInstance: GeminiConnector | null = null;

export const getGeminiConnector = (): GeminiConnector => {
  if (!geminiConnectorInstance) {
    // Get API key from environment variables with fallback chain
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || 
                  process.env.VITE_GEMINI_API_KEY || 
                  window.__env?.VITE_GEMINI_API_KEY || 
                  '';
                  
    if (!apiKey) {
      console.warn('Gemini API key not found in environment variables');
    }
    
    geminiConnectorInstance = new GeminiConnector(apiKey);
  }
  
  return geminiConnectorInstance;
};
