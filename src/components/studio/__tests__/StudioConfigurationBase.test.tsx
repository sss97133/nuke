
import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { StudioConfiguration } from "../StudioConfiguration";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import "@testing-library/jest-dom/vitest";
import { mockUser, mockStudioConfig, renderWithQueryClient } from "./utils/testUtils";

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

describe("StudioConfiguration - Base Loading", () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  });

  it("should render loading state initially", () => {
    renderWithQueryClient(<StudioConfiguration />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should load and display initial studio configuration", async () => {
    // Mock successful config fetch
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockStudioConfig, error: null })
        })
      })
    }));

    renderWithQueryClient(<StudioConfiguration />);

    await waitFor(() => {
      expect(screen.getByText("Studio Configuration")).toBeInTheDocument();
    });

    // Verify dimension inputs are populated
    const lengthInput = screen.getByLabelText(/Length/);
    const widthInput = screen.getByLabelText(/Width/);
    const heightInput = screen.getByLabelText(/Height/);

    expect(lengthInput).toHaveValue(30);
    expect(widthInput).toHaveValue(20);
    expect(heightInput).toHaveValue(16);
  });

  it("should handle error state when loading configuration fails", async () => {
    // Mock failed config fetch
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: new Error("Failed to load config") })
        })
      })
    }));

    renderWithQueryClient(<StudioConfiguration />);

    await waitFor(() => {
      expect(screen.getByText("Error loading studio configuration")).toBeInTheDocument();
    });
  });
});

