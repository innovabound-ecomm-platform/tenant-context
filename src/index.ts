/**
 * @innovabound-ecomm-platform/tenant-context
 *
 * Shared tenant context utilities for multi-tenant services.
 * Provides middleware and helpers for resolving tenant from requests.
 */

export {
  createTenantMiddleware,
  clearTenantMiddlewareCache,
  invalidateTenantFromCache,
  type TenantMiddlewareOptions,
} from './middleware';

export {
  TenantContext,
  type TenantInfo,
  type TenantInfoBasic,
  type TenantLimits,
  type PlanType,
  type AddonType,
} from './context';

export {
  extractTenantFromJwt,
  extractTenantFromHeader,
  type JwtTenantPayload,
} from './extractors';

export {
  resolveTenantFromHostname,
  resolveTenantBySlug,
  resolveTenantByCustomDomain,
  extractSubdomain,
  parseSubdomain,
  clearTenantCache,
  invalidateTenantCache,
  type ResolvedTenant,
  type TenantResolutionResult,
} from './resolver';
