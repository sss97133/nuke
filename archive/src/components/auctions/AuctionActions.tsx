import React from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare, TrendingUp } from "lucide-react";

interface AuctionActionsProps {
  auctionId: string;
  isSelected: boolean;
  onToggle: (auctionId: string) => void;
}

export const AuctionActions = ({ auctionId, isSelected, onToggle }: AuctionActionsProps) => {
  return (
    <div className="flex space-x-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onToggle(auctionId)}
        className="flex items-center bg-[#2A2F3C] border-[#3A3F4C] text-white hover:bg-[#3A3F4C] hover:text-white"
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        Comments
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onToggle(auctionId)}
        className="flex items-center bg-[#2A2F3C] border-[#3A3F4C] text-white hover:bg-[#3A3F4C] hover:text-white"
      >
        <TrendingUp className="mr-2 h-4 w-4" />
        Bid History
      </Button>
    </div>
  );
};