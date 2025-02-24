
import { vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

export const mockUser = {
  data: {
    user: { id: "test-user-id" }
  },
  error: null
};

export const mockStudioConfig = {
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

export const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

export const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};
