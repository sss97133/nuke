/**
 * Advanced Search Service
 * Implements scientific search techniques:
 * - BM25/TF-IDF scoring
 * - Query expansion and normalization
 * - Fuzzy matching
 * - Field boosting
 * - Hybrid keyword + semantic search
 * 
 * Based on:
 * - Apache Lucene/Solr ranking algorithms
 * - BM25 (Best Matching 25) ranking function
 * - Information Retrieval best practices
 */

interface SearchDocument {
  id: string;
  type: string;
  title: string;
  description: string;
  content: string; // Full searchable content
  fields: Record<string, any>; // Additional fields for boosting
  created_at: string;
}

interface SearchResult {
  id: string;
  type: string;
  title: string;
  description: string;
  relevance_score: number;
  metadata: any;
  created_at: string;
}

interface QueryAnalysis {
  original: string;
  normalized: string;
  terms: string[];
  expandedTerms: string[];
  fieldBoosts: Record<string, number>;
  filters: Record<string, any>;
}

export class AdvancedSearchService {
  // BM25 parameters (tuned for typical document lengths)
  private k1 = 1.2; // Term frequency saturation parameter
  private b = 0.75; // Length normalization parameter
  private avgDocLength = 100; // Average document length (words)

  // Field boost weights (higher = more important)
  private fieldBoosts = {
    title: 3.0,
    make: 2.5,
    model: 2.5,
    year: 2.0,
    description: 1.0,
    content: 0.8,
    metadata: 0.5
  };

