export enum UserRole {
  SYSTEM_OWNER = 'system_owner',
  PROFESSIONAL = 'professional',
  REGULAR = 'regular'
}

export interface UserMetrics {
  vehiclesAdded: number;
  imagesUploaded: number;
  lastActive: Date;
  totalContributions: number;
}

export interface UserRoleInfo {
  role: UserRole;
  metrics: UserMetrics;
  isProfessional: boolean;
}

export const PROFESSIONAL_THRESHOLDS = {
  MIN_VEHICLES: 5,
  MIN_IMAGES: 10,
  MIN_ACTIVITY_DAYS: 30,
  MIN_CONTRIBUTIONS: 15
};

export const calculateUserRole = (metrics: UserMetrics): UserRoleInfo => {
  const isProfessional = 
    metrics.vehiclesAdded >= PROFESSIONAL_THRESHOLDS.MIN_VEHICLES &&
    metrics.imagesUploaded >= PROFESSIONAL_THRESHOLDS.MIN_IMAGES &&
    metrics.totalContributions >= PROFESSIONAL_THRESHOLDS.MIN_CONTRIBUTIONS;

  return {
    role: isProfessional ? UserRole.PROFESSIONAL : UserRole.REGULAR,
    metrics,
    isProfessional
  };
}; 