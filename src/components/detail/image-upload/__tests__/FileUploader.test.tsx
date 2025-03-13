import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FileUploader } from '../FileUploader';
import { useToast } from '@/hooks/use-toast';
import { renderWithProviders } from '@/test/test-utils';

// Mock file creation helper
const createMockFile = (name: string, size: number, type: string): File => {
  const file = new File(["mock content"], name, { type });
  Object.defineProperty(file, 'size', {
    get() { return size; }
  });
  return file;
};

// Mock the toast context
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn()
  }))
}));

// Mock URL methods
window.URL.createObjectURL = vi.fn();
window.URL.revokeObjectURL = vi.fn();

describe('FileUploader Component', () => {
  const mockProps = {
    onFilesSelected: vi.fn(),
    selectedFiles: [] as File[],
    setSelectedFiles: vi.fn(),
    maxFiles: 5,
    acceptedFileTypes: ['image/*'],
    maxFileSize: 5 * 1024 * 1024 // 5MB
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders file upload area', async () => {
    await act(async () => {
      renderWithProviders(<FileUploader {...mockProps} />);
    });

    expect(screen.getByText(/Drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/or click to select/i)).toBeInTheDocument();
  });

  it('handles file selection through input', async () => {
    await act(async () => {
      renderWithProviders(<FileUploader {...mockProps} />);
    });
    
    const file = createMockFile('test.jpg', 1024, 'image/jpeg');
    const input = screen.getByTestId('file-input');
    
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(mockProps.onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it('limits the number of files', async () => {
    const selectedFiles = [
      createMockFile('file1.jpg', 1024, 'image/jpeg'),
      createMockFile('file2.jpg', 1024, 'image/jpeg'),
      createMockFile('file3.jpg', 1024, 'image/jpeg'),
      createMockFile('file4.jpg', 1024, 'image/jpeg'),
      createMockFile('file5.jpg', 1024, 'image/jpeg')
    ];

    await act(async () => {
      renderWithProviders(
        <FileUploader
          {...mockProps}
          selectedFiles={selectedFiles}
        />
      );
    });

    const input = screen.getByTestId('file-input');
    const newFile = createMockFile('test6.jpg', 1024, 'image/jpeg');

    await act(async () => {
      fireEvent.change(input, { target: { files: [newFile] } });
    });

    expect(mockProps.onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/maximum of 5 files reached/i)).toBeInTheDocument();
  });

  it('validates file size', async () => {
    await act(async () => {
      renderWithProviders(
        <FileUploader
          {...mockProps}
          maxFileSize={1024} // 1KB limit
        />
      );
    });
    
    const input = screen.getByTestId('file-input');
    const largeFile = createMockFile('large.jpg', 2048, 'image/jpeg');

    await act(async () => {
      fireEvent.change(input, { target: { files: [largeFile] } });
    });

    expect(mockProps.onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/file size exceeds maximum/i)).toBeInTheDocument();
  });

  it('validates file type', async () => {
    await act(async () => {
      renderWithProviders(
        <FileUploader
          {...mockProps}
          acceptedFileTypes={['image/jpeg']}
        />
      );
    });
    
    const input = screen.getByTestId('file-input');
    const pngFile = createMockFile('test.png', 1024, 'image/png');

    await act(async () => {
      fireEvent.change(input, { target: { files: [pngFile] } });
    });

    expect(mockProps.onFilesSelected).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid file type/i)).toBeInTheDocument();
  });

  it('handles drag and drop', async () => {
    await act(async () => {
      renderWithProviders(<FileUploader {...mockProps} />);
    });
    
    const dropArea = screen.getByTestId('file-drop-area');
    const file = createMockFile('test.jpg', 1024, 'image/jpeg');

    await act(async () => {
      fireEvent.dragEnter(dropArea, {
        dataTransfer: {
          files: [file]
        }
      });
    });

    expect(dropArea).toHaveClass('border-primary');

    await act(async () => {
      fireEvent.drop(dropArea, {
        dataTransfer: {
          files: [file]
        }
      });
    });

    expect(mockProps.onFilesSelected).toHaveBeenCalledWith([file]);
  });

  it('handles file removal', async () => {
    const selectedFiles = [
      createMockFile('file1.jpg', 1024, 'image/jpeg'),
      createMockFile('file2.jpg', 1024, 'image/jpeg')
    ];

    await act(async () => {
      renderWithProviders(
        <FileUploader
          {...mockProps}
          selectedFiles={selectedFiles}
        />
      );
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove/i });

    await act(async () => {
      fireEvent.click(removeButtons[0]);
    });

    expect(mockProps.setSelectedFiles).toHaveBeenCalledWith([selectedFiles[1]]);
  });

  it('shows preview for image files', async () => {
    const selectedFiles = [
      createMockFile('image.jpg', 1024, 'image/jpeg')
    ];

    await act(async () => {
      renderWithProviders(
        <FileUploader
          {...mockProps}
          selectedFiles={selectedFiles}
        />
      );
    });

    expect(screen.getByTestId('image-preview')).toBeInTheDocument();
    expect(window.URL.createObjectURL).toHaveBeenCalledWith(selectedFiles[0]);
  });
});
