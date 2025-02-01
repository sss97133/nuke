import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import type { ServiceTicket } from "@/types/inventory";

export const ServiceTicketList = () => {
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    const fetchTickets = async () => {
      const { data, error } = await supabase
        .from("service_tickets")
        .select("*");

      if (error) {
        toast({
          title: "Error fetching service tickets",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      // Map the Supabase data to match our frontend types
      const mappedTickets: ServiceTicket[] = (data || []).map(ticket => ({
        id: ticket.id,
        vehicleId: ticket.vehicle_id || '',
        status: ticket.status as ServiceTicket['status'],
        description: ticket.description,
        priority: ticket.priority as ServiceTicket['priority'],
        assignedTo: undefined,
        createdBy: ticket.user_id || '',
        updatedBy: ticket.user_id || '',
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at
      }));

      setTickets(mappedTickets);
    };

    fetchTickets();
  }, [toast]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto bg-[#F4F1DE] p-8 border border-[#283845]">
      <h2 className="text-2xl text-[#283845] uppercase tracking-wider text-center">Service Tickets</h2>
      <div className="grid gap-4">
        {tickets.map((ticket) => (
          <div key={ticket.id} className="p-4 border border-[#283845] bg-white">
            <div className="flex justify-between items-start">
              <h3 className="font-mono text-lg">Ticket #{ticket.id}</h3>
              <span className={`px-2 py-1 text-xs rounded ${
                ticket.status === 'completed' ? 'bg-green-100 text-green-800' :
                ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                ticket.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {ticket.status.toUpperCase()}
              </span>
            </div>
            <p className="mt-2">{ticket.description}</p>
            <p className="text-sm text-[#9B2915] mt-2">Priority: {ticket.priority}</p>
          </div>
        ))}
      </div>
    </div>
  );
};