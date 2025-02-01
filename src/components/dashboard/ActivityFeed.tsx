import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ActivityFeed = () => {
  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data } = await supabase.from('service_tickets').select('*');
      return data;
    }
  });

  return (
    <div className="border border-gov-blue p-2 col-span-full">
      <div className="text-tiny text-[#666] border-b border-gov-blue pb-1 mb-1">
        RECENT_ACTIVITY
      </div>
      <div className="space-y-1">
        {serviceTickets?.slice(0, 5).map((ticket) => (
          <div key={ticket.id} className="text-tiny flex justify-between">
            <span>{new Date(ticket.created_at).toLocaleDateString()}</span>
            <span className="text-[#666]">{ticket.description.substring(0, 50)}</span>
            <span>{ticket.status.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};