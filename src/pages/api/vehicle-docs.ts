import { NextApiRequest, NextApiResponse } from 'next';
import { VehicleDataService } from '@/integrations/mcp/firecrawl/VehicleDataService';
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs';

/**
 * API endpoint to access Firecrawl MCP for vehicle documentation
 * This keeps your API key secure while allowing frontend access to vehicle docs
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Create authenticated Supabase client (verifies user is logged in)
    const supabase = createServerSupabaseClient({ req, res });
    
    // Get user session to ensure authenticated access
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Initialize the Vehicle Data Service
    const vehicleDataService = new VehicleDataService();
    
    // Process the request based on the action
    const { action, params } = req.body;
    
    let result;
    
    switch (action) {
      case 'findMaintenanceDocs':
        result = await vehicleDataService.findMaintenanceDocs(
          params.make,
          params.model,
          params.year,
          params.topic
        );
        break;
        
      case 'getVehicleSpecs':
        result = await vehicleDataService.getVehicleSpecs(
          params.make,
          params.model,
          params.year
        );
        break;
        
      case 'findRecallInformation':
        result = await vehicleDataService.findRecallInformation(
          params.make,
          params.model,
          params.year
        );
        break;
        
      case 'getServiceBulletins':
        result = await vehicleDataService.getServiceBulletins(
          params.make,
          params.model,
          params.year
        );
        break;
        
      case 'enrichVehicleRecord':
        await vehicleDataService.enrichVehicleRecord(
          params.vehicleId,
          params.includeRecalls,
          params.includeBulletins
        );
        result = { success: true, message: 'Vehicle record enriched successfully' };
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    return res.status(200).json({ data: result });
    
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown server error');
    console.error('API error:', error);
    return res.status(500).json({ 
      error: 'Server error', 
      message: error.message 
    });
  }
}
