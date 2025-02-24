
import { screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("StudioConfiguration - PTZ Features", () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
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

    renderWithQueryClient(<StudioConfiguration />);

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
});

