// Content script for handling code platform integrations

// Match patterns for supported platforms
const SUPPORTED_PLATFORMS = {
  COLAB: /https:\/\/colab\.research\.google\.com\/.*/,
  STACKBLITZ: /https:\/\/.*\.stackblitz\.com\/.*/,
  DEEPNOTE: /https:\/\/.*\.deepnote\.com\/.*/,
  DATABRICKS: /https:\/\/.*\.(databricks\.com|azuredatabricks\.net)\/.*/,
  QUADRATIC: /https:\/\/.*\.quadratichq\.com\/.*/,
  JSFIDDLE: /https?:\/\/.*\.jsfiddle\.net(\/.*)?/,
  CODEPEN: /https:\/\/.*\.codepen\.io(\/.*)?/,
  CODESHARE: /https:\/\/.*\.codeshare\.io(\/.*)?/,
  PAPERSPACE: /https:\/\/console\.paperspace\.com\/.*\/notebook\/.*/,
  CODEWARS: /https?:\/\/www\.codewars\.com(\/.*)?/,
  GITHUB: /https:\/\/.*\.github\.com(\/.*)?/,
  LOCAL_NOTEBOOK: /http:\/\/(localhost|127\.0\.0\.1):[0-9]+\/.*\.ipynb/,
  GOOGLE_SCRIPT: /https:\/\/.*\.script\.google\.com(\/.*)?/
};

// Determine which platform we're on
const getCurrentPlatform = () => {
  const url = window.location.href;
  return Object.entries(SUPPORTED_PLATFORMS).find(([_, pattern]) => 
    pattern.test(url)
  )?.[0];
};

// Initialize platform-specific functionality
const initializePlatform = async () => {
  const platform = getCurrentPlatform();
  if (!platform) return;

  console.log(`Nuke extension initialized for ${platform}`);

  // Send platform info to background script
  chrome.runtime.sendMessage({
    type: 'PLATFORM_DETECTED',
    payload: {
      platform,
      url: window.location.href
    }
  });

  // Platform-specific initialization
  switch (platform) {
    case 'GITHUB':
      initializeGitHub();
      break;
    case 'COLAB':
      initializeColab();
      break;
    // Add more platform initializations as needed
  }
};

// GitHub-specific initialization
const initializeGitHub = () => {
  // Listen for repository changes
  const observer = new MutationObserver(() => {
    const repoInfo = getGitHubRepoInfo();
    if (repoInfo) {
      chrome.runtime.sendMessage({
        type: 'GITHUB_REPO_DETECTED',
        payload: repoInfo
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
};

// Get GitHub repository information
const getGitHubRepoInfo = () => {
  const metaTags = document.getElementsByTagName('meta');
  const repoInfo: any = {};

  for (const tag of metaTags) {
    const name = tag.getAttribute('name');
    if (name?.startsWith('octolytics-')) {
      const key = name.replace('octolytics-', '');
      repoInfo[key] = tag.getAttribute('content');
    }
  }

  return Object.keys(repoInfo).length > 0 ? repoInfo : null;
};

// Google Colab-specific initialization
const initializeColab = () => {
  // Listen for notebook changes
  const observer = new MutationObserver(() => {
    const cells = document.querySelectorAll('.cell');
    if (cells.length > 0) {
      chrome.runtime.sendMessage({
        type: 'COLAB_NOTEBOOK_DETECTED',
        payload: {
          cellCount: cells.length,
          url: window.location.href
        }
      });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
};

// Initialize when the content script loads
initializePlatform();
