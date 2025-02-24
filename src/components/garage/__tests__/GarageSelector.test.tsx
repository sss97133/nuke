
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { GarageSelector } from "../GarageSelector";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

// Mock dependencies
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(),
}));

// Test data
const mockGarages = [
  { id: "1", name: "Test Garage 1", garage_members: [{ role: "owner", status: "active" }] },
  { id: "2", name: "Test Garage 2", garage_members: [{ role: "member", status: "active" }] },
];

const mockUser = {
  data: {
    user: { id: "test-user-id" }
  },
  error: null
};

describe("GarageSelector", () => {
  const mockToast = vi.fn();
  const mockNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mocks
    (useToast as jest.Mock).mockReturnValue({ toast: mockToast });
    (useNavigate as jest.Mock).mockReturnValue(mockNavigate);
    
    // Setup Supabase mocks
    (supabase.auth.getUser as jest.Mock).mockResolvedValue(mockUser);
  });

  it("should render loading state initially", () => {
    render(<GarageSelector />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("should display garages when data is loaded", async () => {
    // Mock successful garage data fetch
    (supabase.from as jest.Mock).mockImplementation((table) => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: mockGarages, error: null })
        })
      })
    }));

    render(<GarageSelector />);

    await waitFor(() => {
      expect(screen.getByText("Test Garage 1")).toBeInTheDocument();
      expect(screen.getByText("Test Garage 2")).toBeInTheDocument();
    });
  });

  it("should handle garage selection", async () => {
    // Mock successful garage selection
    (supabase.from as jest.Mock).mockImplementation((table) => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: mockGarages, error: null })
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null })
      })
    }));

    render(<GarageSelector />);

    await waitFor(() => {
      const selectButton = screen.getAllByText("Select Garage")[0];
      fireEvent.click(selectButton);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Garage Selected",
        description: "Successfully switched active garage"
      });
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("should display error message when garage fetch fails", async () => {
    // Mock failed garage fetch
    (supabase.from as jest.Mock).mockImplementation((table) => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: null, error: new Error("Failed to fetch garages") })
        })
      })
    }));

    render(<GarageSelector />);

    await waitFor(() => {
      expect(screen.getByText("No Garages Found")).toBeInTheDocument();
      expect(screen.getByText("You don't have access to any garages yet.")).toBeInTheDocument();
    });
  });

  it("should handle garage selection error", async () => {
    // Mock successful fetch but failed update
    (supabase.from as jest.Mock).mockImplementation((table) => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve({ data: mockGarages, error: null })
        }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: new Error("Failed to update") })
      })
    }));

    render(<GarageSelector />);

    await waitFor(() => {
      const selectButton = screen.getAllByText("Select Garage")[0];
      fireEvent.click(selectButton);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Error",
        description: "Failed to select garage. Please try again.",
        variant: "destructive"
      });
    });
  });
});
