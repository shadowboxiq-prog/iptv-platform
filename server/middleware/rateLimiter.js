import { config } from '../config/index.js';

// In-memory tracker for failed attempts: Map<key, { count: number, lockedUntil: number }>
const attemptTracker = new Map();

// Periodic cleanup every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of attemptTracker.entries()) {
    if (data.lockedUntil && data.lockedUntil < now) {
      attemptTracker.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Middleware to enforce rate limiting on sensitive routes (e.g., login).
 */
export function loginRateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const username = req.body?.username ? String(req.body.username).toLowerCase().trim() : '';
  const key = `${ip}:${username}`;

  const now = Date.now();
  const record = attemptTracker.get(key);

  if (record && record.lockedUntil && record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return res.status(429).json({
      ok: false,
      error: `تم حظر محاولات الدخول مؤقتاً لتكرار الخطأ. يرجى المحاولة بعد ${remainingSeconds} ثانية.`,
      retryAfterSeconds: remainingSeconds
    });
  }

  req.rateLimitKey = key;
  next();
}

/**
 * Record a failed attempt for the current request key.
 */
export function recordFailedAttempt(key) {
  if (!key) return;
  const now = Date.now();
  const record = attemptTracker.get(key) || { count: 0, lockedUntil: 0 };
  record.count += 1;

  if (record.count >= config.maxLoginAttempts) {
    record.lockedUntil = now + (config.loginLockoutMinutes * 60 * 1000);
  }

  attemptTracker.set(key, record);
}

/**
 * Reset failed attempts upon successful login.
 */
export function resetAttempts(key) {
  if (key) {
    attemptTracker.delete(key);
  }
}
