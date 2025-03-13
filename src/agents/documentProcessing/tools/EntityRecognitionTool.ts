import { BaseTool, ToolResult } from '../../core/Tool';

/**
 * Tool for recognizing and extracting entities from document text
 */
export class EntityRecognitionTool extends BaseTool {
  constructor() {
    super(
      'entity_recognizer',
      'Recognizes and extracts entities like people, organizations, vehicles, and locations from text.'
    );
  }
  
  /**
   * Validate required parameters
   * @param params Parameters to validate
   */
  protected validateParams(params: any): void {
    if (!params.extractedText) {
      throw new Error('extractedText is required');
    }
  }
  
  /**
   * Extract entities from document text
   * @param params Entity recognition parameters
   */
  protected async executeImpl(params: { extractedText: string }): Promise<ToolResult> {
    try {
      const { extractedText } = params;
      
      // Extract entities from text
      const entities = {
        people: this.extractPeople(extractedText),
        organizations: this.extractOrganizations(extractedText),
        vehicles: this.extractVehicles(extractedText),
        locations: this.extractLocations(extractedText),
        dates: this.extractDates(extractedText),
        monetary: this.extractMonetaryValues(extractedText)
      };
      
      // Calculate confidence based on number of entities found
      const totalEntities = Object.values(entities).reduce(
        (sum, entityList) => sum + entityList.length, 0
      );
      
      // Higher confidence when more entities are found, but with diminishing returns
      const confidence = Math.min(0.9, 0.6 + Math.log10(totalEntities + 1) / 10);
      
      return {
        success: true,
        data: {
          entities,
          confidence
        }
      };
    } catch (error) {
      console.error('Entity recognition failed:', error);
      return {
        success: false,
        data: null,
        error: error.message
      };
    }
  }
  
  /**
   * Extract people names from text
   * @param text Document text content
   */
  private extractPeople(text: string): string[] {
    const people = new Set<string>();
    
    // Common name prefixes to help identify people
    const namePrefixes = ['Mr\.', 'Ms\.', 'Mrs\.', 'Dr\.', 'Prof\.'];
    const prefixPattern = namePrefixes.join('|');
    
    // Look for name patterns with prefixes
    const prefixRegex = new RegExp(`(${prefixPattern})\s+([A-Z][a-z]+\s+[A-Z][a-z]+)`, 'g');
    let match;
    
    while ((match = prefixRegex.exec(text)) !== null) {
      people.add(match[2].trim());
    }
    
    // Look for customer/owner/insured patterns
    const roleNameRegex = /(?:Customer|Owner|Client|Insured|Registered Owner|Policyholder):?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g;
    
    while ((match = roleNameRegex.exec(text)) !== null) {
      people.add(match[1].trim());
    }
    
    // Look for technician/inspector patterns
    const technicianRegex = /(?:Technician|Inspector|Agent):?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;
    
    while ((match = technicianRegex.exec(text)) !== null) {
      people.add(match[1].trim());
    }
    
    // Look for signature line patterns
    const signatureRegex = /(?:Signature|Signed by|Approved by):?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;
    
    while ((match = signatureRegex.exec(text)) !== null) {
      people.add(match[1].trim());
    }
    
    return Array.from(people);
  }
  
  /**
   * Extract organization names from text
   * @param text Document text content
   */
  private extractOrganizations(text: string): string[] {
    const organizations = new Set<string>();
    
    // Common organization suffixes to help identify businesses
    const orgSuffixes = ['Inc\.', 'LLC', 'Corp\.', 'Corporation', 'Ltd\.', 'Limited', 'Co\.', 'Company'];
    const suffixPattern = orgSuffixes.join('|');
    
    // Look for organization patterns with suffixes
    const suffixRegex = new RegExp(`([A-Z][A-Za-z\s&]+)\s+(${suffixPattern})`, 'g');
    let match;
    
    while ((match = suffixRegex.exec(text)) !== null) {
      organizations.add(`${match[1].trim()} ${match[2]}`);
    }
    
    // Look for auto service related businesses
    const autoBusinessRegex = /([A-Z][A-Za-z\s&]+(?:Auto|Car|Motor|Service|Repair|Mechanic|Motors))(?:\n|\s|$)/g;
    
    while ((match = autoBusinessRegex.exec(text)) !== null) {
      organizations.add(match[1].trim());
    }
    
    // Look for insurance companies
    const insuranceRegex = /([A-Z][A-Za-z\s&]+(?:Insurance|Mutual|Casualty|Assurance))(?:\n|\s|$)/g;
    
    while ((match = insuranceRegex.exec(text)) !== null) {
      organizations.add(match[1].trim());
    }
    
    // Look for DMV or government agencies
    const govAgencyRegex = /([A-Z][A-Za-z\s&]+Department of (?:Motor Vehicles|Transportation)|DMV|DOT)(?:\n|\s|$)/g;
    
    while ((match = govAgencyRegex.exec(text)) !== null) {
      organizations.add(match[1].trim());
    }
    
    return Array.from(organizations);
  }
  
