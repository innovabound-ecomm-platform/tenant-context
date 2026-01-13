/**
 * Tenant Resolver
 *
 * Resolves tenant information from hostname (subdomain or custom domain).
 * Used by Next.js middleware and API gateways to identify the tenant.
 */

import { prisma } from '@repo/platform-db';
import type { Tenant, TenantStatus, DomainStatus } from '@repo/platform-db';

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  databaseName: string;
  customDomain: string | null;
  customDomainStatus: DomainStatus;
  settings: Record<string, unknown>;
}

export interface TenantResolutionResult {
  success: boolean;
  tenant?: ResolvedTenant;
  error?: string;
  source: 'subdomain' | 'custom-domain' | 'header';
}

// Cache resolved tenants briefly to avoid constant DB lookups
const tenantCache = new Map<
  string,
  { tenant: ResolvedTenant; timestamp: number }
>();
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Platform domains that should NOT be treated as custom domains
 */
const PLATFORM_DOMAINS = [
  'localhost',
  '127.0.0.1',
  'platform.com',
  'platform.local',
];

/**
 * Extract subdomain from hostname
 *
 * Examples:
 * - acme.platform.com → "acme"
 * - admin.acme.platform.com → "admin.acme"
 * - acme.localhost:3000 → "acme"
 * - store.custom.com → null (custom domain)
 */
export function extractSubdomain(
  hostname: string,
  platformDomains: string[] = PLATFORM_DOMAINS
): string | null {
  // Remove port if present
  const host = hostname.split(':')[0] ?? '';

  // Check if this is a platform domain
  for (const platformDomain of platformDomains) {
    if (host === platformDomain) {
      return null; // Root platform domain, no subdomain
    }

    if (host.endsWith(`.${platformDomain}`)) {
      // Extract subdomain(s)
      const subdomain = host.slice(0, -(platformDomain.length + 1));
      return subdomain || null;
    }
  }

  // Not a platform domain - likely a custom domain
  return null;
}

/**
 * Parse subdomain to extract tenant slug
 *
 * Examples:
 * - "acme" → { type: "storefront", slug: "acme" }
 * - "admin.acme" → { type: "admin", slug: "acme" }
 * - "api.acme" → { type: "api", slug: "acme" }
 */
export function parseSubdomain(subdomain: string): {
  type: 'storefront' | 'admin' | 'api';
  slug: string;
} | null {
  const parts = subdomain.split('.');

  if (parts.length === 1 && parts[0]) {
    // Single subdomain: acme.platform.com → storefront
    return { type: 'storefront', slug: parts[0] };
  }

  if (parts.length === 2) {
    const [prefix, slug] = parts;
    if (prefix === 'admin' && slug) {
      return { type: 'admin', slug };
    }
    if (prefix === 'api' && slug) {
      return { type: 'api', slug };
    }
  }

  // Invalid subdomain format
  return null;
}

/**
 * Resolve tenant from hostname
 *
 * Checks subdomain first, then falls back to custom domain lookup.
 */
export async function resolveTenantFromHostname(
  hostname: string,
  options: {
    platformDomains?: string[];
    bypassCache?: boolean;
  } = {}
): Promise<TenantResolutionResult> {
  const { platformDomains = PLATFORM_DOMAINS, bypassCache = false } = options;

  // Try subdomain first
  const subdomain = extractSubdomain(hostname, platformDomains);

  if (subdomain) {
    const parsed = parseSubdomain(subdomain);
    if (!parsed) {
      return {
        success: false,
        error: 'Invalid subdomain format',
        source: 'subdomain',
      };
    }

    const tenant = await resolveTenantBySlug(parsed.slug, bypassCache);
    if (!tenant) {
      return {
        success: false,
        error: `Tenant not found: ${parsed.slug}`,
        source: 'subdomain',
      };
    }

    if (tenant.status !== 'ACTIVE') {
      return {
        success: false,
        error: `Tenant is ${tenant.status.toLowerCase()}`,
        source: 'subdomain',
      };
    }

    return {
      success: true,
      tenant,
      source: 'subdomain',
    };
  }

  // Try custom domain lookup
  const host = hostname.split(':')[0] ?? hostname; // Remove port
  const tenant = await resolveTenantByCustomDomain(host, bypassCache);

  if (!tenant) {
    return {
      success: false,
      error: 'No tenant found for this domain',
      source: 'custom-domain',
    };
  }

  if (tenant.status !== 'ACTIVE') {
    return {
      success: false,
      error: `Tenant is ${tenant.status.toLowerCase()}`,
      source: 'custom-domain',
    };
  }

  if (tenant.customDomainStatus !== 'VERIFIED') {
    return {
      success: false,
      error: 'Domain not verified',
      source: 'custom-domain',
    };
  }

  return {
    success: true,
    tenant,
    source: 'custom-domain',
  };
}

/**
 * Resolve tenant by slug
 */
export async function resolveTenantBySlug(
  slug: string,
  bypassCache = false
): Promise<ResolvedTenant | null> {
  const cacheKey = `slug:${slug}`;

  // Check cache
  if (!bypassCache) {
    const cached = tenantCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.tenant;
    }
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        databaseName: true,
        customDomain: true,
        customDomainStatus: true,
        settings: true,
      },
    });

    if (!tenant) {
      return null;
    }

    const resolved = mapTenantToResolved(tenant);
    tenantCache.set(cacheKey, { tenant: resolved, timestamp: Date.now() });
    return resolved;
  } catch (error) {
    console.error('Error resolving tenant by slug:', error);
    return null;
  }
}

/**
 * Resolve tenant by custom domain
 */
export async function resolveTenantByCustomDomain(
  domain: string,
  bypassCache = false
): Promise<ResolvedTenant | null> {
  const cacheKey = `domain:${domain}`;

  // Check cache
  if (!bypassCache) {
    const cached = tenantCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.tenant;
    }
  }

  try {
    const tenant = await prisma.tenant.findFirst({
      where: {
        customDomain: domain,
        customDomainStatus: 'VERIFIED',
      },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        databaseName: true,
        customDomain: true,
        customDomainStatus: true,
        settings: true,
      },
    });

    if (!tenant) {
      return null;
    }

    const resolved = mapTenantToResolved(tenant);
    tenantCache.set(cacheKey, { tenant: resolved, timestamp: Date.now() });
    return resolved;
  } catch (error) {
    console.error('Error resolving tenant by custom domain:', error);
    return null;
  }
}

/**
 * Clear tenant cache (useful for testing or after updates)
 */
export function clearTenantCache(key?: string): void {
  if (key) {
    tenantCache.delete(key);
  } else {
    tenantCache.clear();
  }
}

/**
 * Invalidate cache for a specific tenant
 */
export function invalidateTenantCache(
  slug: string,
  customDomain?: string
): void {
  tenantCache.delete(`slug:${slug}`);
  if (customDomain) {
    tenantCache.delete(`domain:${customDomain}`);
  }
}

// Helper to map Prisma result to ResolvedTenant
function mapTenantToResolved(tenant: {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  databaseName: string;
  customDomain: string | null;
  customDomainStatus: DomainStatus;
  settings: unknown;
}): ResolvedTenant {
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    databaseName: tenant.databaseName,
    customDomain: tenant.customDomain,
    customDomainStatus: tenant.customDomainStatus,
    settings: (tenant.settings as Record<string, unknown>) || {},
  };
}
