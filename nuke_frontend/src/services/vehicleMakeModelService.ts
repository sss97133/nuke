/**
 * Vehicle Make/Model Standardization Service
 * 
 * Provides standardized make/model data and normalization functions
 * to ensure consistent vehicle data across the platform.
 */

export interface VehicleMake {
  id: string;
  name: string;
  display_name: string;
  aliases: string[];
  country: string;
  active: boolean;
  logo_url?: string;
}

export interface VehicleModel {
  id: string;
  make_id: string;
  name: string;
  display_name: string;
  aliases: string[];
  years: {
    start: number;
    end?: number;
  };
  body_styles: string[];
  active: boolean;
}

export interface MakeModelSuggestion {
  make: VehicleMake;
  model: VehicleModel;
  confidence: number;
}

// Standardized vehicle makes with common aliases
const VEHICLE_MAKES: VehicleMake[] = [
  {
    id: 'acura',
    name: 'Acura',
    display_name: 'Acura',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'audi',
    name: 'Audi',
    display_name: 'Audi',
    aliases: [],
    country: 'Germany',
    active: true
  },
  {
    id: 'bmw',
    name: 'BMW',
    display_name: 'BMW',
    aliases: [],
    country: 'Germany',
    active: true
  },
  {
    id: 'buick',
    name: 'Buick',
    display_name: 'Buick',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'cadillac',
    name: 'Cadillac',
    display_name: 'Cadillac',
    aliases: ['CADI', 'CAD'],
    country: 'USA',
    active: true
  },
  {
    id: 'chevrolet',
    name: 'Chevrolet',
    display_name: 'Chevrolet',
    aliases: ['CHEV', 'CHEVY', 'CHEVROLET', 'CHVR'],
    country: 'USA',
    active: true
  },
  {
    id: 'chrysler',
    name: 'Chrysler',
    display_name: 'Chrysler',
    aliases: ['CHRY'],
    country: 'USA',
    active: true
  },
  {
    id: 'dodge',
    name: 'Dodge',
    display_name: 'Dodge',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'ferrari',
    name: 'Ferrari',
    display_name: 'Ferrari',
    aliases: [],
    country: 'Italy',
    active: true
  },
  {
    id: 'ford',
    name: 'Ford',
    display_name: 'Ford',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'gmc',
    name: 'GMC',
    display_name: 'GMC',
    aliases: ['GM', 'GENERAL MOTORS'],
    country: 'USA',
    active: true
  },
  {
    id: 'honda',
    name: 'Honda',
    display_name: 'Honda',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'hyundai',
    name: 'Hyundai',
    display_name: 'Hyundai',
    aliases: [],
    country: 'South Korea',
    active: true
  },
  {
    id: 'infiniti',
    name: 'Infiniti',
    display_name: 'Infiniti',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'jaguar',
    name: 'Jaguar',
    display_name: 'Jaguar',
    aliases: ['JAG'],
    country: 'UK',
    active: true
  },
  {
    id: 'jeep',
    name: 'Jeep',
    display_name: 'Jeep',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'kia',
    name: 'Kia',
    display_name: 'Kia',
    aliases: [],
    country: 'South Korea',
    active: true
  },
  {
    id: 'lamborghini',
    name: 'Lamborghini',
    display_name: 'Lamborghini',
    aliases: ['LAMBO'],
    country: 'Italy',
    active: true
  },
  {
    id: 'lexus',
    name: 'Lexus',
    display_name: 'Lexus',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'lincoln',
    name: 'Lincoln',
    display_name: 'Lincoln',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'maserati',
    name: 'Maserati',
    display_name: 'Maserati',
    aliases: [],
    country: 'Italy',
    active: true
  },
  {
    id: 'mazda',
    name: 'Mazda',
    display_name: 'Mazda',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'mercedes-benz',
    name: 'Mercedes-Benz',
    display_name: 'Mercedes-Benz',
    aliases: ['MERCEDES', 'BENZ', 'MB'],
    country: 'Germany',
    active: true
  },
  {
    id: 'mitsubishi',
    name: 'Mitsubishi',
    display_name: 'Mitsubishi',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'nissan',
    name: 'Nissan',
    display_name: 'Nissan',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'pontiac',
    name: 'Pontiac',
    display_name: 'Pontiac',
    aliases: [],
    country: 'USA',
    active: false
  },
  {
    id: 'porsche',
    name: 'Porsche',
    display_name: 'Porsche',
    aliases: [],
    country: 'Germany',
    active: true
  },
  {
    id: 'ram',
    name: 'Ram',
    display_name: 'Ram',
    aliases: ['RAM TRUCKS'],
    country: 'USA',
    active: true
  },
  {
    id: 'subaru',
    name: 'Subaru',
    display_name: 'Subaru',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'tesla',
    name: 'Tesla',
    display_name: 'Tesla',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'toyota',
    name: 'Toyota',
    display_name: 'Toyota',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'volkswagen',
    name: 'Volkswagen',
    display_name: 'Volkswagen',
    aliases: ['VW', 'VOLKS'],
    country: 'Germany',
    active: true
  },
  {
    id: 'volvo',
    name: 'Volvo',
    display_name: 'Volvo',
    aliases: [],
    country: 'Sweden',
    active: true
  },
  {
    id: 'honda',
    name: 'Honda',
    display_name: 'Honda',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'hyundai',
    name: 'Hyundai',
    display_name: 'Hyundai',
    aliases: [],
    country: 'South Korea',
    active: true
  },
  {
    id: 'infiniti',
    name: 'Infiniti',
    display_name: 'Infiniti',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'jeep',
    name: 'Jeep',
    display_name: 'Jeep',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'kia',
    name: 'Kia',
    display_name: 'Kia',
    aliases: [],
    country: 'South Korea',
    active: true
  },
  {
    id: 'lexus',
    name: 'Lexus',
    display_name: 'Lexus',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'lincoln',
    name: 'Lincoln',
    display_name: 'Lincoln',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'mazda',
    name: 'Mazda',
    display_name: 'Mazda',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'mercedes-benz',
    name: 'Mercedes-Benz',
    display_name: 'Mercedes-Benz',
    aliases: ['MERCEDES', 'BENZ', 'MB', 'MERC'],
    country: 'Germany',
    active: true
  },
  {
    id: 'nissan',
    name: 'Nissan',
    display_name: 'Nissan',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'plymouth',
    name: 'Plymouth',
    display_name: 'Plymouth',
    aliases: ['PLYM'],
    country: 'USA',
    active: false
  },
  {
    id: 'pontiac',
    name: 'Pontiac',
    display_name: 'Pontiac',
    aliases: ['PONT'],
    country: 'USA',
    active: false
  },
  {
    id: 'porsche',
    name: 'Porsche',
    display_name: 'Porsche',
    aliases: [],
    country: 'Germany',
    active: true
  },
  {
    id: 'ram',
    name: 'Ram',
    display_name: 'Ram',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'subaru',
    name: 'Subaru',
    display_name: 'Subaru',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'tesla',
    name: 'Tesla',
    display_name: 'Tesla',
    aliases: [],
    country: 'USA',
    active: true
  },
  {
    id: 'toyota',
    name: 'Toyota',
    display_name: 'Toyota',
    aliases: [],
    country: 'Japan',
    active: true
  },
  {
    id: 'volkswagen',
    name: 'Volkswagen',
    display_name: 'Volkswagen',
    aliases: ['VW', 'VOLKS'],
    country: 'Germany',
    active: true
  },
  {
    id: 'volvo',
    name: 'Volvo',
    display_name: 'Volvo',
    aliases: [],
    country: 'Sweden',
    active: true
  }
];

