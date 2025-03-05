# Ownership and File Upload Components

This documentation covers the components for handling ownership information and file uploads in the vehicle management system.

## Components Overview

### 1. FileUploader Component

The `FileUploader` component provides a user-friendly interface for uploading and managing files, with features including:

- Drag-and-drop file selection
- Click-to-select file browser
- File preview thumbnails for images
- File type identification
- File size display
- Duplicate file detection
- Maximum file limit enforcement

```tsx
import { FileUploader } from '../../../detail/image-upload/FileUploader';

// Usage example
const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

function handleFilesSelected(files: File[]) {
  console.log('Files selected:', files);
}

<FileUploader
  selectedFiles={selectedFiles}
  setSelectedFiles={setSelectedFiles}
  onFilesSelected={handleFilesSelected}
  acceptedFileTypes={['image/*', 'application/pdf']}
  maxFiles={5}
/>
```

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `selectedFiles` | `File[]` | Required | Currently selected files |
| `setSelectedFiles` | `React.Dispatch<React.SetStateAction<File[]>>` | Required | State setter for selected files |
| `onFilesSelected` | `(files: File[]) => void` | Required | Callback when files are selected |
| `acceptedFileTypes` | `string[]` | `['image/*', 'application/pdf']` | Array of MIME types to accept |
| `maxFiles` | `number` | `5` | Maximum number of files allowed |

### 2. ImagePreview Component

The `ImagePreview` component handles the display of uploaded files, showing image previews for images and type indicators for other file types.

```tsx
import { ImagePreview } from '../../../detail/image-upload/ImagePreview';

// Usage example
<ImagePreview file={myFile} />
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `file` | `File` | The file to preview |

### 3. OwnershipSection Component

The `OwnershipSection` component provides a complete interface for capturing ownership information for vehicles or other assets, featuring:

- Radio selection for ownership status (Owned, Claimed, Discovered)
- Conditional input fields based on ownership status
- File upload integration for ownership documentation
- Context-specific help text for each ownership type

```tsx
import { OwnershipSection } from '../components/vehicles/forms/components/OwnershipSection';

// Usage example with a form library
const form = {
  getValues: () => ({ ownershipStatus: 'owned', documents: [] }),
  setValue: (name, value) => console.log(`Setting ${name} to:`, value),
  watch: (name) => form.getValues()[name]
};

<OwnershipSection form={form} />
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `form` | Form object | Object with getValues, setValue, and watch methods (compatible with React Hook Form) |

## File Structure

The components are organized in the following structure:

```
src/
├── components/
│   ├── detail/
│   │   └── image-upload/
│   │       ├── FileUploader.tsx   # File upload component
│   │       └── ImagePreview.tsx   # File preview component
│   ├── ui/                        # UI components (buttons, inputs, etc.)
│   └── vehicles/
│       └── forms/
│           └── components/
│               └── OwnershipSection.tsx  # Vehicle ownership form section
```

## Implementation Example

To use these components in a form:

```tsx
import { OwnershipSection } from '@/components/vehicles/forms/components/OwnershipSection';
import { useForm } from 'react-hook-form';

export default function VehicleForm() {
  const form = useForm({
    defaultValues: {
      ownershipStatus: 'owned',
      documents: [],
    }
  });

  const onSubmit = form.handleSubmit((data) => {
    console.log('Form submitted with data:', data);
  });

  return (
    <form onSubmit={onSubmit}>
      <OwnershipSection form={form} />
      <button type="submit">Save Vehicle</button>
    </form>
  );
}
```

## Best Practices

1. **File Handling**:
   - Always process uploaded files on the server-side before storage
   - Validate file types and sizes on both client and server
   - Consider adding virus scanning for uploaded files

2. **Form Submission**:
   - Use FormData to handle file uploads with other form data
   - Consider using React Hook Form for complex form state management
   - Add proper validation before submission

3. **Accessibility**:
   - The components include basic accessibility features (labels, focus states)
   - For production, consider additional a11y testing and improvements

4. **Performance**:
   - Large files should be uploaded in chunks or with a progress indicator
   - Consider adding image compression for uploaded images
