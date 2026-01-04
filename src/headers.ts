/**
 * Standard Tenant Headers
 * 
 * Constants for HTTP headers used in tenant context propagation.
 * All services should use these header names for consistency.
 */

// =============================================================================
// TENANT HEADERS (Set by middleware/gateway)
// =============================================================================

export const TENANT_HEADERS = {
  /** Tenant UUID - primary identifier */
  TENANT_ID: 'x-tenant-id',
  
  /** Tenant slug - for logging/debugging */
  TENANT_SLUG: 'x-tenant-slug',
  
  /** Original host header - preserved through proxy */
  TENANT_HOST: 'x-tenant-host',
  
  /** Tenant status - for downstream enforcement */
  TENANT_STATUS: 'x-tenant-status',
} as const;

// =============================================================================
// UPSTREAM HEADERS (Set by CDN/proxy/gateway)
// =============================================================================

export const UPSTREAM_HEADERS = {
  /** Standard forwarded host */
  FORWARDED_HOST: 'x-forwarded-host',
  
  /** Original host before CDN/proxy */
  ORIGINAL_HOST: 'x-original-host',
  
  /** Forwarded protocol */
  FORWARDED_PROTO: 'x-forwarded-proto',
} as const;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get header value (case-insensitive)
 */
export function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Set tenant headers on a response or outgoing request
 */
export function setTenantHeaders(
  headers: Record<string, string>,
  tenantId: string,
  tenantSlug?: string,
  tenantStatus?: string
): void {
  headers[TENANT_HEADERS.TENANT_ID] = tenantId;
  if (tenantSlug) {
    headers[TENANT_HEADERS.TENANT_SLUG] = tenantSlug;
  }
  if (tenantStatus) {
    headers[TENANT_HEADERS.TENANT_STATUS] = tenantStatus;
  }
}
