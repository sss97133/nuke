
// Mock data for studio configuration tests
export const mockUseStudioConfig = () => {
  return {
    studioConfig: {
      name: "Test Studio",
      width: 1920,
      height: 1080,
      cameraConfig: {
        zoom: 1,
        pan: 0,
        tilt: 0
      }
    },
    isLoading: false,
    error: null,
    saveStudioConfig: mockSaveStudioConfig
  };
};

export const mockSaveStudioConfig = vi.fn();
