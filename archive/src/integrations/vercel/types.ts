
/**
 * Types for Vercel API responses and requests
 */

export interface VercelUser {
  id: string;
  username: string;
  email: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  createdAt: number;
}

export interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar?: string;
  createdAt: number;
}

export interface VercelProject {
  id: string;
  name: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
  targets?: {
    [key: string]: {
      alias?: string[];
      aliasAssigned?: number;
      aliasError?: string | null;
      createdAt?: number;
      createdIn?: string;
      deployment?: string | null;
      meta?: { [key: string]: string };
      url: string;
    };
  };
  latestDeployments?: VercelDeployment[];
  link?: {
    org?: string;
    repo?: string;
    repoId?: number;
    type?: string;
    createdAt?: number;
    deployHooks?: {
      createdAt?: number;
      id: string;
      name: string;
      ref: string;
      url: string;
    }[];
    gitCredentialId?: string;
    updatedAt?: number;
    sourceless?: boolean;
    productionBranch?: string;
  };
  framework?: string | null;
  rootDirectory?: string | null;
  serverlessFunctionRegion?: string | null;
  buildCommand?: string | null;
  devCommand?: string | null;
  outputDirectory?: string | null;
  publicSource?: boolean | null;
  nodejs?: string | null;
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  created: number;
  state: 'BUILDING' | 'ERROR' | 'CANCELED' | 'READY' | 'QUEUED';
  creator: {
    uid: string;
    email: string;
    username: string;
    githubLogin?: string;
  };
  meta?: { [key: string]: string };
  target?: string | null;
  aliasAssigned?: number;
  aliasError?: string | null;
  inspectorUrl?: string | null;
  buildingAt?: number;
  ready?: number;
  createdAt?: number;
  createdIn?: string;
}

export interface VercelDomain {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  verification: string[];
  nameservers: string[];
  intendedNameservers: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface VercelEnvVariable {
  id: string;
  key: string;
  value: string;
  target: string[];
  gitBranch?: string;
  type: 'system' | 'secret' | 'encrypted' | 'plain';
  configurationId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface VercelDeploymentOptions {
  name?: string;
  target?: 'production' | 'preview';
  source?: 'cli' | 'git' | 'api';
  gitSource?: {
    type: 'github' | 'gitlab' | 'bitbucket';
    ref: string; // Branch, commit SHA, or tag
    repoId?: number;
    sha?: string;
    prId?: number;
  };
  build?: {
    env?: Record<string, string>;
  };
  environment?: Record<string, string>;
  silent?: boolean;
  regions?: string[];
}

export interface VercelDomainPrice {
  available: boolean;
  premium: boolean;
  price: number | null;
  period?: number;
}

export interface CreateEnvRequest {
  key: string;
  value: string;
  target?: string[];
  type?: 'system' | 'secret' | 'encrypted' | 'plain';
  gitBranch?: string;
}
