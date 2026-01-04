/**
 * Tenant Context Types
 * 
 * Core type definitions for multi-tenant context management.
 * These types are used across all services for tenant isolation.
 */

// =============================================================================
// TENANT STATUS
// =============================================================================

/**
 * Tenant lifecycle status
 */
export type TenantStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'MAINTENANCE' | 'ARCHIVED';

/**
 * Domain verification status
 */
export type DomainStatus = 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'FAILED';

/**
 * Domain type - how the tenant was resolved
 */
export type DomainType = 'hosted' | 'custom';

// =============================================================================
// TENANT CONTEXT
// =============================================================================

/**
 * Core tenant context attached to every authenticated request.
 * This is the canonical tenant representation across all services.
 */
export interface TenantContext {
  /** UUID of the Site/Tenant (canonical identifier) */
  id: string;
  
  /** URL-safe slug (e.g., "acme-corp") */
  slug: string;
  
  /** Tenant lifecycle status */
  status: TenantStatus;
  
  /** How the tenant was resolved */
  resolvedFrom: {
    type: DomainType;
    domain: string;
  };
  
  /** Optional: Plan information (if resolved) */
  plan?: TenantPlan;
  
  /** Feature flags from Site.features JSON */
  features: Record<string, boolean>;
}

/**
 * Minimal tenant context for JWT claims
 * Used to keep JWT size under 4KB browser cookie limit
 */
export interface TenantClaims {
  /** Site UUID - the canonical tenant identifier */
  siteId: string;
  
  /** Site slug for debugging/logging */
  siteSlug?: string;
  
  /** Site status at token issuance */
  siteStatus?: TenantStatus;
}

/**
 * Plan information for tenant
 */
export interface TenantPlan {
  id: string;
  name: string;
  features: string[];
  limits: TenantLimits;
}

/**
 * Plan-based limits for enforcement
 */
export interface TenantLimits {
  maxProducts: number;
  maxOrders: number;
  maxUsers: number;
  maxApiCallsPerDay: number;
  maxStorageMb: number;
}

/**
 * Domain record for resolution
 */
export interface TenantDomain {
  domain: string;
  tenantId: string;
  tenantSlug: string;
  type: DomainType;
  status: DomainStatus;
  isPrimary: boolean;
}

// =============================================================================
// JWT PAYLOAD EXTENSIONS
// =============================================================================

/**
 * Extended JWT payload with tenant claims.
 * Services should use this interface for JWT verification.
 */
export interface TenantAwareJwtPayload {
  /** User ID (subject) */
  sub: string;
  
  /** User email */
  email: string;
  
  /** User roles */
  roles: string[];
  
  /** Session ID for token revocation */
  sessionId: string;
  
  /** Tenant ID (Site UUID) - REQUIRED for multi-tenant */
  siteId: string;
  
  /** Tenant slug - optional, for debugging */
  siteSlug?: string;
  
  /** Tenant status at token issuance */
  siteStatus?: TenantStatus;
  
  /** Standard JWT claims */
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

// =============================================================================
// REQUEST CONTEXT
// =============================================================================

/**
 * Full request context including user and tenant
 */
export interface RequestContext {
  user: {
    id: string;
    email: string;
    roles: string[];
    permissions: string[];
    sessionId: string;
  };
  tenant: TenantContext;
}

// =============================================================================
// RESOLUTION TYPES
// =============================================================================

/**
 * Result of tenant resolution
 */
export interface TenantResolutionResult {
  success: boolean;
  tenant?: TenantContext;
  error?: {
    code: string;
    message: string;
  };
}
