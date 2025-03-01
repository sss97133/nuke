
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { StudioConfiguration } from "../StudioConfiguration";
import "@testing-library/jest-dom/vitest";
import { renderWithQueryClient } from "./utils/testUtils";
import { setupMocks, getMockToast, setupSupabaseMocks } from "./mocks/studioMocks";

// Set up all mocks
setupMocks();

describe("StudioConfiguration - PTZ Features", () => {
  let mockToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = getMockToast();
    setupSupabaseMocks();
  });

  it("should handle PTZ track updates", async () => {
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
