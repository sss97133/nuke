interface FilePreview {
  url: string;
  name: string;
  size: string;
}

interface ImagePreviewProps {
  preview: FilePreview | null;
}

export const ImagePreview = ({ preview }: ImagePreviewProps) => {
  if (!preview) return null;

  return (
    <div className="p-4 border rounded-lg space-y-4">
      <div className="aspect-square w-48 mx-auto relative">
        <img
          src={preview.url}
          alt="Preview"
          className="w-full h-full object-cover rounded-md"
        />
      </div>
      <div className="text-sm space-y-1">
        <p className="font-medium">{preview.name}</p>
        <p className="text-muted-foreground">{preview.size}</p>
      </div>
    </div>
  );
};