// Popular models for key makes (this would be much larger in production)
const VEHICLE_MODELS: VehicleModel[] = [
  // Chevrolet Models
  {
    id: 'chevrolet-suburban',
    make_id: 'chevrolet',
    name: 'Suburban',
    display_name: 'Suburban',
    aliases: ['SUBURBAN', 'BURB'],
    years: { start: 1935 },
    body_styles: ['SUV'],
    active: true
  },
  {
    id: 'chevrolet-corvette',
    make_id: 'chevrolet',
    name: 'Corvette',
    display_name: 'Corvette',
    aliases: ['VETTE', 'CORVETTE'],
    years: { start: 1953 },
    body_styles: ['Coupe', 'Convertible'],
    active: true
  },
  {
    id: 'chevrolet-k5-blazer',
    make_id: 'chevrolet',
    name: 'K5 Blazer',
    display_name: 'K5 Blazer',
    aliases: ['K5', 'BLAZER', 'K-5'],
    years: { start: 1969, end: 1991 },
    body_styles: ['SUV'],
    active: false
  },
  {
    id: 'chevrolet-k10',
    make_id: 'chevrolet',
    name: 'K10',
    display_name: 'K10',
    aliases: ['K-10', 'K 10'],
    years: { start: 1960, end: 1987 },
    body_styles: ['Pickup'],
    active: false
  },
  {
    id: 'chevrolet-k20',
    make_id: 'chevrolet',
    name: 'K20',
    display_name: 'K20',
    aliases: ['K-20', 'K 20'],
    years: { start: 1960, end: 1987 },
    body_styles: ['Pickup'],
    active: false
  },
  // Ford Models
  {
    id: 'ford-mustang',
    make_id: 'ford',
    name: 'Mustang',
    display_name: 'Mustang',
    aliases: ['STANG'],
    years: { start: 1964 },
    body_styles: ['Coupe', 'Convertible', 'Fastback'],
    active: true
  },
  {
    id: 'ford-f150',
    make_id: 'ford',
    name: 'F-150',
    display_name: 'F-150',
    aliases: ['F150', 'F 150'],
    years: { start: 1975 },
    body_styles: ['Pickup'],
    active: true
  },
  {
    id: 'ford-bronco',
    make_id: 'ford',
    name: 'Bronco',
    display_name: 'Bronco',
    aliases: [],
    years: { start: 1966 },
    body_styles: ['SUV'],
    active: true
  },
  // GMC Models
  {
    id: 'gmc-k10',
    make_id: 'gmc',
    name: 'K10',
    display_name: 'K10',
    aliases: ['K-10', 'K 10'],
    years: { start: 1960, end: 1987 },
    body_styles: ['Pickup'],
    active: false
  },
  {
    id: 'gmc-suburban',
    make_id: 'gmc',
    name: 'Suburban',
    display_name: 'Suburban',
    aliases: ['SUBURBAN'],
    years: { start: 1967, end: 1999 },
    body_styles: ['SUV'],
    active: false
  },
  // Plymouth Models
  {
    id: 'plymouth-roadrunner',
    make_id: 'plymouth',
    name: 'Road Runner',
    display_name: 'Road Runner',
    aliases: ['ROADRUNNER', 'RR'],
    years: { start: 1968, end: 1980 },
    body_styles: ['Coupe', 'Hardtop'],
    active: false
  },
  // Volkswagen Models
  {
    id: 'volkswagen-thing',
    make_id: 'volkswagen',
    name: 'Thing',
    display_name: 'Thing',
    aliases: ['181', 'KURIERWAGEN'],
    years: { start: 1973, end: 1974 },
    body_styles: ['Convertible'],
    active: false
  }
];

