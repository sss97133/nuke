
import React from 'react';
import { ImportGarageWizard } from "@/components/garage/ImportGarageWizard";

export const Import = () => {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Import Vehicle Data</h1>
      <ImportGarageWizard />
    </div>
  );
};
