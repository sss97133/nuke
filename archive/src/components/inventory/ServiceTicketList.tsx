import type { Database } from '../types';
import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
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
    <div className="container mx-auto py-8">
      <div className="bg-background border border-border rounded-sm shadow-classic">
        <div className="p-6 border-b border-border">
          <h2 className="text-2xl font-system text-foreground">Service Tickets</h2>
        </div>
        <div className="p-6 space-y-4">
          {tickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No service tickets found
            </div>
          ) : (
            tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="bg-card border border-border shadow-classic hover:bg-accent/50 
                         transition-colors p-4 animate-fade-in"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-system mb-1">
                      Ticket #{ticket.id}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Priority: {ticket.priority}
                    </p>
                  </div>
                  <span className={`px-3 py-1 text-xs rounded-sm ${
                    ticket.status === 'completed' ? 'bg-green-100 text-green-800' :
                    ticket.status === 'in-progress' ? 'bg-blue-100 text-blue-800' :
                    ticket.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {ticket.status.toUpperCase()}
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground border-t border-border pt-3">
                  {ticket.description}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};