/**
 * Rate Limiter for BaT Scraping Operations
 * Implements intelligent backoff and queue management
 */

interface RateLimiterConfig {
  maxConcurrent: number;
  delayBetweenRequests: number;
  exponentialBackoff: boolean;
  maxRetries: number;
  baseDelay: number;
}

interface QueueItem<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  priority: number;
}

export class BatRateLimiter {
  private queue: QueueItem<any>[] = [];
  private activeRequests = 0;
  private config: RateLimiterConfig;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      maxConcurrent: 3,
      delayBetweenRequests: 2000,
      exponentialBackoff: true,
      maxRetries: 3,
      baseDelay: 1000,
      ...config,
    };
  }

  async execute<T>(
    operation: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const item: QueueItem<T> = {
        operation,
        resolve,
        reject,
        retries: 0,
        priority,
      };

      // Insert into queue based on priority
      const insertIndex = this.queue.findIndex(q => q.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(insertIndex, 0, item);
      }

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.activeRequests >= this.config.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.activeRequests++;
    const item = this.queue.shift()!;

    try {
      // Add delay between requests
      if (this.config.delayBetweenRequests > 0) {
        await this.delay(this.config.delayBetweenRequests);
      }

      const result = await item.operation();
      item.resolve(result);
    } catch (error: any) {
      const isRateLimited = error?.status === 429 || error?.message?.includes('rate limit');

      if (isRateLimited && item.retries < this.config.maxRetries) {
        // Implement exponential backoff for rate limit errors
        const delay = this.config.exponentialBackoff
          ? this.config.baseDelay * Math.pow(2, item.retries)
          : this.config.baseDelay;

        console.log(`Rate limited. Retrying in ${delay}ms (attempt ${item.retries + 1}/${this.config.maxRetries})`);

        item.retries++;
        setTimeout(() => {
          // Re-queue with higher priority
          const insertIndex = this.queue.findIndex(q => q.priority < item.priority + 1);
          if (insertIndex === -1) {
            this.queue.push({ ...item, priority: item.priority + 1 });
          } else {
            this.queue.splice(insertIndex, 0, { ...item, priority: item.priority + 1 });
          }
          this.processQueue();
        }, delay);
      } else {
        item.reject(error);
      }
    } finally {
      this.activeRequests--;

      // Process next item in queue
      setTimeout(() => this.processQueue(), 100);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      maxConcurrent: this.config.maxConcurrent,
    };
  }

  clear() {
    this.queue.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }
}

// Global instance for BaT operations
export const batRateLimiter = new BatRateLimiter({
  maxConcurrent: 2, // Conservative for BaT
  delayBetweenRequests: 3000, // 3 second delay between requests
  exponentialBackoff: true,
  maxRetries: 5,
  baseDelay: 5000, // 5 second base delay for retries
});