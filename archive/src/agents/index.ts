/**
 * Main entry point for the agent system
 * Exports all available agents and utilities
 */

// Core agent framework
export * from './core/Agent';
export * from './core/Memory';
export * from './core/Tool';
export * from './core/Reasoner';
export * from './core/types';

// Document processing agent
export * from './documentProcessing/DocumentProcessingAgent';
export * from './documentProcessing/types';

// Service for managing agent operations
import { DocumentProcessingAgent } from './documentProcessing/DocumentProcessingAgent';

/**
 * Agent service for creating and managing agents
 */
export class AgentService {
  private documentProcessingAgent: DocumentProcessingAgent | null = null;
  
  /**
   * Initialize the agent service with API keys
   * @param openAiApiKey OpenAI API key for agent reasoning
   */
  constructor(private openAiApiKey: string) {}
  
  /**
   * Get or create document processing agent
   */
  getDocumentProcessingAgent(): DocumentProcessingAgent {
    if (!this.documentProcessingAgent) {
      this.documentProcessingAgent = new DocumentProcessingAgent(this.openAiApiKey);
    }
    return this.documentProcessingAgent;
  }
  
  /**
   * Process a document asynchronously
   * @param documentId Document ID to process
   * @param vehicleId Optional vehicle ID
   */
  async processDocumentAsync(documentId: string, vehicleId?: string): Promise<void> {
    // Start processing in a non-blocking way
    setTimeout(async () => {
      try {
        const agent = this.getDocumentProcessingAgent();
        await agent.process({ documentId, vehicleId });
      } catch (error) {
        console.error('Async document processing failed:', error);
      }
    }, 0);
  }
  
  /**
   * Process a document and wait for results
   * @param documentId Document ID to process
   * @param vehicleId Optional vehicle ID
   */
  async processDocument(documentId: string, vehicleId?: string): Promise<any> {
    const agent = this.getDocumentProcessingAgent();
    return agent.process({ documentId, vehicleId });
  }
}