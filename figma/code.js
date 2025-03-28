figma.showUI(__html__, { width: 400, height: 600 });

// Listen for messages from the UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'load-styles') {
    try {
      const response = await fetch('http://localhost:3333/stylesheets');
      const data = await response.json();
      figma.ui.postMessage({ type: 'styles-loaded', data });
    } catch (error) {
      figma.ui.postMessage({ type: 'error', message: error.message });
    }
  }
}; 