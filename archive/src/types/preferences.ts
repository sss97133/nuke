
export interface UserPreferences {
  notificationsEnabled: boolean;
  autoSaveEnabled: boolean;
  compactViewEnabled: boolean;
  theme: string;
  distanceUnit: string;
  currency: string;
  defaultGarageView: string;
  serviceRemindersEnabled: boolean;
  inventoryAlertsEnabled: boolean;
  priceAlertsEnabled: boolean;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  fontSize: string;
}

// Define the database schema version of preferences (snake_case)
export interface DbUserPreferences {
  notifications_enabled: boolean;
  auto_save_enabled: boolean;
  compact_view_enabled: boolean;
  theme: string;
  distance_unit: string;
  currency: string;
  default_garage_view: string;
  service_reminders_enabled: boolean;
  inventory_alerts_enabled: boolean;
  price_alerts_enabled: boolean;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  font_family?: string;
  font_size?: string;
}