class VehicleMakeModelService {
  private static makes = VEHICLE_MAKES;
  private static models = VEHICLE_MODELS;

  /**
   * Get all vehicle makes
   */
  static getAllMakes(): VehicleMake[] {
    return this.makes.filter(make => make.active).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get models for a specific make
   */
  static getModelsForMake(makeId: string): VehicleModel[] {
    return this.models
      .filter(model => model.make_id === makeId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Search makes by query string
   */
  static searchMakes(query: string, limit: number = 10): VehicleMake[] {
    if (!query || query.length < 1) return this.getAllMakes().slice(0, limit);

    const searchTerm = query.toLowerCase().trim();
    const results: Array<{ make: VehicleMake; score: number }> = [];

    this.makes.forEach(make => {
      let score = 0;

      // Exact match gets highest score
      if (make.name.toLowerCase() === searchTerm) {
        score = 100;
      }
      // Starts with gets high score
      else if (make.name.toLowerCase().startsWith(searchTerm)) {
        score = 90;
      }
      // Contains gets medium score
      else if (make.name.toLowerCase().includes(searchTerm)) {
        score = 70;
      }
      // Check aliases
      else {
        for (const alias of make.aliases) {
          if (alias.toLowerCase() === searchTerm) {
            score = 95;
            break;
          } else if (alias.toLowerCase().startsWith(searchTerm)) {
            score = 85;
            break;
          } else if (alias.toLowerCase().includes(searchTerm)) {
            score = 65;
            break;
          }
        }
      }

      if (score > 0) {
        results.push({ make, score });
      }
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(result => result.make);
  }

  /**
   * Search models by query string for a specific make
   */
  static searchModels(makeId: string, query: string, limit: number = 10): VehicleModel[] {
    const makeModels = this.getModelsForMake(makeId);
    
    if (!query || query.length < 1) return makeModels.slice(0, limit);

    const searchTerm = query.toLowerCase().trim();
    const results: Array<{ model: VehicleModel; score: number }> = [];

    makeModels.forEach(model => {
      let score = 0;

      // Exact match gets highest score
      if (model.name.toLowerCase() === searchTerm) {
        score = 100;
      }
      // Starts with gets high score
      else if (model.name.toLowerCase().startsWith(searchTerm)) {
        score = 90;
      }
      // Contains gets medium score
      else if (model.name.toLowerCase().includes(searchTerm)) {
        score = 70;
      }
      // Check aliases
      else {
        for (const alias of model.aliases) {
          if (alias.toLowerCase() === searchTerm) {
            score = 95;
            break;
          } else if (alias.toLowerCase().startsWith(searchTerm)) {
            score = 85;
            break;
          } else if (alias.toLowerCase().includes(searchTerm)) {
            score = 65;
            break;
          }
        }
      }

      if (score > 0) {
        results.push({ model, score });
      }
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(result => result.model);
  }

  /**
   * Normalize a make string to standard format
   */
  static normalizeMake(input: string): string | null {
    if (!input || typeof input !== 'string') return null;

    const searchResults = this.searchMakes(input.trim(), 1);
    return searchResults.length > 0 ? searchResults[0].name : null;
  }

  /**
   * Normalize a model string to standard format for a given make
   */
  static normalizeModel(makeId: string, input: string): string | null {
    if (!input || typeof input !== 'string') return null;

    const searchResults = this.searchModels(makeId, input.trim(), 1);
    return searchResults.length > 0 ? searchResults[0].name : null;
  }

  /**
   * Get make by ID
   */
  static getMakeById(id: string): VehicleMake | null {
    return this.makes.find(make => make.id === id) || null;
  }

  /**
   * Get model by ID
   */
  static getModelById(id: string): VehicleModel | null {
    return this.models.find(model => model.id === id) || null;
  }

  /**
   * Suggest make/model combinations from partial input
   */
  static suggestMakeModel(makeQuery?: string, modelQuery?: string): MakeModelSuggestion[] {
    const suggestions: MakeModelSuggestion[] = [];

    if (makeQuery) {
      const makes = this.searchMakes(makeQuery, 5);
      
      makes.forEach(make => {
        if (modelQuery) {
          const models = this.searchModels(make.id, modelQuery, 3);
          models.forEach(model => {
            suggestions.push({
              make,
              model,
              confidence: 0.9
            });
          });
        } else {
          // Just show popular models for this make
          const popularModels = this.getModelsForMake(make.id).slice(0, 3);
          popularModels.forEach(model => {
            suggestions.push({
              make,
              model,
              confidence: 0.7
            });
          });
        }
      });
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Validate if a make/model combination exists
   */
  static validateMakeModel(make: string, model: string): boolean {
    const normalizedMake = this.normalizeMake(make);
    if (!normalizedMake) return false;

    const makeObj = this.makes.find(m => m.name === normalizedMake);
    if (!makeObj) return false;

    const normalizedModel = this.normalizeModel(makeObj.id, model);
    return normalizedModel !== null;
  }

  /**
   * Get standardized make/model pair
   */
  static getStandardizedPair(make: string, model: string): { make: string; model: string } | null {
    const normalizedMake = this.normalizeMake(make);
    if (!normalizedMake) return null;

    const makeObj = this.makes.find(m => m.name === normalizedMake);
    if (!makeObj) return null;

    const normalizedModel = this.normalizeModel(makeObj.id, model);
    if (!normalizedModel) return null;

    return {
      make: normalizedMake,
      model: normalizedModel
    };
  }
}

// Export the service as default only
export default VehicleMakeModelService;
