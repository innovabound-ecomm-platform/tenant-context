/**
 * Tenant Entitlements Module
 * 
 * Provides quota checking and feature flag enforcement.
 * Used by services to validate tenant operations against their plan limits.
 * 
 * IMPORTANT: This module does NOT connect to the database directly.
 * Plan information must be provided via TenantContext from middleware.
 */

import type { TenantContext, TenantLimits, TenantPlan } from './types.js';

// =============================================================================
// FEATURE FLAGS
// =============================================================================

/**
 * Known feature flags for plan-based feature access
 */
export type FeatureFlag =
  | 'customDomains'
  | 'advancedAnalytics'
  | 'apiAccess'
  | 'whiteLabel'
  | 'prioritySupport'
  | 'ssoIntegration'
  | 'customIntegrations'
  | 'multiCurrency'
  | 'multiLanguage'
  | 'advancedSeo';

/**
 * Check if a tenant has access to a specific feature
 */
export function hasFeature(tenant: TenantContext, feature: FeatureFlag): boolean {
  // Plan-based features take priority
  if (tenant.plan?.features.includes(feature)) {
    return true;
  }
  
  // Fall back to site-level feature flags
  return tenant.features[feature] === true;
}

/**
 * Get all enabled features for a tenant
 */
export function getEnabledFeatures(tenant: TenantContext): string[] {
  const planFeatures = tenant.plan?.features ?? [];
  const siteFeatures = Object.entries(tenant.features)
    .filter(([, enabled]) => enabled)
    .map(([feature]) => feature);
  
  return [...new Set([...planFeatures, ...siteFeatures])];
}

// =============================================================================
// QUOTA TYPES
// =============================================================================

/**
 * Result of a quota check
 */
export interface QuotaCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string;
}

/**
 * Resource types that can be quota-limited
 */
export type QuotaResource = 
  | 'products'
  | 'orders'
  | 'users'
  | 'apiCalls'
  | 'storage';

// =============================================================================
// QUOTA CHECKING
// =============================================================================

/**
 * Default limits for tenants without a plan (trial/free tier)
 */
export const DEFAULT_LIMITS: TenantLimits = {
  maxProducts: 50,
  maxOrders: 100,
  maxUsers: 2,
  maxApiCallsPerDay: 1000,
  maxStorageMb: 256,
};

/**
 * Get the effective limits for a tenant
 */
export function getTenantLimits(tenant: TenantContext): TenantLimits {
  return tenant.plan?.limits ?? DEFAULT_LIMITS;
}

/**
 * Check if a resource operation is within quota
 * 
 * @param tenant - The tenant context
 * @param resource - The resource type being consumed
 * @param currentCount - Current count of the resource
 * @param incrementBy - How many resources will be added (default: 1)
 */
export function checkQuota(
  tenant: TenantContext,
  resource: QuotaResource,
  currentCount: number,
  incrementBy: number = 1
): QuotaCheckResult {
  const limits = getTenantLimits(tenant);
  
  let limit: number;
  switch (resource) {
    case 'products':
      limit = limits.maxProducts;
      break;
    case 'orders':
      limit = limits.maxOrders;
      break;
    case 'users':
      limit = limits.maxUsers;
      break;
    case 'apiCalls':
      limit = limits.maxApiCallsPerDay;
      break;
    case 'storage':
      limit = limits.maxStorageMb;
      break;
    default:
      // Unknown resource type - allow by default
      return {
        allowed: true,
        limit: Infinity,
        current: currentCount,
        remaining: Infinity,
      };
  }
  
  const newCount = currentCount + incrementBy;
  const allowed = newCount <= limit;
  const remaining = Math.max(0, limit - currentCount);
  
  return {
    allowed,
    limit,
    current: currentCount,
    remaining,
    message: allowed
      ? undefined
      : `${resource} quota exceeded: ${currentCount}/${limit} (plan: ${tenant.plan?.name ?? 'free'})`,
  };
}

/**
 * Assert that a quota operation is allowed, throw if not
 */
export function assertQuota(
  tenant: TenantContext,
  resource: QuotaResource,
  currentCount: number,
  incrementBy: number = 1
): void {
  const result = checkQuota(tenant, resource, currentCount, incrementBy);
  
  if (!result.allowed) {
    throw new QuotaExceededError(resource, result);
  }
}

// =============================================================================
// RATE LIMITING INFO
// =============================================================================

/**
 * Rate limit configuration from plan
 */
export interface RateLimitConfig {
  /** Requests per minute */
  requestsPerMinute: number;
  /** Burst allowance (extra requests allowed in short bursts) */
  burstAllowance: number;
}

/**
 * Default rate limits for tenants without a plan
 */
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  requestsPerMinute: 60,
  burstAllowance: 10,
};

/**
 * Get rate limit configuration for a tenant
 * 
 * Note: Actual rate limiting enforcement should be done at edge/BFF level.
 * This function provides configuration for the rate limiter.
 */
export function getRateLimitConfig(tenant: TenantContext): RateLimitConfig {
  // If plan has rate limits, use them
  // This would typically come from plan.apiRateLimit and plan.apiRateBurst
  // For now, we use a simple heuristic based on API call limits
  const limits = getTenantLimits(tenant);
  
  // Derive rate limits from daily API call quota
  // Formula: daily quota / 1440 minutes * safety factor
  const derivedRpm = Math.ceil(limits.maxApiCallsPerDay / 1440 * 2);
  
  return {
    requestsPerMinute: Math.max(derivedRpm, DEFAULT_RATE_LIMITS.requestsPerMinute),
    burstAllowance: Math.ceil(derivedRpm / 5),
  };
}

// =============================================================================
// ERRORS
// =============================================================================

/**
 * Error thrown when a quota is exceeded
 */
export class QuotaExceededError extends Error {
  readonly code = 'QUOTA_EXCEEDED';
  readonly statusCode = 402; // Payment Required
  readonly resource: QuotaResource;
  readonly result: QuotaCheckResult;
  
  constructor(resource: QuotaResource, result: QuotaCheckResult) {
    super(result.message ?? `${resource} quota exceeded`);
    this.name = 'QuotaExceededError';
    this.resource = resource;
    this.result = result;
  }
  
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      resource: this.resource,
      limit: this.result.limit,
      current: this.result.current,
    };
  }
}

/**
 * Error thrown when a feature is not available
 */
export class FeatureNotAvailableError extends Error {
  readonly code = 'FEATURE_NOT_AVAILABLE';
  readonly statusCode = 402; // Payment Required
  readonly feature: FeatureFlag;
  
  constructor(feature: FeatureFlag, planName?: string) {
    const message = planName
      ? `Feature '${feature}' is not available on the ${planName} plan`
      : `Feature '${feature}' is not available`;
    super(message);
    this.name = 'FeatureNotAvailableError';
    this.feature = feature;
  }
  
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      feature: this.feature,
    };
  }
}

/**
 * Assert that a tenant has access to a feature
 */
export function assertFeature(tenant: TenantContext, feature: FeatureFlag): void {
  if (!hasFeature(tenant, feature)) {
    throw new FeatureNotAvailableError(feature, tenant.plan?.name);
  }
}
