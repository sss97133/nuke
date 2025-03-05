# Ownership and File Upload Components

This documentation covers the newly added components for handling ownership information and file uploads.

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
import { FileUploader } from '../components/FileUploader';

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

### 2. OwnershipSection Component

The `OwnershipSection` component provides a complete interface for capturing ownership information for vehicles or other assets, featuring:

- Radio selection for ownership status (Owned, Claimed, Discovered)
- Conditional input fields based on ownership status
- File upload integration for ownership documentation
- Context-specific help text for each ownership type

```tsx
import { OwnershipSection, OwnershipData } from '../components/OwnershipSection';

// Usage example
const [ownershipData, setOwnershipData] = useState<OwnershipData>({
  status: 'owned',
  documents: [],
});

function handleOwnershipChange(data: OwnershipData) {
  setOwnershipData(data);
  console.log('Ownership data updated:', data);
}

<OwnershipSection
  value={ownershipData}
  onChange={handleOwnershipChange}
/>
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `value` | `OwnershipData` | Current ownership data |
| `onChange` | `(data: OwnershipData) => void` | Callback when ownership data changes |

#### OwnershipData Interface

```tsx
export type OwnershipStatus = 'owned' | 'claimed' | 'discovered';

export interface OwnershipData {
  status: OwnershipStatus;
  documents: File[];
  purchaseDate?: string;
  purchasePrice?: string;
  purchaseLocation?: string;
  discoveryDate?: string;
  discoveryLocation?: string;
  discoveryNotes?: string;
}
```

## Implementation Example

See the `VehicleFormExample.tsx` file in the `src/pages` directory for a complete implementation example.

## Best Practices

1. **File Handling**:
   - Always process uploaded files on the server-side before storage
   - Validate file types and sizes on both client and server
   - Consider adding virus scanning for uploaded files

2. **Form Submission**:
   - Use FormData to handle file uploads with other form data
   - Consider using React Hook Form for more complex form state management
   - Add proper validation before submission

3. **Accessibility**:
   - The components include basic accessibility features (labels, focus states)
   - For production, consider additional a11y testing and improvements

4. **Performance**:
   - Large files should be uploaded in chunks or with a progress indicator
   - Consider adding image compression for uploaded images