  // Common stop words (to filter out)
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that',
    'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
  ]);

  // Synonym/expansion dictionary
  private synonyms: Record<string, string[]> = {
    'c10': ['c-10', 'chevy c10', 'chevrolet c10', 'squarebody'],
    'squarebody': ['c10', 'c-10', 'chevy squarebody', 'gm squarebody'],
    'mustang': ['ford mustang'],
    'camaro': ['chevrolet camaro', 'chevy camaro'],
    'bronco': ['ford bronco'],
    'blazer': ['chevy blazer', 'chevrolet blazer', 'k5 blazer'],
    'shop': ['garage', 'mechanic', 'service', 'repair shop', 'auto shop'],
    'parts': ['components', 'pieces', 'items'],
    'engine': ['motor', 'powerplant'],
    'transmission': ['trans', 'tranny'],
    'restoration': ['restore', 'restoring', 'restored'],
    'for sale': ['selling', 'available', 'on market'],
    'near me': ['local', 'nearby', 'close']
  };

  /**
   * Normalize and tokenize query
   */
  normalizeQuery(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(term => term.length > 1 && !this.stopWords.has(term));
  }

  /**
   * Expand query with synonyms and related terms
   */
  expandQuery(terms: string[]): string[] {
    const expanded = new Set<string>(terms);
    
    terms.forEach(term => {
      // Add direct synonyms
      if (this.synonyms[term]) {
        this.synonyms[term].forEach(syn => expanded.add(syn));
      }
      
      // Check for partial matches (e.g., "c10" in "c10 pickup")
      Object.keys(this.synonyms).forEach(key => {
        if (term.includes(key) || key.includes(term)) {
          this.synonyms[key].forEach(syn => expanded.add(syn));
        }
      });
    });
    
    return Array.from(expanded);
  }

  /**
   * Calculate term frequency (TF) for BM25
   */
  private calculateTF(term: string, document: SearchDocument): number {
    const content = `${document.title} ${document.description} ${document.content}`.toLowerCase();
    const words = content.split(/\s+/);
    const termCount = words.filter(w => w === term.toLowerCase()).length;
    return termCount / words.length;
  }

  /**
   * Calculate inverse document frequency (IDF) for BM25
   */
  private calculateIDF(term: string, documents: SearchDocument[]): number {
    const docsWithTerm = documents.filter(doc => {
      const content = `${doc.title} ${doc.description} ${doc.content}`.toLowerCase();
      return content.includes(term.toLowerCase());
    }).length;
    
    if (docsWithTerm === 0) return 0;
    
    const totalDocs = documents.length;
    return Math.log((totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
  }

  /**
   * Calculate BM25 score for a document
   */
  private calculateBM25(
    queryTerms: string[],
    document: SearchDocument,
    allDocuments: SearchDocument[]
  ): number {
    let score = 0;
    const docLength = `${document.title} ${document.description} ${document.content}`.split(/\s+/).length;
    
    queryTerms.forEach(term => {
      const tf = this.calculateTF(term, document);
      const idf = this.calculateIDF(term, allDocuments);
      
      // BM25 formula
      const numerator = idf * tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
      
      score += numerator / denominator;
    });
    
    return score;
  }

  /**
   * Calculate field-boosted relevance score
   */
  private calculateFieldBoostedScore(
    queryTerms: string[],
    document: SearchDocument
  ): number {
    let score = 0;
    
    queryTerms.forEach(term => {
      const termLower = term.toLowerCase();
      
      // Title boost
      if (document.title.toLowerCase().includes(termLower)) {
        score += this.fieldBoosts.title;
      }
      
      // Make/model boost
      if (document.fields.make?.toLowerCase().includes(termLower)) {
        score += this.fieldBoosts.make;
      }
      if (document.fields.model?.toLowerCase().includes(termLower)) {
        score += this.fieldBoosts.model;
      }
      
      // Year boost
      if (document.fields.year?.toString().includes(termLower)) {
        score += this.fieldBoosts.year;
      }
      
      // Description boost
      if (document.description.toLowerCase().includes(termLower)) {
        score += this.fieldBoosts.description;
      }
      
      // Content boost
      if (document.content.toLowerCase().includes(termLower)) {
        score += this.fieldBoosts.content;
      }
    });
    
    return score;
  }

  /**
   * Calculate fuzzy match score (handles typos)
   */
  private calculateFuzzyScore(term: string, text: string): number {
    const termLower = term.toLowerCase();
    const textLower = text.toLowerCase();
    
    // Exact match
    if (textLower.includes(termLower)) {
      return 1.0;
    }
    
    // Check for common typos/alternatives
    const fuzzyPatterns = [
      termLower.replace(/ie/gi, 'ei'),
      termLower.replace(/ei/gi, 'ie'),
      termLower.replace(/ph/gi, 'f'),
      termLower.replace(/ck/gi, 'k'),
    ];
    
    for (const pattern of fuzzyPatterns) {
      if (textLower.includes(pattern)) {
        return 0.7;
      }
    }
    
    // Check for substring matches
    if (termLower.length > 3 && textLower.includes(termLower.substring(0, termLower.length - 1))) {
      return 0.5;
    }
    
    return 0;
  }

  /**
   * Analyze and parse search query
   */
  analyzeQuery(query: string): QueryAnalysis {
    const normalized = query.trim().toLowerCase();
    const terms = this.normalizeQuery(query);
    const expandedTerms = this.expandQuery(terms);
    
    // Extract field-specific filters
    const filters: Record<string, any> = {};
    const fieldBoosts: Record<string, number> = {};
    
    // Year detection
    const yearMatch = query.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      filters.year = parseInt(yearMatch[0]);
      fieldBoosts.year = 2.0;
    }
    
    // Location detection
    if (/near me|nearby|local/i.test(query)) {
      filters.location_requested = true;
    }
    
    // Marketplace detection
    if (/for sale|buy|purchase/i.test(query)) {
      filters.marketplace = true;
    }
    
    return {
      original: query,
      normalized,
      terms,
      expandedTerms,
      fieldBoosts,
      filters
    };
  }

  /**
   * Rank documents using hybrid BM25 + field boosting
   */
  rankDocuments(
    query: string,
    documents: SearchDocument[]
  ): SearchResult[] {
    const analysis = this.analyzeQuery(query);
    const allTerms = [...new Set([...analysis.terms, ...analysis.expandedTerms])];
    
    // Calculate scores for each document
    const scoredDocs = documents.map(doc => {
      // BM25 score (classical IR ranking)
      const bm25Score = this.calculateBM25(allTerms, doc, documents);
      
      // Field-boosted score (domain-specific relevance)
      const fieldScore = this.calculateFieldBoostedScore(allTerms, doc);
      
      // Fuzzy match score (typo tolerance)
      let fuzzyScore = 0;
      allTerms.forEach(term => {
        const docText = `${doc.title} ${doc.description} ${doc.content}`;
        fuzzyScore += this.calculateFuzzyScore(term, docText);
      });
      fuzzyScore = fuzzyScore / allTerms.length;
      
      // Hybrid score: combine all signals
      const hybridScore = (
        bm25Score * 0.4 +      // Classical IR (40%)
        fieldScore * 0.4 +     // Domain knowledge (40%)
        fuzzyScore * 0.2        // Typo tolerance (20%)
      );
      
      // Normalize to 0-1 range
      const normalizedScore = Math.min(1.0, hybridScore / 10);
      
      return {
        id: doc.id,
        type: doc.type,
        title: doc.title,
        description: doc.description,
        relevance_score: normalizedScore,
        metadata: doc.fields,
        created_at: doc.created_at
      };
    });
    
    // Sort by relevance (descending)
    scoredDocs.sort((a, b) => b.relevance_score - a.relevance_score);
    
    return scoredDocs;
  }

  /**
   * Extract keywords from query for highlighting
   */
  extractKeywords(query: string): string[] {
    const analysis = this.analyzeQuery(query);
    return [...new Set([...analysis.terms, ...analysis.expandedTerms])];
  }

  /**
   * Generate search suggestions based on query
   */
  generateSuggestions(query: string, previousQueries: string[]): string[] {
    const normalized = query.toLowerCase();
    const suggestions: string[] = [];
    
    // Find similar previous queries
    previousQueries.forEach(prevQuery => {
      const prevNormalized = prevQuery.toLowerCase();
      if (prevNormalized.includes(normalized) || normalized.includes(prevNormalized)) {
        suggestions.push(prevQuery);
      }
    });
    
    // Add common patterns
    if (/^\d{4}$/.test(query)) {
      suggestions.push(`${query} vehicles`);
      suggestions.push(`${query} for sale`);
    }
    
    if (/c10|squarebody/i.test(query)) {
      suggestions.push('C10 restoration');
      suggestions.push('Squarebody parts');
    }
    
    return suggestions.slice(0, 5);
  }
}

export const advancedSearchService = new AdvancedSearchService();

