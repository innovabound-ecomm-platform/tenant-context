/**
 * Tenant Extractors
 *
 * Utilities for extracting tenant information from various sources.
 */

import jwt from 'jsonwebtoken';

export interface JwtTenantPayload {
  sub: string;
  email?: string;
  tenantId: string;
  tenantSlug: string;
  roles?: string[];
}

/**
 * Extract tenant information from JWT token
 */
export function extractTenantFromJwt(
  token: string,
  secret: string
): JwtTenantPayload | null {
  try {
    const payload = jwt.verify(token, secret) as JwtTenantPayload;
    if (payload.tenantSlug && payload.tenantId) {
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract tenant slug from request headers
 */
export function extractTenantFromHeader(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const slug = headers['x-tenant-slug'];
  if (typeof slug === 'string') {
    return slug;
  }
  return null;
}

/**
 * Extract bearer token from authorization header
 */
export function extractBearerToken(
  authHeader: string | undefined
): string | null {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}
