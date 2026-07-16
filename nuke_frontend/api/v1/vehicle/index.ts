import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');

  return res.status(200).json({
    name: 'Nuke Vehicle API',
    version: '1.0',
    usage: {
      get_vehicle: {
        method: 'GET',
        path: '/api/v1/vehicle/{id}',
        description: 'Returns public vehicle data by UUID.',
        example: 'https://nuke.ag/api/v1/vehicle/14123fbf-7eb6-4dd6-b0ca-bbc83db06a28',
      },
    },
    mcp: {
      endpoint: 'https://nuke.ag/mcp',
      description: 'Model Context Protocol endpoint for deeper vehicle data. Supports 22 tools including get_vehicle, query_vehicle_deep, and search.',
    },
    docs: 'https://nuke.ag/developers',
  });
}
