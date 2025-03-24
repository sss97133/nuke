export interface SpatialLMConfig {
  modelPath: string;
  device: 'cuda' | 'cpu';
  batchSize: number;
  confidenceThreshold: number;
  maxObjects: number;
  minObjectSize: number;
  maxObjectSize: number;
  pointCloudDensity: number;
  processingTimeout: number;
}

export const defaultConfig: SpatialLMConfig = {
  modelPath: process.env.SPATIALLM_MODEL_PATH || '/models/spatiallm/model.pt',
  device: process.env.SPATIALLM_DEVICE === 'cuda' ? 'cuda' : 'cpu',
  batchSize: parseInt(process.env.SPATIALLM_BATCH_SIZE || '32', 10),
  confidenceThreshold: parseFloat(process.env.SPATIALLM_CONFIDENCE_THRESHOLD || '0.5'),
  maxObjects: parseInt(process.env.SPATIALLM_MAX_OBJECTS || '100', 10),
  minObjectSize: parseFloat(process.env.SPATIALLM_MIN_OBJECT_SIZE || '0.1'),
  maxObjectSize: parseFloat(process.env.SPATIALLM_MAX_OBJECT_SIZE || '10.0'),
  pointCloudDensity: parseFloat(process.env.SPATIALLM_POINT_CLOUD_DENSITY || '0.1'),
  processingTimeout: parseInt(process.env.SPATIALLM_PROCESSING_TIMEOUT || '30000', 10)
};

export const developmentConfig: SpatialLMConfig = {
  ...defaultConfig,
  device: 'cpu',
  batchSize: 8,
  confidenceThreshold: 0.3,
  maxObjects: 50,
  processingTimeout: 60000
};

export const productionConfig: SpatialLMConfig = {
  ...defaultConfig,
  device: 'cuda',
  batchSize: 32,
  confidenceThreshold: 0.5,
  maxObjects: 100,
  processingTimeout: 30000
};

export const getConfig = (): SpatialLMConfig => {
  const env = process.env.NODE_ENV || 'development';
  switch (env) {
    case 'production':
      return productionConfig;
    case 'development':
    default:
      return developmentConfig;
  }
}; 