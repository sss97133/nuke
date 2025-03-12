import React from 'react';
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { GarageSelector } from "../GarageSelector";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { renderWithProviders } from "@/test/test-utils";

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
    (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
    (useNavigate as ReturnType<typeof vi.fn>).mockReturnValue(mockNavigate);
    
    // Setup Supabase mocks
    (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  });

  it("should render loading state initially", () => {
    renderWithProviders(<GarageSelector />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("should display garages when data is loaded", async () => {
    const mockGarages = [
      { id: 1, name: "Test Garage 1", description: "Test Description 1" },
      { id: 2, name: "Test Garage 2", description: "Test Description 2" }
    ];

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ data: mockGarages, error: null }),
    } as any);

    renderWithProviders(<GarageSelector />);

    await waitFor(() => {
      expect(screen.getByText("Test Garage 1")).toBeInTheDocument();
      expect(screen.getByText("Test Garage 2")).toBeInTheDocument();
    });
  });

  it("should handle garage selection", async () => {
    const mockGarages = [
      { id: 1, name: "Test Garage 1", description: "Test Description 1" },
      { id: 2, name: "Test Garage 2", description: "Test Description 2" }
    ];

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ data: mockGarages, error: null }),
    } as any);

    renderWithProviders(<GarageSelector />);

    await waitFor(() => {
      const selectButtons = screen.getAllByRole("button", { name: /Select/i });
      fireEvent.click(selectButtons[0]);
    });

    expect(screen.getByText("Selected: Test Garage 1")).toBeInTheDocument();
  });

  it("should display error message when garage fetch fails", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({ data: [], error: new Error("Failed to fetch garages") }),
    } as any);

    renderWithProviders(<GarageSelector />);

    await waitFor(() => {
      expect(screen.getByText("No Garages Found")).toBeInTheDocument();
      expect(screen.getByText("You don't have access to any garages yet.")).toBeInTheDocument();
    });
  });
});
