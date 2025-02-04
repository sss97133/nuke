import { Car } from "lucide-react";

interface HistorySectionProps {
  title: string;
  content: string;
}

export const HistorySection = ({ title, content }: HistorySectionProps) => (
  <div className="bg-white p-4 rounded-lg border shadow-sm">
    <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
      <Car className="h-4 w-4 text-[#283845]" />
      {title}
    </h4>
    <p className="font-mono text-sm text-[#283845] whitespace-pre-wrap">
      {content}
    </p>
  </div>
);