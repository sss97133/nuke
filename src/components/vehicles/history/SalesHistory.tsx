import { Calendar, DollarSign } from "lucide-react";

interface Sale {
  date?: string;
  price?: number;
  source?: string;
}

interface SalesHistoryProps {
  sales: Sale[];
}

export const SalesHistory = ({ sales }: SalesHistoryProps) => (
  <div className="bg-white p-4 rounded-lg border shadow-sm">
    <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
      <DollarSign className="h-4 w-4 text-[#283845]" />
      Sales History
    </h4>
    <div className="space-y-3">
      {sales.map((sale, index) => (
        <div key={index} className="bg-gray-50 p-3 rounded-md text-sm font-mono">
          <div className="flex items-center gap-2 text-[#283845]">
            {sale.date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {sale.date}</span>}
            {sale.price && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> {sale.price}</span>}
          </div>
          {sale.source && <div className="text-muted-foreground text-xs mt-1">Source: {sale.source}</div>}
        </div>
      ))}
    </div>
  </div>
);