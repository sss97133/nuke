interface RecordDetailsProps {
  createdAt: string;
  updatedAt: string;
}

export const RecordDetails = ({ createdAt, updatedAt }: RecordDetailsProps) => {
  return (
    <div className="pt-4 border-t border-[#283845]">
      <h3 className="font-mono text-sm text-[#666] mb-2">Record Details</h3>
      <p className="text-xs font-mono text-[#666]">
        Created: {new Date(createdAt).toLocaleDateString()}
      </p>
      <p className="text-xs font-mono text-[#666]">
        Last Updated: {new Date(updatedAt).toLocaleDateString()}
      </p>
    </div>
  );
};