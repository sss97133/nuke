/**
 * Base Connector for the Multi-Source Connector Framework
 * 
 * Provides the standardized interface for all vehicle data source connectors
 * Each connector must implement fetch, transform, validate, and save methods
 */

/**
 * BaseConnector class
 * Abstract base class for all data source connectors
 */
export class BaseConnector {
  /**
   * Create a new connector
   * @param {string} name - The name of the connector
   */
  constructor(name) {
    if (this.constructor === BaseConnector) {
      throw new Error('BaseConnector is an abstract class and cannot be instantiated directly');
    }
    
    this.name = name;
  }
  
  /**
   * Fetch data from the source
   * @param {Object} params - Parameters for fetching data
   * @returns {Promise<Array>} Raw data from the source
   */
  async fetch(params) {
    throw new Error('Method fetch() must be implemented by subclass');
  }
  
  /**
   * Transform raw data into standardized timeline events
   * @param {Array} rawData - Raw data from the source
   * @returns {Array} Transformed timeline events
   */
  transform(rawData) {
    throw new Error('Method transform() must be implemented by subclass');
  }
  
  /**
   * Validate transformed data before saving
   * @param {Array} transformedData - Transformed timeline events
   * @returns {Array} Validated timeline events
   */
  validate(transformedData) {
    throw new Error('Method validate() must be implemented by subclass');
  }
  
  /**
   * Save validated data to the timeline
   * @param {Array} validatedData - Validated timeline events
   * @returns {Promise<Object>} Result of the save operation
   */
  async save(validatedData) {
    throw new Error('Method save() must be implemented by subclass');
  }
  
  /**
   * Process data through the complete pipeline
   * @param {Object} params - Processing parameters
   * @returns {Promise<Object>} Processing results
   */
  async process(params) {
    try {
      const rawData = await this.fetch(params);
      const transformedData = this.transform(rawData);
      const validatedData = this.validate(transformedData);
      const saveResult = await this.save(validatedData);
      
      return {
        source: this.name,
        rawCount: rawData.length,
        transformedCount: transformedData.length,
        validatedCount: validatedData.length,
        savedCount: saveResult.inserted,
        errors: saveResult.errors
      };
    } catch (error) {
      console.error(`Error processing data for connector ${this.name}:`, error);
      return {
        source: this.name,
        rawCount: 0,
        transformedCount: 0,
        validatedCount: 0,
        savedCount: 0,
        errors: [error]
      };
    }
  }
}