  /**
   * Extract vehicle information from text
   * @param text Document text content
   */
  private extractVehicles(text: string): any[] {
    const vehicles = [];
    
    // Look for VIN patterns
    const vinRegex = /VIN:?\s*([A-HJ-NPR-Z0-9]{17})/gi;
    let match;
    
    while ((match = vinRegex.exec(text)) !== null) {
      const vin = match[1].toUpperCase();
      const vehicleInfo = { vin };
      
      // Look for year/make/model near the VIN
      const contextBefore = text.substring(Math.max(0, match.index - 100), match.index);
      const contextAfter = text.substring(match.index, Math.min(text.length, match.index + 100));
      const context = contextBefore + contextAfter;
      
      // Extract year, make, model from surrounding context
      const yearMatch = context.match(/(19|20)\d{2}/);
      if (yearMatch) vehicleInfo.year = yearMatch[0];
      
      const makeModelMatch = context.match(/(\d{4})\s+([A-Z][a-z]+)\s+([A-Z][a-zA-Z0-9\s]+)/);
      if (makeModelMatch) {
        vehicleInfo.year = vehicleInfo.year || makeModelMatch[1];
        vehicleInfo.make = makeModelMatch[2];
        vehicleInfo.model = makeModelMatch[3].trim();
      } else {
        // Try separate make and model patterns
        const makeMatch = context.match(/Make:?\s*([A-Z][a-z]+)/i);
        if (makeMatch) vehicleInfo.make = makeMatch[1];
        
        const modelMatch = context.match(/Model:?\s*([A-Z][a-zA-Z0-9\s]+)/i);
        if (modelMatch) vehicleInfo.model = modelMatch[1].trim();
      }
      
      vehicles.push(vehicleInfo);
    }
    
    // Look for make/model/year patterns even without VIN
    if (vehicles.length === 0) {
      const makeModelYearRegex = /(19|20)\d{2}\s+([A-Z][a-z]+)\s+([A-Z][a-zA-Z0-9\s]+)/g;
      
      while ((match = makeModelYearRegex.exec(text)) !== null) {
        vehicles.push({
          year: match[1],
          make: match[2],
          model: match[3].trim()
        });
      }
    }
    
    return vehicles;
  }
  
  /**
   * Extract location information from text
   * @param text Document text content
   */
  private extractLocations(text: string): any[] {
    const locations = [];
    
    // Look for address patterns
    const addressRegex = /(\d+)\s+([A-Z][a-zA-Z\s]+)(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Place|Pl|Court|Ct|Way|Parkway|Pkwy|Highway|Hwy),?\s+([A-Z][a-zA-Z\s]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g;
    let match;
    
    while ((match = addressRegex.exec(text)) !== null) {
      locations.push({
        type: 'address',
        streetNumber: match[1],
        street: match[2] + match[3], // Street name + suffix
        city: match[4].trim(),
        state: match[5],
        zip: match[6]
      });
    }
    
    // Look for city/state/zip patterns
    const cityStateZipRegex = /([A-Z][a-zA-Z\s]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g;
    
    while ((match = cityStateZipRegex.exec(text)) !== null) {
      // Check if this is part of an already found address
      const isDuplicate = locations.some(loc => 
        loc.type === 'address' && 
        loc.city === match[1].trim() && 
        loc.state === match[2] && 
        loc.zip === match[3]
      );
      
      if (!isDuplicate) {
        locations.push({
          type: 'partial_address',
          city: match[1].trim(),
          state: match[2],
          zip: match[3]
        });
      }
    }
    
    return locations;
  }
  
  /**
   * Extract dates from text
   * @param text Document text content
   */
  private extractDates(text: string): any[] {
    const dates = [];
    
    // Various date formats
    const datePatterns = [
      // MM/DD/YYYY
      { 
        regex: /(\d{1,2}[\/\-\.](\d{1,2})[\/\-\.]((?:19|20)\d{2}))/g,
        format: 'MM/DD/YYYY' 
      },
      // YYYY/MM/DD
      { 
        regex: /(((?:19|20)\d{2})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2}))/g,
        format: 'YYYY/MM/DD' 
      },
      // Month DD, YYYY
      { 
        regex: /((January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2}))/g,
        format: 'Month DD, YYYY' 
      }
    ];
    
