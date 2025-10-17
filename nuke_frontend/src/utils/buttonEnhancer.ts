/**
 * Button Enhancer - Makes buttons more engaging and fun to use
 * Adds click effects, loading states, and interactive feedback
 */

export class ButtonEnhancer {
  private static initialized = false;

  /**
   * Initialize button enhancements globally
   */
  static init() {
    if (this.initialized) return;

    // Add click feedback to all buttons
    document.addEventListener('click', (e) => {
      const button = (e.target as Element).closest('.button');
      if (button && !button.classList.contains('button-loading')) {
        this.addClickFeedback(button as HTMLElement);
      }
    });

    // Add keyboard navigation enhancements
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const button = e.target as HTMLElement;
        if (button.classList.contains('button')) {
          e.preventDefault();
          this.addClickFeedback(button);
          button.click();
        }
      }
    });

    this.initialized = true;
  }

  /**
   * Add satisfying click feedback animation
   */
  static addClickFeedback(button: HTMLElement) {
    // Remove any existing animation
    button.classList.remove('button-clicked');

    // Force reflow to restart animation
    button.offsetHeight;

    // Add click animation
    button.classList.add('button-clicked');

    // Remove after animation completes
    setTimeout(() => {
      button.classList.remove('button-clicked');
    }, 400);
  }

  /**
   * Show loading state with spinner
   */
  static showLoading(button: HTMLElement, loadingText?: string) {
    const originalText = button.textContent;

    // Store original state
    button.dataset.originalText = originalText || '';
    button.dataset.originalDisabled = button.getAttribute('disabled') || 'false';

    // Apply loading state
    button.classList.add('button-loading');
    button.setAttribute('disabled', 'true');

    if (loadingText) {
      button.textContent = loadingText;
    }

    return {
      stop: () => this.hideLoading(button)
    };
  }

  /**
   * Hide loading state and restore button
   */
  static hideLoading(button: HTMLElement) {
    button.classList.remove('button-loading');

    // Restore original text and disabled state
    const originalText = button.dataset.originalText;
    const originalDisabled = button.dataset.originalDisabled;

    if (originalText !== undefined) {
      button.textContent = originalText;
      delete button.dataset.originalText;
    }

    if (originalDisabled === 'false') {
      button.removeAttribute('disabled');
    }

    delete button.dataset.originalDisabled;
  }

  /**
   * Add success feedback animation
   */
  static showSuccess(button: HTMLElement, successText?: string, duration = 2000) {
    const originalClass = button.className;
    const originalText = button.textContent;

    // Apply success state
    button.className = originalClass.replace(/button-\w+/g, '') + ' button-success';
    if (successText) {
      button.textContent = successText;
    }

    // Restore after duration
    setTimeout(() => {
      button.className = originalClass;
      if (successText && originalText) {
        button.textContent = originalText;
      }
    }, duration);
  }

  /**
   * Add error feedback animation
   */
  static showError(button: HTMLElement, errorText?: string, duration = 2000) {
    const originalClass = button.className;
    const originalText = button.textContent;

    // Apply error state
    button.className = originalClass.replace(/button-\w+/g, '') + ' button-danger';
    if (errorText) {
      button.textContent = errorText;
    }

    // Shake animation
    button.style.animation = 'button-shake 0.5s ease-out';

    // Restore after duration
    setTimeout(() => {
      button.className = originalClass;
      button.style.animation = '';
      if (errorText && originalText) {
        button.textContent = originalText;
      }
    }, duration);
  }

  /**
   * Enhance specific button with common patterns
   */
  static enhance(button: HTMLElement, options: {
    clickFeedback?: boolean;
    loadingState?: boolean;
    successFeedback?: boolean;
    errorFeedback?: boolean;
  } = {}) {
    const {
      clickFeedback = true,
      loadingState = true,
      successFeedback = true,
      errorFeedback = true
    } = options;

    if (clickFeedback) {
      button.addEventListener('click', () => {
        this.addClickFeedback(button);
      });
    }

    // Add data attributes for easy integration
    if (loadingState) button.dataset.enhancedLoading = 'true';
    if (successFeedback) button.dataset.enhancedSuccess = 'true';
    if (errorFeedback) button.dataset.enhancedError = 'true';

    return {
      showLoading: (text?: string) => this.showLoading(button, text),
      hideLoading: () => this.hideLoading(button),
      showSuccess: (text?: string, duration?: number) => this.showSuccess(button, text, duration),
      showError: (text?: string, duration?: number) => this.showError(button, text, duration)
    };
  }

  /**
   * Create floating action button with enhanced interactions
   */
  static createFloatingButton(options: {
    icon: string;
    text?: string;
    onClick: () => void;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  }) {
    const { icon, text, onClick, position = 'bottom-right' } = options;

    const fab = document.createElement('button');
    fab.className = 'button button-primary floating-action-button';
    fab.innerHTML = `${icon} ${text || ''}`;
    fab.style.cssText = `
      position: fixed;
      z-index: 1000;
      border-radius: 50%;
      width: 56px;
      height: 56px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      font-size: 18px;
      ${this.getPositionStyles(position)}
    `;

    fab.addEventListener('click', onClick);

    document.body.appendChild(fab);

    // Add entrance animation
    fab.style.transform = 'scale(0)';
    fab.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

    setTimeout(() => {
      fab.style.transform = 'scale(1)';
    }, 100);

    return {
      element: fab,
      remove: () => {
        fab.style.transform = 'scale(0)';
        setTimeout(() => fab.remove(), 300);
      }
    };
  }

  private static getPositionStyles(position: string): string {
    const offset = '24px';
    switch (position) {
      case 'bottom-right': return `bottom: ${offset}; right: ${offset};`;
      case 'bottom-left': return `bottom: ${offset}; left: ${offset};`;
      case 'top-right': return `top: ${offset}; right: ${offset};`;
      case 'top-left': return `top: ${offset}; left: ${offset};`;
      default: return `bottom: ${offset}; right: ${offset};`;
    }
  }
}

// CSS for shake animation (should be added to design system)
const shakeStyles = `
  @keyframes button-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }
`;

// Add shake styles to document
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = shakeStyles;
  document.head.appendChild(styleSheet);
}