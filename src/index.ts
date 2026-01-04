/**
 * Tenant Context Package
 * 
 * Multi-tenant context resolution and enforcement for the e-commerce platform.
 * 
 * @packageDocumentation
 * @module @innovabound-ecomm-platform/tenant-context
 * 
 * @example Basic usage with Express
 * ```typescript
 * import { tenantMiddleware, getTenantId, tenantWhere } from '@innovabound-ecomm-platform/tenant-context/express';
 * 
 * // Add middleware
 * app.use(tenantMiddleware({
 *   required: true,
 *   skipPaths: ['/health'],
 *   jwt: { jwksUrl: 'http://auth-service:8003/auth/.well-known/jwks.json' }
 * }));
 * 
 * // Use in handlers
 * app.get('/products', async (req, res) => {
 *   const products = await prisma.product.findMany({
 *     where: tenantWhere(req.tenant, { status: 'PUBLISHED' })
 *   });
 *   res.json(products);
 * });
 * ```
 */

// Types
export type {
  TenantContext,
  TenantStatus,
  DomainStatus,
  DomainType,
  TenantClaims,
  TenantPlan,
  TenantLimits,
  TenantDomain,
  TenantAwareJwtPayload,
  RequestContext,
  TenantResolutionResult,
} from './types.js';

// Errors
export {
  TenantError,
  TenantMissingError,
  TenantNotFoundError,
  TenantSuspendedError,
  TenantArchivedError,
  TenantMaintenanceError,
  TenantAccessDeniedError,
  TenantLimitExceededError,
  TenantClaimsMissingError,
  isTenantError,
  isTenantUnavailableError,
} from './errors.js';

// Headers
export {
  TENANT_HEADERS,
  UPSTREAM_HEADERS,
  getHeader,
  setTenantHeaders,
} from './headers.js';

// JWT
export {
  initializeWithPublicKey,
  initializeWithJwks,
  verifyJwt,
  extractTenantPayload,
  extractSiteIdFromJwt,
  resolveTenantFromJwt,
  getTenantFromJwt,
} from './jwt.js';
export type { JwtTenantConfig } from './jwt.js';

// Guards
export {
  requireTenant,
  getTenantId,
  requireActiveTenant,
  tenantWhere,
  tenantData,
  validateTenantOwnership,
  belongsToTenant,
  filterByTenant,
} from './guards.js';

// Entitlements (Plan quotas and features)
export {
  hasFeature,
  getEnabledFeatures,
  checkQuota,
  assertQuota,
  getTenantLimits,
  getRateLimitConfig,
  QuotaExceededError,
  FeatureNotAvailableError,
  assertFeature,
  DEFAULT_LIMITS,
  DEFAULT_RATE_LIMITS,
} from './entitlements.js';
export type {
  FeatureFlag,
  QuotaResource,
  QuotaCheckResult,
  RateLimitConfig,
} from './entitlements.js';