    // Look for date contexts
    const dateContexts = [
      { label: 'Issued Date', pattern: /Issue[d]?\s+Date:?\s+([^\n]+)/i },
      { label: 'Expiration Date', pattern: /Expir(?:ation|es|y)\s+Date:?\s+([^\n]+)/i },
      { label: 'Service Date', pattern: /Service\s+Date:?\s+([^\n]+)/i },
      { label: 'Effective Date', pattern: /Effective\s+Date:?\s+([^\n]+)/i },
      { label: 'Inspection Date', pattern: /Inspection\s+Date:?\s+([^\n]+)/i },
      { label: 'Document Date', pattern: /Date:?\s+([^\n]+)/i }
    ];
    
    // Extract dates with context labels
    for (const context of dateContexts) {
      const contextMatch = text.match(context.pattern);
      if (contextMatch) {
        const dateText = contextMatch[1];
        for (const pattern of datePatterns) {
          pattern.regex.lastIndex = 0; // Reset regex state
          const dateMatch = pattern.regex.exec(dateText);
          if (dateMatch) {
            dates.push({
              date: dateMatch[1],
              format: pattern.format,
              context: context.label
            });
            break; // Found a date for this context
          }
        }
      }
    }
    
    // Extract unlabeled dates
    for (const pattern of datePatterns) {
      pattern.regex.lastIndex = 0; // Reset regex state
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        // Check if this date is already captured with context
        const isDuplicate = dates.some(d => d.date === match[1]);
        if (!isDuplicate) {
          dates.push({
            date: match[1],
            format: pattern.format
          });
        }
      }
    }
    
    return dates;
  }
  
  /**
   * Extract monetary values from text
   * @param text Document text content
   */
  private extractMonetaryValues(text: string): any[] {
    const monetaryValues = [];
    
    // Various monetary contexts
    const monetaryContexts = [
      { label: 'Total', pattern: /Total:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Subtotal', pattern: /Subtotal:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Tax', pattern: /Tax:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Fee', pattern: /Fee:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Premium', pattern: /Premium:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Price', pattern: /Price:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Cost', pattern: /Cost:?\s+\$?(\d+\.\d{2})/i },
      { label: 'Payment', pattern: /Payment:?\s+\$?(\d+\.\d{2})/i }
    ];
    
    // Extract monetary values with context labels
    for (const context of monetaryContexts) {
      const contextMatch = text.match(context.pattern);
      if (contextMatch) {
        monetaryValues.push({
          amount: parseFloat(contextMatch[1]),
          context: context.label
        });
      }
    }
    
    // Extract all other dollar amounts
    const genericMoneyRegex = /\$\s?(\d+(?:\.\d{2})?)/g;
    let match;
    
    while ((match = genericMoneyRegex.exec(text)) !== null) {
      // Check if this amount is already captured with context
      const amount = parseFloat(match[1]);
      const isDuplicate = monetaryValues.some(m => m.amount === amount);
      
      if (!isDuplicate) {
        monetaryValues.push({
          amount,
          // Try to infer context from surrounding text
          context: this.inferMonetaryContext(text.substring(Math.max(0, match.index - 20), match.index))
        });
      }
    }
    
    return monetaryValues;
  }
  
  /**
   * Infer context for a monetary value based on preceding text
   * @param precedingText Text immediately before the monetary value
   */
  private inferMonetaryContext(precedingText: string): string {
    const lowerText = precedingText.toLowerCase();
    
    if (lowerText.includes('total')) return 'Total';
    if (lowerText.includes('subtotal')) return 'Subtotal';
    if (lowerText.includes('tax')) return 'Tax';
    if (lowerText.includes('fee')) return 'Fee';
    if (lowerText.includes('premium')) return 'Premium';
    if (lowerText.includes('price')) return 'Price';
    if (lowerText.includes('cost')) return 'Cost';
    if (lowerText.includes('payment')) return 'Payment';
    if (lowerText.includes('part')) return 'Part';
    if (lowerText.includes('labor')) return 'Labor';
    if (lowerText.includes('service')) return 'Service';
    
    return 'Unknown';
  }
}