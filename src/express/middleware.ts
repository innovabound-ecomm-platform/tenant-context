/**
 * Tenant Context - Express Middleware
 * 
 * Middleware for attaching tenant context to Express requests.
 * 
 * SECURITY: Tenant headers from external clients are NOT trusted.
 * Resolution order (most secure first):
 * 1. JWT siteId claim (cryptographically signed)
 * 2. Internal gateway headers (with signature verification)
 * 3. Headers from trusted internal network (IP check)
 */

import type { Request, Response, NextFunction } from 'express';
import type { TenantContext, TenantStatus } from '../types.js';
import { TENANT_HEADERS, getHeader } from '../headers.js';
import { extractTenantPayload, resolveTenantFromJwt, type JwtTenantConfig } from '../jwt.js';
import {
  TenantError,
  TenantMissingError,
  TenantSuspendedError,
  TenantArchivedError,
  TenantMaintenanceError,
  TenantAccessDeniedError,
} from '../errors.js';
import { createHmac, timingSafeEqual } from 'crypto';

// =============================================================================
// REQUEST EXTENSION
// =============================================================================

/**
 * Extended Express Request with tenant context
 */
export interface TenantRequest extends Request {
  /** Tenant context - present after tenantMiddleware runs */
  tenant?: TenantContext;
  
  /** Shorthand for tenant.id - present after tenantMiddleware runs */
  tenantId?: string;
}

// =============================================================================
// MIDDLEWARE OPTIONS
// =============================================================================

export interface TenantMiddlewareOptions {
  /** Require tenant for all requests (default: true) */
  required?: boolean;
  
  /** Paths to skip tenant resolution (e.g., health checks) */
  skipPaths?: string[];
  
  /** Allow suspended tenants (read-only mode) */
  allowSuspended?: boolean;
  
  /** Allow maintenance mode tenants */
  allowMaintenance?: boolean;
  
  /** JWT configuration for token-based resolution */
  jwt?: JwtTenantConfig;
  
  /** Custom error handler */
  onError?: (error: TenantError, req: Request, res: Response) => void;
  
  /**
   * SECURITY: Trust mode for tenant headers
   * - 'jwt-only': Only trust siteId from JWT (most secure)
   * - 'internal-network': Trust headers from internal IPs
   * - 'signed': Trust headers with valid HMAC signature
   * - 'disabled': Never trust headers (for public APIs)
   * 
   * Default: 'jwt-only' (recommended for production)
   */
  headerTrustMode?: 'jwt-only' | 'internal-network' | 'signed' | 'disabled';
  
  /** HMAC secret for signed header verification (required if headerTrustMode='signed') */
  headerSignatureSecret?: string;
  
  /** Trusted internal network CIDRs (for headerTrustMode='internal-network') */
  trustedNetworks?: string[];
}

// =============================================================================
// INTERNAL NETWORK DETECTION
// =============================================================================

const DEFAULT_TRUSTED_NETWORKS = [
  '10.0.0.0/8',      // Private Class A
  '172.16.0.0/12',   // Private Class B  
  '192.168.0.0/16',  // Private Class C
  '127.0.0.0/8',     // Loopback
  'fc00::/7',        // IPv6 Private
  '::1/128',         // IPv6 Loopback
];

function getClientIp(req: Request): string {
  // Kubernetes / cloud load balancer headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim();
  }
  
  // Express trust proxy or direct connection
  return req.ip || req.socket.remoteAddress || '';
}

