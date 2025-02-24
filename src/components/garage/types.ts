
export interface GarageMember {
  role: string;
  status: string;
}

export interface Garage {
  id: string;
  name: string;
  garage_members: Array<GarageMember>;
}

export const MAX_GARAGES = 100;
export const MAX_RETRIES = 3;
