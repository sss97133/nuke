
import { vi } from "vitest";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { mockUser, mockStudioConfig } from "../utils/testUtils";

export const setupMocks = () => {
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
};

export const getMockToast = () => {
  const mockToast = vi.fn();
  (useToast as ReturnType<typeof vi.fn>).mockReturnValue({ toast: mockToast });
  return mockToast;
};

export const setupSupabaseMocks = () => {
  (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  
  // Mock successful config fetch
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: mockStudioConfig, error: null })
      })
    }),
    upsert: () => Promise.resolve({ error: null })
  }));
};
