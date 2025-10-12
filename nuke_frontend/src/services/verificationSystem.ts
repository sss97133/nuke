export interface VerificationRecord {
  id: string;
  vehicleId: string;
  verifierId: string;
  verifierType: 'owner' | 'mechanic' | 'appraiser' | 'dealer' | 'inspector' | 'professional';
  verificationLevel: 'basic' | 'detailed' | 'expert';
  fieldsVerified: string[]; // ['year', 'make', 'model', 'mileage', 'condition']
  verificationMethod: 'visual_inspection' | 'document_review' | 'hands_on_inspection' | 'professional_assessment';
  confidence: number; // 0-1
  notes?: string;
  evidenceUrls?: string[]; // Photos, documents supporting verification
  timestamp: string;
  expiresAt?: string; // Some verifications may expire (e.g., condition assessments)
  isActive: boolean;
}

export interface VerifierProfile {
  id: string;
  userId: string;
  verifierType: 'owner' | 'mechanic' | 'appraiser' | 'dealer' | 'inspector' | 'professional';
  credentials: {
    certifications?: string[];
    licenseNumber?: string;
    businessName?: string;
    yearsExperience?: number;
    specializations?: string[]; // ['BMW', 'luxury', 'classic', 'electric']
  };
  verificationStats: {
    totalVerifications: number;
    accuracyScore: number; // Based on peer reviews
    trustScore: number; // Community-driven rating
    endorsements: number;
  };
  isVerified: boolean; // Is this verifier themselves verified?
  createdAt: string;
}

export interface VehicleVerificationStatus {
  vehicleId: string;
  overallTrustScore: number; // 0-100
  verificationLevels: {
    aiImported: boolean;
    ownerVerified: boolean;
    professionalVerified: boolean;
    multiSourceVerified: boolean;
    expertVerified: boolean;
  };
  verificationCount: number;
  lastVerifiedAt: string;
  verificationRecords: VerificationRecord[];
  conflictingData?: ConflictingVerification[];
}

export interface ConflictingVerification {
  field: string;
  values: Array<{
    value: any;
    verifierId: string;
    confidence: number;
    timestamp: string;
  }>;
  resolutionStatus: 'pending' | 'resolved' | 'disputed';
}

export class VerificationSystem {
  /**
   * Calculate trust score based on verification history
   */
  static calculateTrustScore(verifications: VerificationRecord[]): number {
    if (verifications.length === 0) return 0;

    let score = 0;
    let weightSum = 0;

    const weights = {
      'owner': 1,
      'mechanic': 3,
      'appraiser': 4,
      'dealer': 2,
      'inspector': 5,
      'professional': 3
    };

    const levelMultipliers = {
      'basic': 1,
      'detailed': 1.5,
      'expert': 2
    };

    for (const verification of verifications) {
      if (!verification.isActive) continue;

      const baseWeight = weights[verification.verifierType] || 1;
      const levelMultiplier = levelMultipliers[verification.verificationLevel] || 1;
      const confidenceWeight = verification.confidence;
      
      const weight = baseWeight * levelMultiplier * confidenceWeight;
      score += weight * 100;
      weightSum += weight;
    }

    return weightSum > 0 ? Math.min(Math.round(score / weightSum), 100) : 0;
  }

  /**
   * Get verification badges based on status
   */
  static getVerificationBadges(status: VehicleVerificationStatus): string[] {
    const badges: string[] = [];

    if (status.verificationLevels.ownerVerified) {
      badges.push('owner-verified');
    }

    if (status.verificationLevels.professionalVerified) {
      badges.push('professional-verified');
    }

    if (status.verificationLevels.multiSourceVerified) {
      badges.push('multi-source-verified');
    }

    if (status.verificationLevels.expertVerified) {
      badges.push('expert-verified');
    }

    // Trust score badges
    if (status.overallTrustScore >= 95) {
      badges.push('platinum-verified');
    } else if (status.overallTrustScore >= 85) {
      badges.push('gold-verified');
    } else if (status.overallTrustScore >= 70) {
      badges.push('silver-verified');
    }

    return badges;
  }

  /**
   * Update verification levels based on verification records
   */
  static updateVerificationLevels(verifications: VerificationRecord[]) {
    const activeVerifications = verifications.filter(v => v.isActive);
    
    const hasOwnerVerification = activeVerifications.some(v => v.verifierType === 'owner');
    const hasProfessionalVerification = activeVerifications.some(v => 
      ['mechanic', 'appraiser', 'dealer', 'inspector', 'professional'].includes(v.verifierType)
    );
    const hasExpertVerification = activeVerifications.some(v => 
      ['appraiser', 'inspector'].includes(v.verifierType) && v.verificationLevel === 'expert'
    );
    const hasMultipleVerifiers = new Set(activeVerifications.map(v => v.verifierId)).size >= 2;

    return {
      aiImported: true, // Assume all data starts as AI imported
      ownerVerified: hasOwnerVerification,
      professionalVerified: hasProfessionalVerification,
      multiSourceVerified: hasMultipleVerifiers && hasProfessionalVerification,
      expertVerified: hasExpertVerification
    };
  }

  /**
   * Get verification incentives for users
   */
  static getVerificationIncentives(vehicleData: any, currentVerifications: VerificationRecord[]) {
    return {
      reputationPoints: 10,
      trustScoreBoost: 5,
      badges: ['verifier'],
      valueIncrease: 0,
      advantages: [
        'Increased trust score',
        'Priority in search results',
        'Access to premium features'
      ],
      benefits: [
        'Build professional reputation',
        'Earn verification badges',
        'Help community trust'
      ],
      marketAdvantages: [
        'Higher search ranking',
        'Buyer confidence boost',
        'Faster sale potential'
      ],
      trustBenefits: [
        'Build professional reputation',
        'Earn verification badges',
        'Help community trust'
      ]
    };
  }
}