function isInternalNetwork(ip: string, trustedNetworks: string[]): boolean {
  // Simple check - in production use a proper CIDR library
  const cleanIp = ip.replace('::ffff:', ''); // Handle IPv4-mapped IPv6
  
  // Check common internal patterns
  if (cleanIp.startsWith('10.') || 
      cleanIp.startsWith('192.168.') ||
      cleanIp.startsWith('127.') ||
      cleanIp === 'localhost' ||
      cleanIp === '::1') {
    return true;
  }
  
  // 172.16.0.0 - 172.31.255.255
  if (cleanIp.startsWith('172.')) {
    const second = parseInt(cleanIp.split('.')[1], 10);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  
  return false;
}

// =============================================================================
// HEADER SIGNATURE VERIFICATION
// =============================================================================

const HEADER_SIGNATURE_NAME = 'x-tenant-signature';
const HEADER_SIGNATURE_TIMESTAMP = 'x-tenant-signature-ts';
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function verifyHeaderSignature(
  req: Request,
  secret: string
): boolean {
  const signature = req.headers[HEADER_SIGNATURE_NAME] as string;
  const timestamp = req.headers[HEADER_SIGNATURE_TIMESTAMP] as string;
  
  if (!signature || !timestamp) {
    return false;
  }
  
  // Check timestamp freshness (prevent replay attacks)
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Date.now() - ts > SIGNATURE_MAX_AGE_MS) {
    return false;
  }
  
  // Build message to sign
  const tenantId = getHeader(req.headers as Record<string, string>, TENANT_HEADERS.TENANT_ID);
  const tenantSlug = getHeader(req.headers as Record<string, string>, TENANT_HEADERS.TENANT_SLUG);
  const message = `${tenantId}:${tenantSlug}:${timestamp}`;
  
  // Verify HMAC
  const expectedSignature = createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  
  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Express middleware for tenant context resolution.
 * 
 * Resolution order (most secure first):
 * 1. JWT token (siteId claim) - cryptographically signed
 * 2. Signed headers from gateway - HMAC verified
 * 3. Headers from internal network - IP-based trust
 * 
 * SECURITY: External client headers are NEVER trusted directly.
 * 
 * @example
 * app.use(tenantMiddleware({
 *   required: true,
 *   skipPaths: ['/health', '/metrics'],
 *   headerTrustMode: 'jwt-only', // Most secure
 *   jwt: { jwksUrl: 'http://auth-service:8003/auth/.well-known/jwks.json' }
 * }));
 */
export function tenantMiddleware(options: TenantMiddlewareOptions = {}) {
  const {
    required = true,
    skipPaths = [],
    allowSuspended = false,
    allowMaintenance = false,
    headerTrustMode = 'jwt-only',
    headerSignatureSecret,
    trustedNetworks = DEFAULT_TRUSTED_NETWORKS,
    onError,
  } = options;

  // Validate configuration
  if (headerTrustMode === 'signed' && !headerSignatureSecret) {
    throw new Error('headerSignatureSecret is required when headerTrustMode is "signed"');
  }

  return async (req: TenantRequest, res: Response, next: NextFunction) => {
    try {
      // Skip paths that don't need tenant context
      if (shouldSkipPath(req.path, skipPaths)) {
        return next();
      }

      // Try to resolve tenant
      const tenant = await resolveTenant(req, options, trustedNetworks);

      if (!tenant) {
        if (required) {
          throw new TenantMissingError('Unable to determine tenant from request');
        }
        return next();
      }

      // Validate tenant status
      validateTenantStatus(tenant, allowSuspended, allowMaintenance);

      // Attach to request
      req.tenant = tenant;
      req.tenantId = tenant.id;

      // Set response headers for debugging/tracing
      res.setHeader(TENANT_HEADERS.TENANT_ID, tenant.id);
      res.setHeader(TENANT_HEADERS.TENANT_SLUG, tenant.slug);

      return next();
    } catch (error) {
      if (error instanceof TenantError) {
        if (onError) {
          return onError(error, req, res);
        }
        return res.status(error.statusCode).json(error.toJSON());
      }
      
      // Unexpected error
      console.error('Tenant middleware error:', error);
      return res.status(500).json({
        error: {
          code: 'TENANT_RESOLUTION_ERROR',
          message: 'Failed to resolve tenant context',
        },
      });
    }
  };
}

// =============================================================================
// RESOLUTION LOGIC
// =============================================================================

async function resolveTenant(
  req: TenantRequest,
  options: TenantMiddlewareOptions,
  trustedNetworks: string[]
): Promise<TenantContext | undefined> {
  const { headerTrustMode = 'jwt-only', headerSignatureSecret, jwt } = options;

  // 1. ALWAYS try JWT first (most secure - cryptographically signed)
  const token = extractToken(req);
  if (token && jwt) {
    const payload = await extractTenantPayload(token, jwt);
    if (payload?.siteId) {
      return resolveTenantFromJwt(payload);
    }
  }

  // 2. Check header trust mode
  const headerTenantId = getHeader(req.headers as Record<string, string>, TENANT_HEADERS.TENANT_ID);
  if (headerTenantId) {
    switch (headerTrustMode) {
      case 'disabled':
        // Never trust headers - skip
        console.warn(`[TenantContext] Untrusted x-tenant-id header received from ${getClientIp(req)}`);
        break;
        
      case 'jwt-only':
        // Only trust JWT - header was set but JWT didn't have siteId
        // This is suspicious - log it
        console.warn(`[TenantContext] x-tenant-id header ignored (jwt-only mode) from ${getClientIp(req)}`);
        break;
        
      case 'signed':
        // Verify HMAC signature
        if (headerSignatureSecret && verifyHeaderSignature(req, headerSignatureSecret)) {
          return buildTenantFromHeaders(req);
        }
        console.warn(`[TenantContext] Invalid or missing tenant header signature from ${getClientIp(req)}`);
        break;
        
      case 'internal-network':
        // Only trust if from internal network
        const clientIp = getClientIp(req);
        if (isInternalNetwork(clientIp, trustedNetworks)) {
          return buildTenantFromHeaders(req);
        }
        console.warn(`[TenantContext] x-tenant-id header rejected from external IP: ${clientIp}`);
        break;
    }
  }

  return undefined;
}

function buildTenantFromHeaders(req: Request): TenantContext {
  const headers = req.headers as Record<string, string>;
  
  const tenantId = getHeader(headers, TENANT_HEADERS.TENANT_ID);
  const tenantSlug = getHeader(headers, TENANT_HEADERS.TENANT_SLUG);
  const tenantStatus = getHeader(headers, TENANT_HEADERS.TENANT_STATUS) as TenantStatus;
  const tenantHost = getHeader(headers, TENANT_HEADERS.TENANT_HOST);

  if (!tenantId) {
    throw new TenantMissingError('Tenant ID header is missing');
  }

  return {
    id: tenantId,
    slug: tenantSlug || tenantId,
    status: tenantStatus || 'ACTIVE',
    resolvedFrom: {
      type: 'hosted',
      domain: tenantHost || 'header',
    },
    features: {},
  };
}

function extractToken(req: Request): string | undefined {
  // Check cookie first (admin dashboard)
  const cookieToken = req.cookies?.access_token;
  if (cookieToken) {
    return cookieToken;
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return undefined;
}

// =============================================================================
// VALIDATION
// =============================================================================

function shouldSkipPath(path: string, skipPaths: string[]): boolean {
  return skipPaths.some(skip => {
    if (skip.endsWith('*')) {
      return path.startsWith(skip.slice(0, -1));
    }
    return path === skip;
  });
}

function validateTenantStatus(
  tenant: TenantContext,
  allowSuspended: boolean,
  allowMaintenance: boolean
): void {
  if (tenant.status === 'SUSPENDED' && !allowSuspended) {
    throw new TenantSuspendedError(tenant.slug);
  }

  if (tenant.status === 'ARCHIVED') {
    throw new TenantArchivedError(tenant.slug);
  }

  if (tenant.status === 'MAINTENANCE' && !allowMaintenance) {
    throw new TenantMaintenanceError(tenant.slug);
  }
}

// =============================================================================
// CONVENIENCE MIDDLEWARE
// =============================================================================

/**
 * Middleware that requires tenant context (shorthand)
 */
export const requireTenantMiddleware = tenantMiddleware({ required: true });

/**
 * Middleware that makes tenant context optional
 */
export const optionalTenantMiddleware = tenantMiddleware({ required: false });
