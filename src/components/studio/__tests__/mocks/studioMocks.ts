
import { vi } from "vitest";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { mockUser, mockStudioConfig } from "../utils/testUtils";

// Mock toast function
export const getMockToast = () => {
  const mockToast = vi.fn();
  return mockToast;
};

// Set up all mocks
export const setupMocks = () => {
  vi.mock("@/hooks/use-toast", () => ({
    useToast: vi.fn(),
  }));

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
};

// Set up supabase mocks
export const setupSupabaseMocks = () => {
  (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: mockStudioConfig, error: null })
      })
    }),
    upsert: () => Promise.resolve({ error: null })
  }));
};
