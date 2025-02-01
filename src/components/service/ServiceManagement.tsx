import { useState } from "react";
import { ServiceTicketList } from "./ServiceTicketList";
import { ServiceTicketForm } from "./ServiceTicketForm";
import { Button } from "@/components/ui/button";

export const ServiceManagement = () => {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-sm font-mono text-[#283845] tracking-tight uppercase">Service Records</h2>
          <p className="text-xs text-[#666] font-mono mt-1">Maintenance Documentation System</p>
        </div>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="bg-[#283845] hover:bg-[#1a2830] text-white font-mono text-sm"
        >
          {showForm ? "View Records" : "Create Service Ticket"}
        </Button>
      </div>
      {showForm ? <ServiceTicketForm /> : <ServiceTicketList />}
    </div>
  );
};