/**
 * Tenant Enforcement Guards
 * 
 * Utility functions to enforce tenant context in service handlers.
 * CRITICAL: All database queries MUST use these guards because we use
 * shared-instance row-level isolation via siteId.
 */

import type { TenantContext } from './types.js';
import { TenantMissingError, TenantSuspendedError, TenantArchivedError } from './errors.js';

// =============================================================================
// CONTEXT GUARDS
// =============================================================================

/**
 * Ensure tenant context exists - throws if missing.
 * Use at the start of any handler that requires tenant isolation.
 * 
 * @example
 * app.get('/products', (req, res) => {
 *   const tenant = requireTenant(req.tenant);
 *   // tenant is guaranteed to be defined
 * });
 */
export function requireTenant(tenant: TenantContext | undefined): TenantContext {
  if (!tenant) {
    throw new TenantMissingError();
  }
  return tenant;
}

/**
 * Get tenant ID for database queries - throws if missing.
 * This is the primary function for enforcing tenant isolation.
 * 
 * @example
 * const products = await prisma.product.findMany({
 *   where: { siteId: getTenantId(req.tenant) }
 * });
 */
export function getTenantId(tenant: TenantContext | undefined): string {
  return requireTenant(tenant).id;
}

/**
 * Ensure tenant is in an active state (not suspended/archived)
 */
export function requireActiveTenant(tenant: TenantContext | undefined): TenantContext {
  const t = requireTenant(tenant);
  
  if (t.status === 'SUSPENDED') {
    throw new TenantSuspendedError(t.slug);
  }
  
  if (t.status === 'ARCHIVED') {
    throw new TenantArchivedError(t.slug);
  }
  
  return t;
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Create a tenant-scoped where clause for Prisma queries.
 * Automatically injects siteId into the where clause.
 * 
 * @example
 * const where = tenantWhere(req.tenant, { status: 'ACTIVE' });
 * // Returns: { siteId: '...', status: 'ACTIVE' }
 * 
 * const products = await prisma.product.findMany({ where });
 */
export function tenantWhere<T extends Record<string, unknown>>(
  tenant: TenantContext | undefined,
  where: T
): T & { siteId: string } {
  return {
    siteId: getTenantId(tenant),
    ...where,
  };
}

/**
 * Create tenant-scoped data for Prisma create/update operations.
 * Automatically injects siteId into the data.
 * 
 * @example
 * const product = await prisma.product.create({
 *   data: tenantData(req.tenant, { name: 'Widget', price: 9.99 })
 * });
 */
export function tenantData<T extends Record<string, unknown>>(
  tenant: TenantContext | undefined,
  data: T
): T & { siteId: string } {
  return {
    siteId: getTenantId(tenant),
    ...data,
  };
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate that a record belongs to the current tenant.
 * Use when fetching by ID to ensure cross-tenant access is blocked.
 * 
 * @example
 * const product = await prisma.product.findUnique({ where: { id } });
 * validateTenantOwnership(req.tenant, product?.siteId);
 */
export function validateTenantOwnership(
  tenant: TenantContext | undefined,
  recordSiteId: string | null | undefined
): void {
  const currentTenantId = getTenantId(tenant);
  
  if (!recordSiteId) {
    throw new TenantMissingError('Record does not have a siteId');
  }
  
  if (recordSiteId !== currentTenantId) {
    // Don't reveal the actual IDs in error message for security
    throw new TenantMissingError('Record does not belong to current tenant');
  }
}

/**
 * Check if a record belongs to the current tenant (returns boolean).
 * Use when you want to filter rather than throw.
 */
export function belongsToTenant(
  tenant: TenantContext | undefined,
  recordSiteId: string | null | undefined
): boolean {
  if (!tenant || !recordSiteId) {
    return false;
  }
  return recordSiteId === tenant.id;
}

// =============================================================================
// LIST HELPERS
// =============================================================================

/**
 * Filter a list of records to only those belonging to current tenant.
 * Safety net for cases where database query didn't filter properly.
 * 
 * WARNING: This should NOT be your primary isolation mechanism.
 * Always filter at the database query level using tenantWhere().
 */
export function filterByTenant<T extends { siteId?: string | null }>(
  tenant: TenantContext | undefined,
  records: T[]
): T[] {
  const tenantId = getTenantId(tenant);
  return records.filter(r => r.siteId === tenantId);
}
