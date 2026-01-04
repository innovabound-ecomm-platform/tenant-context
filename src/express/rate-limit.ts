/**
 * Rate Limiting Middleware
 * 
 * Per-tenant rate limiting using Redis sliding window.
 * Designed to protect the platform from abuse while being
 * fair to legitimate high-volume users.
 * 
 * Algorithm: Sliding window counter
 * - Tracks requests in current and previous minute windows
 * - Weighted average provides smooth rate limiting
 */

import type { Request, Response, NextFunction } from "express";
import type { TenantRequest } from "./middleware.js";
import { getRedisClient } from "@innovabound-ecomm-platform/redis-client";
import { getRateLimitConfig, type RateLimitConfig } from "../entitlements.js";
import type { TenantContext } from "../types.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

const RATE_LIMIT_PREFIX = "ratelimit:";
const WINDOW_SIZE_MS = 60000; // 1 minute

/**
 * Default rate limits when tenant context is not available
 */
const ANONYMOUS_RATE_LIMITS: RateLimitConfig = {
  requestsPerMinute: 30,
  burstAllowance: 5,
};

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimitOptions {
  /** Skip rate limiting for these paths */
  skipPaths?: string[];
  
  /** Override rate limits (ignores tenant plan) */
  overrideLimits?: RateLimitConfig;
  
  /** Custom key extractor (default: tenant ID or IP) */
  keyExtractor?: (req: Request) => string;
  
  /** Response handler for rate-limited requests */
  onRateLimited?: (req: Request, res: Response, info: RateLimitInfo) => void;
  
  /** Header name for rate limit info */
  headerPrefix?: string;
}

export interface RateLimitInfo {
  key: string;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0];
    return first?.trim() || req.ip || "unknown";
  }
  return req.ip || "unknown";
}

function getCurrentWindow(): number {
  return Math.floor(Date.now() / WINDOW_SIZE_MS);
}

function getWindowKey(baseKey: string, window: number): string {
  return `${RATE_LIMIT_PREFIX}${baseKey}:${window}`;
}

// =============================================================================
// SLIDING WINDOW RATE LIMITER
// =============================================================================

async function checkRateLimit(
  key: string,
  limit: number,
  burstAllowance: number
): Promise<{ allowed: boolean; info: RateLimitInfo }> {
  const redis = getRedisClient();
  const currentWindow = getCurrentWindow();
  const previousWindow = currentWindow - 1;
  
  const currentKey = getWindowKey(key, currentWindow);
  const previousKey = getWindowKey(key, previousWindow);
  
  // Get counts from both windows
  const [currentCount, previousCount] = await Promise.all([
    redis.get(currentKey),
    redis.get(previousKey),
  ]);
  
  const currentRequests = parseInt(currentCount || "0", 10);
  const previousRequests = parseInt(previousCount || "0", 10);
  
  // Calculate weighted count (sliding window)
  const elapsedInCurrentWindow = Date.now() % WINDOW_SIZE_MS;
  const previousWeight = 1 - elapsedInCurrentWindow / WINDOW_SIZE_MS;
  const weightedCount = currentRequests + previousRequests * previousWeight;
  
  // Allow burst by using limit + burstAllowance
  const effectiveLimit = limit + burstAllowance;
  const allowed = weightedCount < effectiveLimit;
  
  // Calculate reset time
  const resetAt = (currentWindow + 1) * WINDOW_SIZE_MS;
  const retryAfterSeconds = Math.ceil((resetAt - Date.now()) / 1000);
  
  const info: RateLimitInfo = {
    key,
    limit,
    remaining: Math.max(0, Math.floor(effectiveLimit - weightedCount)),
    resetAt,
    retryAfterSeconds,
  };
  
  if (allowed) {
    // Increment counter
    const multi = redis.multi();
    multi.incr(currentKey);
    multi.expire(currentKey, 120); // 2 minutes TTL
    await multi.exec();
  }
  
  return { allowed, info };
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Rate limiting middleware for Express
 * 
 * Uses tenant ID from TenantContext when available, falls back to IP.
 * Rate limits are derived from tenant's plan.
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const {
    skipPaths = ["/health", "/metrics"],
    overrideLimits,
    keyExtractor,
    onRateLimited,
    headerPrefix = "X-RateLimit",
  } = options;
  
  return async (req: TenantRequest, res: Response, next: NextFunction) => {
    // Skip configured paths
    if (skipPaths.some((path) => req.path.startsWith(path))) {
      return next();
    }
    
    // Determine rate limit key
    let key: string;
    if (keyExtractor) {
      key = keyExtractor(req);
    } else if (req.tenant?.id) {
      key = `tenant:${req.tenant.id}`;
    } else {
      key = `ip:${getClientIp(req)}`;
    }
    
    // Get rate limit configuration
    let config: RateLimitConfig;
    if (overrideLimits) {
      config = overrideLimits;
    } else if (req.tenant) {
      config = getRateLimitConfig(req.tenant);
    } else {
      config = ANONYMOUS_RATE_LIMITS;
    }
    
    // Check rate limit
    const { allowed, info } = await checkRateLimit(
      key,
      config.requestsPerMinute,
      config.burstAllowance
    );
    
    // Set rate limit headers
    res.setHeader(`${headerPrefix}-Limit`, info.limit);
    res.setHeader(`${headerPrefix}-Remaining`, info.remaining);
    res.setHeader(`${headerPrefix}-Reset`, info.resetAt);
    
    if (!allowed) {
      res.setHeader("Retry-After", info.retryAfterSeconds);
      
      if (onRateLimited) {
        return onRateLimited(req, res, info);
      }
      
      return res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests. Please slow down.",
          retryAfter: info.retryAfterSeconds,
          limit: info.limit,
          remaining: info.remaining,
        },
      });
    }
    
    next();
  };
}

/**
 * Strict rate limiter for sensitive endpoints
 * Uses lower limits regardless of tenant plan
 */
export function strictRateLimitMiddleware(
  requestsPerMinute: number = 10,
  burstAllowance: number = 2
) {
  return rateLimitMiddleware({
    overrideLimits: { requestsPerMinute, burstAllowance },
  });
}

/**
 * Get current rate limit status for a tenant
 * Useful for admin dashboards
 */
export async function getRateLimitStatus(
  tenant: TenantContext
): Promise<RateLimitInfo> {
  const key = `tenant:${tenant.id}`;
  const config = getRateLimitConfig(tenant);
  
  const { info } = await checkRateLimit(
    key,
    config.requestsPerMinute,
    config.burstAllowance
  );
  
  return info;
}
