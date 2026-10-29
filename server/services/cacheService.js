/**
 * High-performance In-Memory LRU & TTL Cache with in-flight Request Deduplication.
 * Optimizes IPTV streaming when multiple viewers connect simultaneously or buffer chunks.
 */

export class StreamCache {
  /**
   * @param {number} maxSizeMB Maximum cache memory size in megabytes (default: 150MB)
   * @param {number} defaultTTL Default item time-to-live in milliseconds (default: 45000ms)
   */
  constructor(maxSizeMB = 150, defaultTTL = 45000) {
    this.maxSizeBytes = maxSizeMB * 1024 * 1024;
    this.defaultTTL = defaultTTL;
    this.currentSizeBytes = 0;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.delete(key);
      return null;
    }

    // Refresh LRU order (move accessed item to the end)
    this.cache.delete(key);
    this.cache.set(key, item);
    return item;
  }

  set(key, buffer, contentType, ttl = this.defaultTTL) {
    const size = buffer.length;
    // Evict oldest items if needed to stay within memory budget
    while (this.currentSizeBytes + size > this.maxSizeBytes && this.cache.size > 0) {
      const firstKey = this.cache.keys().next().value;
      this.delete(firstKey);
    }

    // If single item is larger than cache budget, don't cache
    if (size > this.maxSizeBytes) {
      return;
    }

    const item = {
      buffer,
      contentType,
      expiresAt: Date.now() + ttl,
      size
    };

    this.cache.set(key, item);
    this.currentSizeBytes += size;
  }

  delete(key) {
    const item = this.cache.get(key);
    if (item) {
      this.currentSizeBytes -= item.size;
      this.cache.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.currentSizeBytes = 0;
    this.inFlight.clear();
  }

  /**
   * Deduplicate concurrent in-flight requests for identical segments/playlists.
   * If 5 viewers ask for segment_123.ts at once, only 1 fetch to upstream occurs.
   * All 5 viewers receive the result simultaneously.
   * 
   * @param {string} key Unique cache key
   * @param {Function} fetchFn Async function returning { buffer, contentType, ttl }
   * @returns {Promise<{ buffer: Buffer, contentType: string }>}
   */
  async fetchDeduplicated(key, fetchFn) {
    const cached = this.get(key);
    if (cached) {
      return cached;
    }

    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const result = await fetchFn();
        if (result && result.buffer) {
          this.set(key, result.buffer, result.contentType, result.ttl || this.defaultTTL);
        }
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

// Global segment & playlist cache instances
export const segmentCache = new StreamCache(150, 60000); // 150MB, 60s for video chunks
export const manifestCache = new StreamCache(30, 2500);   // 30MB, 2.5s for live M3U8 playlists
export default { segmentCache, manifestCache, StreamCache };
