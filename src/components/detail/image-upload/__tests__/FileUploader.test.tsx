import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileUploader } from '../FileUploader';
import { useToast } from '@/components/ui/use-toast';

// Mock file creation helper
const createMockFile = (name: string, size: number, type: string): File => {
  const file = new File(["mock content"], name, { type });
  Object.defineProperty(file, 'size', {
    get() { return size; }
  });
  return file;
};

// Mock the toast context
vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn()
}));

// Mock URL methods
window.URL.createObjectURL = vi.fn();
window.URL.revokeObjectURL = vi.fn();

describe('FileUploader Component', () => {
  // Common props for testing
  const mockProps = {
    onFilesSelected: vi.fn(),
    selectedFiles: [],
    setSelectedFiles: vi.fn(),
    maxFiles: 5,
    maxSize: 5242880, // 5MB
    accept: 'image/*'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as any).mockReturnValue({ toast: vi.fn() });
  });

  it('renders correctly with default props', () => {
    render(<FileUploader {...mockProps} />);
    
    // Check if the uploader area is rendered
    expect(screen.getByText(/drag & drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/accepted file types/i)).toBeInTheDocument();
  });

  it('shows the correct accepted file types', () => {
    const acceptedFileTypes = ['image/png', 'application/pdf'];
    render(<FileUploader {...mockProps} acceptedFileTypes={acceptedFileTypes} />);
    
    const fileTypesText = screen.getByText(/accepted file types/i);
    expect(fileTypesText).toHaveTextContent('image/png, application/pdf');
  });

  it('handles file selection correctly', async () => {
    render(<FileUploader {...mockProps} />);
    
    // Create mock files
    const mockJpegFile = createMockFile('test.jpg', 1024, 'image/jpeg');
    const mockPdfFile = createMockFile('test.pdf', 2048, 'application/pdf');
    
    // Mock file input change
    const input = screen.getByRole('button').querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [mockJpegFile, mockPdfFile],
    });
    
    fireEvent.change(input);
    
    // Verify the callbacks were called
    await waitFor(() => {
      expect(mockProps.onFilesSelected).toHaveBeenCalledWith([mockJpegFile, mockPdfFile]);
      expect(mockProps.setSelectedFiles).toHaveBeenCalledWith([mockJpegFile, mockPdfFile]);
    });
  });

  it('rejects files that exceed the size limit', async () => {
    const maxFileSize = 1024 * 1024; // 1MB
    render(<FileUploader {...mockProps} maxFileSize={maxFileSize} />);
    
    // Create mock files (one within limit, one exceeding)
    const smallFile = createMockFile('small.jpg', 500 * 1024, 'image/jpeg'); // 500KB
    const largeFile = createMockFile('large.jpg', 2 * 1024 * 1024, 'image/jpeg'); // 2MB
    
    // Mock file input change
    const input = screen.getByRole('button').querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [smallFile, largeFile],
    });
    
    fireEvent.change(input);
    
    // Verify only the small file was accepted
    await waitFor(() => {
      expect(mockProps.onFilesSelected).toHaveBeenCalledWith([smallFile]);
      expect(mockProps.setSelectedFiles).toHaveBeenCalledWith([smallFile]);
    });
  });

  it('rejects files with invalid types', async () => {
    const acceptedFileTypes = ['image/jpeg', 'image/png'];
    render(<FileUploader {...mockProps} acceptedFileTypes={acceptedFileTypes} />);
    
    // Create mock files (one accepted, one not)
    const jpegFile = createMockFile('image.jpg', 1024, 'image/jpeg');
    const pdfFile = createMockFile('document.pdf', 2048, 'application/pdf');
    
    // Mock file input change
    const input = screen.getByRole('button').querySelector('input[type="file"]') as HTMLInputElement;
    
    Object.defineProperty(input, 'files', {
      value: [jpegFile, pdfFile],
    });
    
    fireEvent.change(input);
    
    // Verify only the jpeg file was accepted
    await waitFor(() => {
      expect(mockProps.onFilesSelected).toHaveBeenCalledWith([jpegFile]);
      expect(mockProps.setSelectedFiles).toHaveBeenCalledWith([jpegFile]);
    });
  });

  it('limits the number of files to maxFiles', () => {
    const { container } = render(<FileUploader {...mockProps} maxFiles={2} selectedFiles={[createMockFile('existing1.jpg', 1024, 'image/jpeg')]} />);

    // Mock file input change
    const dropArea = screen.getByTestId('file-drop-area');
    const input = dropArea.querySelector('input[type="file"]') as HTMLInputElement;

    Object.defineProperty(input, 'files', {
      value: [
        createMockFile('test1.jpg', 1024, 'image/jpeg'),
        createMockFile('test2.jpg', 1024, 'image/jpeg')
      ]
    });

    fireEvent.change(input);

    expect(mockProps.onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/Maximum number of files exceeded/)).toBeInTheDocument();
  });

  it('shows disabled state when at max capacity', () => {
    const maxFiles = 3;
    const selectedFiles = [
      createMockFile('file1.jpg', 1024, 'image/jpeg'),
      createMockFile('file2.jpg', 1024, 'image/jpeg'),
      createMockFile('file3.jpg', 1024, 'image/jpeg')
    ];
    
    render(
      <FileUploader
        {...mockProps}
        maxFiles={maxFiles}
        selectedFiles={selectedFiles}
      />
    );
    
    // Check for disabled state indications
    expect(screen.getByText(/maximum of 3 files reached/i)).toBeInTheDocument();
    
    // Drop area should have appropriate attributes and styles
    const dropArea = screen.getByTestId('file-drop-area');
    expect(dropArea).toHaveAttribute('aria-disabled', 'true');
  });

  it('handles file removal correctly', async () => {
    const selectedFiles = [
      createMockFile('file1.jpg', 1024, 'image/jpeg'),
      createMockFile('file2.jpg', 1024, 'image/jpeg')
    ];
    
    render(
      <FileUploader
        {...mockProps}
        selectedFiles={selectedFiles}
        setSelectedFiles={mockProps.setSelectedFiles}
      />
    );
    
    // Find and click the remove button for the first file
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    fireEvent.click(removeButtons[0]);
    
    // Verify the file was removed
    await waitFor(() => {
      expect(mockProps.onFilesSelected).toHaveBeenCalledWith([selectedFiles[1]]);
      expect(mockProps.setSelectedFiles).toHaveBeenCalledWith([selectedFiles[1]]);
    });
  });
});
