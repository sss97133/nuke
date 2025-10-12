/**
 * Database Core Module
 * Consolidates all Supabase operations into a single, reusable module
 * Eliminates the need for 29 different files to create their own clients
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

/**
 * Database Client Manager
 * Manages different client types (anon, service, custom)
 */
class DatabaseManager {
  constructor() {
    this.clients = new Map();
    this.config = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    };
    this.validateConfig();
  }

  validateConfig() {
    if (!this.config.url) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
    }
    if (!this.config.anonKey) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
    }
  }

  /**
   * Get or create a Supabase client
   * @param {'anon'|'service'|'custom'} type - Client type
   * @param {Object} options - Custom options for client creation
   */
  getClient(type = 'anon', options = {}) {
    const key = `${type}-${JSON.stringify(options)}`;
    
    if (this.clients.has(key)) {
      return this.clients.get(key);
    }

    let client;
    switch (type) {
      case 'anon':
        client = createClient(this.config.url, this.config.anonKey, options);
        break;
      
      case 'service':
        if (!this.config.serviceKey) {
          throw new Error('Service role key not available');
        }
        client = createClient(this.config.url, this.config.serviceKey, {
          auth: { persistSession: false, ...options.auth },
          ...options
        });
        break;
      
      case 'custom':
        if (!options.key) {
          throw new Error('Custom client requires a key');
        }
        client = createClient(this.config.url, options.key, options);
        break;
      
      default:
        throw new Error(`Unknown client type: ${type}`);
    }

    this.clients.set(key, client);
    return client;
  }

  /**
   * Get authenticated user client
   */
  async getUserClient(email, password) {
    const client = this.getClient('anon');
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) throw error;
    return { client, user: data.user, session: data.session };
  }
}

/**
 * Database Operations
 * Common database operations abstracted
 */
class DatabaseOperations {
  constructor(client) {
    this.client = client;
  }

  /**
   * Vehicle operations
   */
  async insertVehicle(vehicleData, options = {}) {
    const { bypassRLS = false } = options;
    const targetClient = bypassRLS ? 
      dbManager.getClient('service') : 
      this.client;

    const { data, error } = await targetClient
      .from('vehicles')
      .insert(vehicleData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getVehicle(vinOrId) {
    const isVin = vinOrId.length === 17;
    const column = isVin ? 'vin' : 'id';
    
    const { data, error } = await this.client
      .from('vehicles')
      .select('*')
      .eq(column, vinOrId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async updateVehicle(id, updates) {
    const { data, error } = await this.client
      .from('vehicles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async deleteVehicle(id) {
    const { error } = await this.client
      .from('vehicles')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  }

  /**
   * User operations
   */
  async getCurrentUser() {
    const { data: { user }, error } = await this.client.auth.getUser();
    if (error) throw error;
    return user;
  }

  async getUserProfile(userId) {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async ensureProfile(user) {
    let profile = await this.getUserProfile(user.id);
    
    if (!profile) {
      const { data, error } = await this.client
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email,
          username: user.email.split('@')[0]
        })
        .select()
        .single();
      
      if (error) throw error;
      profile = data;
    }
    
    return profile;
  }

  /**
   * Event operations
   */
  async createTimelineEvent(eventData) {
    const { data, error } = await this.client
      .from('timeline_events')
      .insert(eventData)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getTimelineEvents(filters = {}) {
    let query = this.client.from('timeline_events').select('*');
    
    if (filters.userId) query = query.eq('user_id', filters.userId);
    if (filters.vehicleId) query = query.eq('vehicle_id', filters.vehicleId);
    if (filters.eventType) query = query.eq('event_type', filters.eventType);
    if (filters.limit) query = query.limit(filters.limit);
    
    query = query.order('timestamp', { ascending: false });
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  /**
   * Batch operations
   */
  async batchInsert(table, records) {
    const chunks = [];
    const chunkSize = 100;
    
    for (let i = 0; i < records.length; i += chunkSize) {
      chunks.push(records.slice(i, i + chunkSize));
    }
    
    const results = [];
    for (const chunk of chunks) {
      const { data, error } = await this.client
        .from(table)
        .insert(chunk)
        .select();
      
      if (error) throw error;
      results.push(...data);
    }
    
    return results;
  }

  /**
   * Testing utilities
   */
  async cleanupTestData(prefix = 'test-') {
    // Clean test vehicles
    const { error: vehicleError } = await this.client
      .from('vehicles')
      .delete()
      .ilike('vin', `${prefix}%`);
    
    if (vehicleError) console.warn('Cleanup error:', vehicleError);
    
    // Clean test users (be careful!)
    const { data: testUsers } = await this.client
      .from('profiles')
      .select('id')
      .ilike('email', `${prefix}%`);
    
    if (testUsers && testUsers.length) {
      for (const user of testUsers) {
        await this.client.auth.admin.deleteUser(user.id);
      }
    }
  }
}

/**
 * Test Helper
 * Simplifies testing database operations
 */
class DatabaseTestHelper {
  constructor() {
    this.testPrefix = `test-${Date.now()}-`;
    this.createdRecords = {
      vehicles: [],
      users: [],
      events: []
    };
  }

  async createTestUser(overrides = {}) {
    const email = overrides.email || `${this.testPrefix}user@example.com`;
    const password = overrides.password || 'TestPassword123!';
    
    const manager = new DatabaseManager();
    const { client, user } = await manager.getUserClient(email, password);
    
    this.createdRecords.users.push(user.id);
    return { client, user };
  }

  async createTestVehicle(client, overrides = {}) {
    const ops = new DatabaseOperations(client);
    const vehicle = await ops.insertVehicle({
      vin: `${this.testPrefix}VIN123`,
      make: 'TestMake',
      model: 'TestModel',
      year: 2023,
      ...overrides
    });
    
    this.createdRecords.vehicles.push(vehicle.id);
    return vehicle;
  }

  async cleanup() {
    const manager = new DatabaseManager();
    const serviceClient = manager.getClient('service');
    const ops = new DatabaseOperations(serviceClient);
    
    // Clean vehicles
    for (const id of this.createdRecords.vehicles) {
      await ops.deleteVehicle(id).catch(() => {});
    }
    
    // Clean users
    for (const id of this.createdRecords.users) {
      await serviceClient.auth.admin.deleteUser(id).catch(() => {});
    }
  }
}

// Create singleton instance
const dbManager = new DatabaseManager();

// Export everything
module.exports = {
  DatabaseManager,
  DatabaseOperations,
  DatabaseTestHelper,
  
  // Convenience exports
  getClient: (type, options) => dbManager.getClient(type, options),
  getAnonClient: () => dbManager.getClient('anon'),
  getServiceClient: () => dbManager.getClient('service'),
  getUserClient: (email, password) => dbManager.getUserClient(email, password),
  
  // Create operations instance
  createOperations: (client) => new DatabaseOperations(client || dbManager.getClient()),
  
  // Test helper factory
  createTestHelper: () => new DatabaseTestHelper()
};
