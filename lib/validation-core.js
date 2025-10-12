/**
 * Platform-Agnostic Validation Layer
 * Shared validation logic that works in browser, Node, and tests
 */

/**
 * VIN Validator
 */
class VINValidator {
  static validate(vin) {
    if (!vin) return { valid: false, error: 'VIN is required' };
    
    // Clean VIN
    const cleaned = String(vin).toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Check length
    if (cleaned.length !== 17) {
      return { valid: false, error: 'VIN must be 17 characters' };
    }
    
    // Check for invalid characters
    if (/[IOQ]/i.test(cleaned)) {
      return { valid: false, error: 'VIN contains invalid characters (I, O, Q)' };
    }
    
    // Calculate check digit (position 9)
    const checkDigit = this.calculateCheckDigit(cleaned);
    if (cleaned[8] !== checkDigit && cleaned[8] !== 'X') {
      return { 
        valid: false, 
        error: 'Invalid check digit',
        confidence: 0.7 // Still might be valid, just non-standard
      };
    }
    
    return { 
      valid: true, 
      normalized: cleaned,
      confidence: 1.0
    };
  }
  
  static calculateCheckDigit(vin) {
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    const values = {
      'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5, 'F': 6, 'G': 7, 'H': 8,
      'J': 1, 'K': 2, 'L': 3, 'M': 4, 'N': 5, 'P': 7, 'R': 9,
      'S': 2, 'T': 3, 'U': 4, 'V': 5, 'W': 6, 'X': 7, 'Y': 8, 'Z': 9,
      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 0
    };
    
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      sum += weights[i] * (values[vin[i]] || 0);
    }
    
    const remainder = sum % 11;
    return remainder === 10 ? 'X' : String(remainder);
  }
}

/**
 * Vehicle Field Validators
 */
class FieldValidators {
  static year(value) {
    const year = parseInt(value);
    const currentYear = new Date().getFullYear();
    
    if (isNaN(year)) {
      return { valid: false, error: 'Year must be a number' };
    }
    
    if (year < 1900 || year > currentYear + 1) {
      return { valid: false, error: `Year must be between 1900 and ${currentYear + 1}` };
    }
    
    return { valid: true, normalized: year };
  }
  
  static price(value) {
    // Handle various price formats
    const cleaned = String(value).replace(/[$,]/g, '');
    const price = parseFloat(cleaned);
    
    if (isNaN(price)) {
      return { valid: false, error: 'Invalid price format' };
    }
    
    if (price < 0) {
      return { valid: false, error: 'Price cannot be negative' };
    }
    
    return { valid: true, normalized: price };
  }
  
  static mileage(value) {
    const cleaned = String(value).replace(/[,]/g, '');
    const mileage = parseInt(cleaned);
    
    if (isNaN(mileage)) {
      return { valid: false, error: 'Invalid mileage format' };
    }
    
    if (mileage < 0) {
      return { valid: false, error: 'Mileage cannot be negative' };
    }
    
    if (mileage > 1000000) {
      return { 
        valid: true, 
        normalized: mileage,
        warning: 'Unusually high mileage'
      };
    }
    
    return { valid: true, normalized: mileage };
  }
  
  static email(value) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(value)) {
      return { valid: false, error: 'Invalid email format' };
    }
    
    return { valid: true, normalized: value.toLowerCase() };
  }
}

/**
 * Composite Validator
 * Validates entire objects against schemas
 */
class CompositeValidator {
  constructor(schema) {
    this.schema = schema;
  }
  
  validate(data) {
    const results = {
      valid: true,
      errors: {},
      warnings: {},
      normalized: {}
    };
    
    for (const [field, rules] of Object.entries(this.schema)) {
      const value = data[field];
      
      // Check required
      if (rules.required && (value === null || value === undefined || value === '')) {
        results.valid = false;
        results.errors[field] = 'Field is required';
        continue;
      }
      
      // Skip optional empty fields
      if (!rules.required && !value) {
        continue;
      }
      
      // Run validator
      if (rules.validator) {
        const validation = rules.validator(value);
        
        if (!validation.valid) {
          results.valid = false;
          results.errors[field] = validation.error;
        } else {
          results.normalized[field] = validation.normalized || value;
          
          if (validation.warning) {
            results.warnings[field] = validation.warning;
          }
        }
      } else {
        results.normalized[field] = value;
      }
    }
    
    return results;
  }
}

/**
 * Predefined Schemas
 */
const schemas = {
  vehicle: {
    vin: {
      required: true,
      validator: VINValidator.validate.bind(VINValidator)
    },
    make: {
      required: true,
      validator: (v) => ({ valid: v && v.length > 0, normalized: v })
    },
    model: {
      required: true,
      validator: (v) => ({ valid: v && v.length > 0, normalized: v })
    },
    year: {
      required: true,
      validator: FieldValidators.year
    },
    price: {
      required: false,
      validator: FieldValidators.price
    },
    mileage: {
      required: false,
      validator: FieldValidators.mileage
    }
  },
  
  user: {
    email: {
      required: true,
      validator: FieldValidators.email
    },
    username: {
      required: false,
      validator: (v) => ({ 
        valid: v && v.length >= 3, 
        error: 'Username must be at least 3 characters',
        normalized: v 
      })
    }
  },
  
  extraction: {
    vin: {
      required: true,
      validator: VINValidator.validate.bind(VINValidator)
    },
    make: {
      required: true,
      validator: (v) => ({ valid: v && v.length > 0, normalized: v })
    },
    model: {
      required: true,
      validator: (v) => ({ valid: v && v.length > 0, normalized: v })
    },
    confidence: {
      required: false,
      validator: (v) => {
        const conf = parseFloat(v);
        return {
          valid: !isNaN(conf) && conf >= 0 && conf <= 1,
          error: 'Confidence must be between 0 and 1',
          normalized: conf
        };
      }
    }
  }
};

/**
 * Validation Factory
 */
class ValidationFactory {
  static createValidator(schemaName) {
    if (!schemas[schemaName]) {
      throw new Error(`Unknown schema: ${schemaName}`);
    }
    
    return new CompositeValidator(schemas[schemaName]);
  }
  
  static createCustomValidator(schema) {
    return new CompositeValidator(schema);
  }
  
  static validateVehicle(data) {
    const validator = this.createValidator('vehicle');
    return validator.validate(data);
  }
  
  static validateUser(data) {
    const validator = this.createValidator('user');
    return validator.validate(data);
  }
  
  static validateExtraction(data) {
    const validator = this.createValidator('extraction');
    return validator.validate(data);
  }
}

// Export for both Node and Browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VINValidator,
    FieldValidators,
    CompositeValidator,
    ValidationFactory,
    schemas
  };
} else if (typeof window !== 'undefined') {
  window.ValidationCore = {
    VINValidator,
    FieldValidators,
    CompositeValidator,
    ValidationFactory,
    schemas
  };
}
