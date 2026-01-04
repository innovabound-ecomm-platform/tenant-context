/**
 * JWT Tenant Extraction
 * 
 * Utilities for extracting tenant context from JWT tokens.
 * This is the primary method for resolving tenant in the admin dashboard.
 */

import * as jose from 'jose';
import type { TenantContext, TenantAwareJwtPayload, TenantStatus } from './types.js';
import { TenantClaimsMissingError, TenantMissingError } from './errors.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface JwtTenantConfig {
  /** Public key for JWT verification (SPKI PEM format) */
  publicKey?: string;
  
  /** JWKS endpoint URL (alternative to publicKey) */
  jwksUrl?: string;
  
  /** Expected JWT issuer */
  issuer?: string;
  
  /** Expected JWT audience */
  audience?: string;
  
  /** Require siteId claim (default: true) */
  requireSiteId?: boolean;
}

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

let cachedPublicKey: Awaited<ReturnType<typeof jose.importSPKI>> | null = null;
let cachedJwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

/**
 * Initialize JWT verification with a public key (SPKI PEM format)
 */
export async function initializeWithPublicKey(publicKeyPem: string): Promise<void> {
  cachedPublicKey = await jose.importSPKI(publicKeyPem, 'RS256');
}

/**
 * Initialize JWT verification with JWKS endpoint
 */
export function initializeWithJwks(jwksUrl: string): void {
  cachedJwks = jose.createRemoteJWKSet(new URL(jwksUrl));
}

/**
 * Get the verification key (public key or JWKS)
 */
function getVerificationKey() {
  if (cachedPublicKey) return cachedPublicKey;
  if (cachedJwks) return cachedJwks;
  throw new Error('JWT verification not initialized. Call initializeWithPublicKey() or initializeWithJwks() first.');
}

// =============================================================================
// JWT EXTRACTION
// =============================================================================

/**
 * Verify JWT and extract payload (does NOT validate tenant claims)
 */
export async function verifyJwt(
  token: string,
  config?: Pick<JwtTenantConfig, 'issuer' | 'audience'>
): Promise<jose.JWTPayload> {
  const options: jose.JWTVerifyOptions = {
    issuer: config?.issuer,
    audience: config?.audience,
  };

  // Use JWKS if available (function type), otherwise use key directly
  if (cachedJwks) {
    const { payload } = await jose.jwtVerify(token, cachedJwks, options);
    return payload;
  }
  
  if (cachedPublicKey) {
    const { payload } = await jose.jwtVerify(token, cachedPublicKey, options);
    return payload;
  }

  throw new Error('JWT verification not initialized. Call initializeWithPublicKey() or initializeWithJwks() first.');
}

/**
 * Extract tenant-aware payload from JWT
 * Validates that required tenant claims are present
 */
export async function extractTenantPayload(
  token: string,
  config?: JwtTenantConfig
): Promise<TenantAwareJwtPayload> {
  const payload = await verifyJwt(token, config);
  
  // Validate required fields
  if (!payload.sub) {
    throw new TenantClaimsMissingError(['sub']);
  }
  
  const requireSiteId = config?.requireSiteId !== false;
  
  if (requireSiteId && !payload.siteId) {
    throw new TenantClaimsMissingError(['siteId']);
  }
  
  // Cast to tenant-aware payload
  return {
    sub: payload.sub,
    email: payload.email as string,
    roles: (payload.roles as string[]) || [],
    sessionId: payload.sessionId as string,
    siteId: payload.siteId as string,
    siteSlug: payload.siteSlug as string | undefined,
    siteStatus: payload.siteStatus as TenantStatus | undefined,
    iat: payload.iat,
    exp: payload.exp,
    iss: payload.iss,
    aud: payload.aud,
  };
}

/**
 * Extract siteId from JWT (convenience function)
 * Returns undefined if siteId is not present
 */
export async function extractSiteIdFromJwt(token: string): Promise<string | undefined> {
  try {
    const payload = await verifyJwt(token);
    return payload.siteId as string | undefined;
  } catch {
    return undefined;
  }
}

// =============================================================================
// TENANT CONTEXT RESOLUTION
// =============================================================================

/**
 * Resolve tenant context from JWT payload.
 * This creates a minimal TenantContext from JWT claims.
 * 
 * For full tenant details (plan, features), use a resolver that
 * fetches from database/cache.
 */
export function resolveTenantFromJwt(payload: TenantAwareJwtPayload): TenantContext {
  if (!payload.siteId) {
    throw new TenantMissingError('JWT does not contain siteId claim');
  }
  
  return {
    id: payload.siteId,
    slug: payload.siteSlug || payload.siteId, // Fallback to ID if slug not provided
    status: payload.siteStatus || 'ACTIVE',
    resolvedFrom: {
      type: 'hosted', // JWT-based resolution is typically for hosted/admin
      domain: 'jwt',
    },
    features: {}, // Features not included in JWT to save space
  };
}

/**
 * Extract tenant context from JWT token string
 * Combines verification, extraction, and resolution
 */
export async function getTenantFromJwt(
  token: string,
  config?: JwtTenantConfig
): Promise<TenantContext> {
  const payload = await extractTenantPayload(token, config);
  return resolveTenantFromJwt(payload);
}
