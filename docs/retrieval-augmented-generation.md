# Retrieval Augmented Generation (RAG) for Vehicle-Centric Architecture

## Overview

Retrieval Augmented Generation (RAG) is a technique that enhances AI responses by providing them with real-time access to authentic data sources. In Nuke's vehicle-centric architecture, implementing RAG ensures that all AI interactions are grounded in real vehicle data rather than fabricated information, maintaining our core principle of never using mock data.

## Benefits for Vehicle Data Management

1. **Enhanced Accuracy**: All AI responses are based on actual vehicle records, providing factually correct information about specific vehicles.
2. **Temporal Awareness**: Access to timeline-based vehicle history allows for context-aware responses that understand the full lifecycle of a vehicle.
3. **Data Sovereignty**: Vehicle owners maintain control over their data while still enabling AI-powered insights.
4. **Confidence Scoring**: RAG systems can apply our multi-source confidence scoring to determine which vehicle data sources are most trustworthy.

## Technical Implementation

### 1. Vector Database Integration

```sql
-- Example: Create vector table for vehicle descriptions
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE vehicle_embeddings (
    id UUID PRIMARY KEY REFERENCES vehicles(id),
    description_embedding vector(1536),
    history_embedding vector(1536),
    spec_embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for semantic search
CREATE INDEX vehicle_embedding_idx ON vehicle_embeddings 
USING ivfflat (description_embedding vector_cosine_ops) WITH (lists = 100);
```

### 2. Embedding Generation Pipeline

```typescript
// src/services/embeddings/VehicleEmbeddingService.ts

import { createClient } from '@supabase/supabase-js';
import { Database } from '../../types/supabase';
import { getEmbedding } from '../ai/embeddingProvider';

export class VehicleEmbeddingService {
  private supabase = createClient<Database>(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_SERVICE_KEY!
  );

  async generateEmbeddingsForVehicle(vehicleId: string): Promise<void> {
    // Fetch vehicle data
    const { data: vehicle, error } = await this.supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (error || !vehicle) {
      throw new Error(`Failed to retrieve vehicle: ${error?.message}`);
    }

    // Generate embeddings for different aspects of the vehicle
    const descriptionText = this.createDescriptionText(vehicle);
    const historyText = await this.getVehicleHistoryText(vehicleId);
    const specText = this.createSpecificationsText(vehicle);

    // Get embeddings from AI service
    const descriptionEmbedding = await getEmbedding(descriptionText);
    const historyEmbedding = await getEmbedding(historyText);
    const specEmbedding = await getEmbedding(specText);

    // Store embeddings
    const { error: upsertError } = await this.supabase
      .from('vehicle_embeddings')
      .upsert({
        id: vehicleId,
        description_embedding: descriptionEmbedding,
        history_embedding: historyEmbedding,
        spec_embedding: specEmbedding,
        updated_at: new Date().toISOString()
      });

    if (upsertError) {
      throw new Error(`Failed to store embeddings: ${upsertError.message}`);
    }
  }

  private createDescriptionText(vehicle: any): string {
    // Combine relevant vehicle attributes into a comprehensive description
    return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim} with VIN ${vehicle.vin}. ${vehicle.description}`;
  }

  private async getVehicleHistoryText(vehicleId: string): Promise<string> {
    // Fetch vehicle timeline events
    const { data: events } = await this.supabase
      .from('vehicle_timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('timestamp', { ascending: true });

    // Format events into text
    return events
      ? events
          .map(event => `[${new Date(event.timestamp).toLocaleDateString()}] ${event.event_type}: ${event.description}`)
          .join('\n')
      : 'No recorded history.';
  }

  private createSpecificationsText(vehicle: any): string {
    // Format vehicle specifications into text
    return `${vehicle.year} ${vehicle.make} ${vehicle.model}. Engine: ${vehicle.engine}. Transmission: ${vehicle.transmission}. Mileage: ${vehicle.mileage} miles. Color: ${vehicle.exterior_color}. VIN: ${vehicle.vin}.`;
  }
}
```

### 3. Retrieval System

```typescript
// src/services/ai/VehicleRAGService.ts

import { createClient } from '@supabase/supabase-js';
import { Database } from '../../types/supabase';
import { getEmbedding } from './embeddingProvider';

export class VehicleRAGService {
  private supabase = createClient<Database>(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_SERVICE_KEY!
  );

  async retrieveSimilarVehicles(query: string, limit: number = 5): Promise<any[]> {
    // Generate embedding for the query
    const queryEmbedding = await getEmbedding(query);

    // Search for similar vehicles using vector similarity
    const { data, error } = await this.supabase.rpc('match_vehicles', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: limit
    });

    if (error) {
      throw new Error(`Failed to retrieve similar vehicles: ${error.message}`);
    }

