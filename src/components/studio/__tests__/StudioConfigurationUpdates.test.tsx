
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { StudioConfiguration } from "../StudioConfiguration";
import "@testing-library/jest-dom/vitest";
import { renderWithQueryClient, mockStudioConfig } from "./utils/testUtils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

// Mock dependencies
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    })),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

describe("StudioConfiguration - Updates", () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({ 
      data: { user: { id: 'test-user-id' } }, 
      error: null 
    });
  });

  it("should update studio dimensions", async () => {
    // Mock successful config fetch and update
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockStudioConfig, error: null })
        })
      }),
      upsert: () => Promise.resolve({ error: null })
    }));

    renderWithQueryClient(<StudioConfiguration />);

    await waitFor(() => {
      expect(screen.getByText("Studio Configuration")).toBeInTheDocument();
    });

    const lengthInput = screen.getByLabelText(/Length/);
    fireEvent.change(lengthInput, { target: { value: "40" } });

    const saveButton = screen.getByText("Save Configuration");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Success",
        description: "Studio configuration updated successfully",
      });
    });
  });

  it("should handle configuration save errors", async () => {
    // Mock successful fetch but failed update
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockStudioConfig, error: null })
        })
      }),
      upsert: () => Promise.resolve({ error: new Error("Failed to update") })
    }));

    renderWithQueryClient(<StudioConfiguration />);

    await waitFor(() => {
      expect(screen.getByText("Studio Configuration")).toBeInTheDocument();
    });

    const saveButton = screen.getByText("Save Configuration");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to update studio configuration",
        variant: "destructive",
      });
    });
  });
});
