import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertCircle, CheckCircle2, Clock } from "lucide-react";

export const ActivityFeed = () => {
  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data } = await supabase.from('service_tickets').select('*').order('created_at', { ascending: false });
      return data;
    }
  });

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'active':
        return <Activity className="w-4 h-4 text-blue-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-background shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium border-b border-border pb-2 mb-3">
        <Activity className="w-4 h-4" />
        <span>Recent Activity</span>
      </div>
      <div className="space-y-2">
        {serviceTickets?.slice(0, 5).map((ticket) => (
          <div key={ticket.id} className="flex items-center justify-between text-sm p-2 hover:bg-accent/50 rounded-md transition-colors">
            <div className="flex items-center gap-2">
              {getStatusIcon(ticket.status)}
              <span className="text-muted-foreground">{formatDate(ticket.created_at)}</span>
            </div>
            <span className="flex-1 px-4 truncate">{ticket.description}</span>
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-accent">
              {ticket.status.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};