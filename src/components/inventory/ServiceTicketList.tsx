import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import type { ServiceTicket } from "@/types/inventory";

export const ServiceTicketList = () => {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    try {
      const { data, error } = await supabase
        .from("service_tickets")
        .select("*")
        .order("createdAt", { ascending: false });

      if (error) throw error;
      setTickets(data || []);
    } catch (error) {
      toast({
        title: "Error fetching service tickets",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center p-4">Loading service tickets...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-mono text-[#283845] mb-4">Service Tickets</h2>
      <div className="grid gap-4">
        {tickets.map((ticket) => (
          <div
            key={ticket.id}
            className="p-4 border border-[#283845] bg-[#F4F1DE]"
          >
            <div className="flex justify-between items-start">
              <h3 className="font-mono text-lg">Ticket #{ticket.id}</h3>
              <span
                className={`px-2 py-1 text-xs rounded ${
                  ticket.status === "completed"
                    ? "bg-green-100 text-green-800"
                    : ticket.status === "in-progress"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-yellow-100 text-yellow-800"
                }`}
              >
                {ticket.status}
              </span>
            </div>
            <p className="mt-2">{ticket.description}</p>
            <div className="mt-2 text-sm text-[#9B2915]">
              Priority: {ticket.priority}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};