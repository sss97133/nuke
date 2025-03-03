
import React from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export const SupportedFormats: React.FC = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Supported File Types</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[
            { icon: <FileSpreadsheet className="h-4 w-4 text-green-500" />, format: "CSV", desc: "Comma Separated Values" },
            { icon: <FileSpreadsheet className="h-4 w-4 text-blue-500" />, format: "XLSX", desc: "Excel Spreadsheet" },
            { icon: <FileText className="h-4 w-4 text-orange-500" />, format: "JSON", desc: "JavaScript Object Notation" },
            { icon: <FileText className="h-4 w-4 text-purple-500" />, format: "XML", desc: "Extensible Markup Language" }
          ].map((file, index) => (
            <div key={index} className="flex items-center gap-2 p-2">
              {file.icon}
              <div>
                <h4 className="font-medium">{file.format}</h4>
                <p className="text-xs text-muted-foreground">{file.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
