
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SystemStatus } from "./SystemStatus";

export const DashboardSummary = () => {
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data } = await supabase.from('vehicles').select('*');
      return data;
    }
  });

  const { data: assets } = useQuery({
    queryKey: ['assets'],
    queryFn: async () => {
      const { data } = await supabase.from('assets').select('*');
      return data;
    }
  });

  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data } = await supabase.from('service_tickets').select('*');
      return data;
    }
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      <SystemStatus />

      {/* Vehicle Summary */}
      <div className="border border-gov-blue p-2">
        <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
          VEH_SUMMARY
        </div>
        <div className="grid grid-cols-2 gap-1 text-tiny">
          <span>TOTAL:</span>
          <span>{vehicles?.length || 0}</span>
          <span>ACTIVE:</span>
          <span>{vehicles?.filter(v => !v.notes?.includes('INACTIVE')).length || 0}</span>
          <span>MAINT:</span>
          <span>{serviceTickets?.filter(t => t.status === 'pending').length || 0}</span>
        </div>
      </div>

      {/* Asset Summary */}
      <div className="border border-gov-blue p-2">
        <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
          ASSET_SUMMARY
        </div>
        <div className="grid grid-cols-2 gap-1 text-tiny">
          <span>TOTAL:</span>
          <span>{assets?.length || 0}</span>
          <span>LOW_QTY:</span>
          <span>{assets?.filter(i => (i.quantity || 0) < 5).length || 0}</span>
          <span>VAL($):</span>
          <span>{assets?.reduce((acc, i) => acc + (Number(i.purchase_price) || 0), 0).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};
