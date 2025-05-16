import { Wrench } from "lucide-react";

interface ModificationsListProps {
  modifications: string[];
}

export const ModificationsList = ({ modifications }: ModificationsListProps) => (
  <div className="bg-white p-4 rounded-lg border shadow-sm">
    <h4 className="font-mono text-sm font-semibold mb-3 flex items-center gap-2">
      <Wrench className="h-4 w-4 text-[#283845]" />
      Modifications
    </h4>
    <ul className="space-y-2 list-disc list-inside">
      {modifications.map((mod, index) => (
        <li key={index} className="font-mono text-sm text-[#283845]">{mod}</li>
      ))}
    </ul>
  </div>
);