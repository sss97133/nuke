
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { StudioConfiguration } from "../StudioConfiguration";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";

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

// Test data
const mockUser = {
  data: {
    user: { id: "test-user-id" }
  },
  error: null
};

const mockStudioConfig = {
  workspace_dimensions: {
    length: 30,
    width: 20,
    height: 16
  },
  ptz_configurations: {
    tracks: [{
      position: { x: 0, y: 8, z: 0 },
      length: 10,
      speed: 1,
      coneAngle: 45,
    }],
    planes: { walls: [], ceiling: {} },
    roboticArms: []
  }
};

describe("StudioConfiguration", () => {
  const mockToast = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mocks
    (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  });

  const renderComponent = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <StudioConfiguration />
      </QueryClientProvider>
    );
  };

  it("should render loading state initially", () => {
    renderComponent();
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

    renderComponent();

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

    renderComponent();

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

  it("should handle PTZ track updates", async () => {
    // Mock successful config fetch and update
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: mockStudioConfig, error: null })
        })
      }),
      upsert: () => Promise.resolve({ error: null })
    }));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Studio Configuration")).toBeInTheDocument();
    });

    // Switch to PTZ configuration tab
    const ptzTab = screen.getByText("PTZ Configuration");
    fireEvent.click(ptzTab);

    // Add new PTZ track
    const addTrackButton = screen.getByText("Add Track");
    fireEvent.click(addTrackButton);

    // Verify new track is added
    await waitFor(() => {
      expect(screen.getAllByText(/Track \d/)).toHaveLength(2);
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

    renderComponent();

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

  it("should handle error state when loading configuration fails", async () => {
    // Mock failed config fetch
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: new Error("Failed to load config") })
        })
      })
    }));

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Error loading studio configuration")).toBeInTheDocument();
    });
  });
});
