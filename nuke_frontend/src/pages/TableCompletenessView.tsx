/**
 * TABLE COMPLETENESS VIEW
 * 
 * Simple, clear view of which database tables are populated
 * Shows row counts and which vehicles have data in each table
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface TableStats {
  tableName: string;
  rowCount: number;
  vehiclesCovered: number;
  avgPerVehicle: number;
}

export default function TableCompletenessView() {
  const [tables, setTables] = useState<TableStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTableStats();
  }, []);

  async function loadTableStats() {
    try {
      // Query each table
      const stats: TableStats[] = [];

      const tableQueries = [
        { name: 'vehicle_images', table: 'vehicle_images' },
        { name: 'timeline_events', table: 'timeline_events' },
        { name: 'receipts', table: 'receipts' },
        { name: 'image_tags', table: 'image_tags' },
        { name: 'vehicle_spid_data', table: 'vehicle_spid_data' },
        { name: 'reference_documents', table: 'reference_documents' },
        { name: 'vehicle_modifications', table: 'vehicle_modifications' },
        { name: 'part_identifications', table: 'part_identifications' },
        { name: 'image_question_answers', table: 'image_question_answers' },
        { name: 'missing_context_reports', table: 'missing_context_reports' }
      ];

      for (const { name, table } of tableQueries) {
        const { count } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        const { data: vehicleData } = await supabase
          .from(table)
          .select('vehicle_id');

        const uniqueVehicles = new Set(vehicleData?.map(d => d.vehicle_id).filter(Boolean)).size;

        stats.push({
          tableName: name,
          rowCount: count || 0,
          vehiclesCovered: uniqueVehicles,
          avgPerVehicle: uniqueVehicles > 0 ? (count || 0) / uniqueVehicles : 0
        });
      }

      setTables(stats.sort((a, b) => b.rowCount - a.rowCount));
      setLoading(false);
    } catch (error) {
      console.error('Error loading table stats:', error);
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="text-8pt text-gray-500 uppercase tracking-wide">Loading...</div>;
  }

  return (
    <div className="bg-black text-white p-4">
      <div className="max-w-6xl mx-auto">
        
        <div className="mb-4">
          <h1 className="text-8pt font-bold uppercase tracking-wide mb-1">Table Completeness</h1>
          <p className="text-8pt text-gray-600">Database population by table</p>
        </div>

        <div className="bg-black border-2 border-gray-800 rounded p-4">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-gray-800">
                <th className="text-left text-8pt uppercase tracking-wide text-gray-500 pb-2">Table</th>
                <th className="text-right text-8pt uppercase tracking-wide text-gray-500 pb-2">Rows</th>
                <th className="text-right text-8pt uppercase tracking-wide text-gray-500 pb-2">Vehicles</th>
                <th className="text-right text-8pt uppercase tracking-wide text-gray-500 pb-2">Avg/Vehicle</th>
                <th className="text-right text-8pt uppercase tracking-wide text-gray-500 pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => {
                const isPopulated = table.rowCount > 0;
                const isMature = table.rowCount > 100;
                
                return (
                  <tr key={table.tableName} className="border-b border-gray-900">
                    <td className="py-2 text-8pt font-mono">{table.tableName}</td>
                    <td className="text-right text-8pt font-bold">
                      {table.rowCount.toLocaleString()}
                    </td>
                    <td className="text-right text-8pt text-gray-400">
                      {table.vehiclesCovered}
                    </td>
                    <td className="text-right text-8pt text-gray-600">
                      {table.avgPerVehicle.toFixed(1)}
                    </td>
                    <td className="text-right text-8pt">
                      {isMature ? (
                        <span className="text-green-400 uppercase tracking-wide">GOOD</span>
                      ) : isPopulated ? (
                        <span className="text-yellow-400 uppercase tracking-wide">PARTIAL</span>
                      ) : (
                        <span className="text-gray-600 uppercase tracking-wide">EMPTY</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={loadTableStats}
            className="px-4 py-2 text-8pt uppercase tracking-wide bg-blue-500/10 border-2 border-blue-500 text-blue-400 hover:bg-blue-500/20 rounded transition-all duration-120"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

