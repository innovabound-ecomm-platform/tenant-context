/**
 * Tenant Context - Express Integration
 * 
 * Re-exports for Express framework integration.
 */

export { tenantMiddleware, requireTenantMiddleware, optionalTenantMiddleware } from './middleware.js';
export type { TenantRequest, TenantMiddlewareOptions } from './middleware.js';

// Rate limiting
export {
  rateLimitMiddleware,
  strictRateLimitMiddleware,
  getRateLimitStatus,
} from './rate-limit.js';
export type { RateLimitOptions, RateLimitInfo } from './rate-limit.js';