    return data || [];
  }

  async retrieveVehicleContext(vehicleId: string, query: string): Promise<string> {
    // Generate embedding for the query
    const queryEmbedding = await getEmbedding(query);

    // Retrieve the most relevant context for this vehicle based on the query
    const { data: vehicle } = await this.supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicleId)
      .single();

    const { data: embedding } = await this.supabase
      .from('vehicle_embeddings')
      .select('*')
      .eq('id', vehicleId)
      .single();

    if (!vehicle || !embedding) {
      throw new Error('Vehicle or embeddings not found');
    }

    // Determine which aspect of the vehicle is most relevant to the query
    // by comparing cosine similarity with each embedding
    const similarities = {
      description: this.cosineSimilarity(queryEmbedding, embedding.description_embedding),
      history: this.cosineSimilarity(queryEmbedding, embedding.history_embedding),
      specs: this.cosineSimilarity(queryEmbedding, embedding.spec_embedding)
    };

    // Get the most relevant aspect
    const mostRelevantAspect = Object.entries(similarities)
      .sort((a, b) => b[1] - a[1])[0][0];

    // Return the appropriate context based on what's most relevant
    switch (mostRelevantAspect) {
      case 'description':
        return this.getVehicleDescription(vehicle);
      case 'history':
        return await this.getVehicleHistory(vehicleId);
      case 'specs':
        return this.getVehicleSpecifications(vehicle);
      default:
        return this.getVehicleOverview(vehicle);
    }
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    // Calculate cosine similarity between two vectors
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private getVehicleDescription(vehicle: any): string {
    // Format vehicle description
    return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}. ${vehicle.description}`;
  }

  private async getVehicleHistory(vehicleId: string): Promise<string> {
    // Fetch vehicle timeline events
    const { data: events } = await this.supabase
      .from('vehicle_timeline_events')
      .select('*')
      .eq('vehicle_id', vehicleId)
      .order('timestamp', { ascending: true });

    // Format events into text
    return events && events.length > 0
      ? `Vehicle History:\n${events
          .map(event => `[${new Date(event.timestamp).toLocaleDateString()}] ${event.event_type}: ${event.description}`)
          .join('\n')}`
      : 'No recorded history for this vehicle.';
  }

  private getVehicleSpecifications(vehicle: any): string {
    // Format vehicle specifications
    return `Vehicle Specifications:
Year: ${vehicle.year}
Make: ${vehicle.make}
Model: ${vehicle.model}
Trim: ${vehicle.trim}
Engine: ${vehicle.engine}
Transmission: ${vehicle.transmission}
Mileage: ${vehicle.mileage} miles
Exterior Color: ${vehicle.exterior_color}
Interior Color: ${vehicle.interior_color}
VIN: ${vehicle.vin}`;
  }

  private getVehicleOverview(vehicle: any): string {
    // Provide a general overview of the vehicle
    return `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim}. VIN: ${vehicle.vin}. This vehicle has ${vehicle.mileage} miles and features a ${vehicle.engine} engine with ${vehicle.transmission} transmission.`;
  }
}
```

### 4. Augmentation Logic

```typescript
// src/services/ai/VehicleAIService.ts

import { VehicleRAGService } from './VehicleRAGService';
import { GeminiConnector } from '../../integrations/gemini/geminiConnector';

export class VehicleAIService {
  private ragService = new VehicleRAGService();
  private gemini = new GeminiConnector();

  async generateAugmentedResponse(vehicleId: string, userQuery: string): Promise<string> {
    try {
      // Retrieve relevant vehicle context
      const vehicleContext = await this.ragService.retrieveVehicleContext(vehicleId, userQuery);
      
      // Construct prompt with retrieved context
      const prompt = `
I'm going to provide you with information about a specific vehicle, followed by a user's question.
Please answer the question based ONLY on the provided vehicle information.
If the information doesn't contain the answer, say "I don't have that information about this vehicle."

VEHICLE INFORMATION:
${vehicleContext}

USER QUESTION:
${userQuery}
`;

      // Generate response
      const response = await this.gemini.generateText(prompt);
      return response;
    } catch (error) {
      console.error('Error generating augmented response:', error);
      return 'Unable to provide information about this vehicle at this time.';
    }
  }

  async compareVehicles(vehicleIds: string[], comparisonAspect: string): Promise<string> {
    try {
      // Gather context for all vehicles
      const vehicleContexts = await Promise.all(
        vehicleIds.map(id => this.ragService.retrieveVehicleContext(id, comparisonAspect))
      );
      
      // Combine contexts
      const combinedContext = vehicleContexts.join('\n\n-----------\n\n');
      
      // Construct comparison prompt
      const prompt = `
I'm going to provide you with information about multiple vehicles.
Please compare them specifically focusing on: ${comparisonAspect}.
Use only the information provided and don't make assumptions about missing data.

VEHICLES:
${combinedContext}

Please provide a detailed comparison of these vehicles focusing on ${comparisonAspect}.
`;

      // Generate comparison
      return await this.gemini.generateText(prompt);
    } catch (error) {
      console.error('Error comparing vehicles:', error);
      return 'Unable to compare these vehicles at this time.';
    }
  }
}
```

## Integration with Vehicle-Centric Architecture

RAG aligns perfectly with our vehicle-centric architecture principles:

1. **Vehicles as First-Class Digital Entities**: RAG treats each vehicle's data as a distinct, queryable entity with its own unique embeddings.

2. **Timeline-Based Event Aggregation**: RAG can leverage our existing timeline structure to provide temporally-aware responses about a vehicle's history.

3. **Multi-Source Data Aggregation**: RAG can combine data from various sources while maintaining our confidence scoring system.

4. **Trust Mechanisms**: By using only verified vehicle data in our RAG system, we maintain the integrity of our PTZ verification and professional recognition systems.

## User Experience Benefits

- **Enhanced Vehicle Profiles**: AI-generated insights based on real data create more comprehensive vehicle profiles.
- **Personalized Recommendations**: More accurate vehicle suggestions based on historical interaction data.
- **Natural Language Understanding**: Users can ask complex questions about specific vehicles and receive accurate answers.
- **Confidence Transparency**: Clear indications of when information comes from verified vehicle records versus AI inference.

## Implementation Roadmap

1. **Phase 1**: Set up vector database tables and initial embedding infrastructure
2. **Phase 2**: Develop embedding pipeline for existing vehicle records
3. **Phase 3**: Implement retrieval and relevance scoring system
4. **Phase 4**: Integrate with Gemini API for generation
5. **Phase 5**: Add caching layer for frequently accessed vehicle contexts
6. **Phase 6**: Create user-facing interfaces for natural language vehicle queries
