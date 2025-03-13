import { AgentService as CoreAgentService } from '@/agents';

/**
 * Service for interacting with the agent system
 */
class AgentService {
  private coreService: CoreAgentService;
  
  constructor() {
    // Get API key from environment variable
    const apiKey = process.env.OPENAI_API_KEY || '';
    
    if (!apiKey) {
      console.warn('OPENAI_API_KEY environment variable not set. Agent capabilities will be limited.');
    }
    
    this.coreService = new CoreAgentService(apiKey);
  }
  
  /**
   * Process a document asynchronously
   * @param documentId Document ID to process
   * @param vehicleId Optional vehicle ID
   */
  async processDocumentAsync(documentId: string, vehicleId?: string): Promise<void> {
    return this.coreService.processDocumentAsync(documentId, vehicleId);
  }
  
  /**
   * Process a document and wait for results
   * @param documentId Document ID to process
   * @param vehicleId Optional vehicle ID
   */
  async processDocument(documentId: string, vehicleId?: string): Promise<any> {
    return this.coreService.processDocument(documentId, vehicleId);
  }
}

// Create singleton instance
export const agentService = new AgentService();
