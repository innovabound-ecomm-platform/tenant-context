/**
 * Tenant Middleware Factory
 *
 * Creates Express middleware for resolving tenant context.
 * Includes caching, entitlement loading, and database connection.
 */

import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@repo/platform-db';
import { getPlatformPrisma, getTenantConnection } from '@repo/platform-db';
import { TenantContext, type TenantInfo, type PlanType, type TenantLimits, type AddonType } from './context';
import { extractTenantFromJwt, extractTenantFromHeader, extractBearerToken } from './extractors';

export interface TenantMiddlewareOptions {
  /**
   * JWT secret for token verification
   */
  jwtSecret: string;

  /**
   * Allow requests without tenant (e.g., health checks)
   * @default false
   */
  optional?: boolean;

  /**
   * Cache TTL in milliseconds
   * @default 60000 (1 minute)
   */
  cacheTtlMs?: number;

  /**
   * Attach tenant Prisma client to request
   * @default true
   */
  attachPrisma?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: Error, req: Request, res: Response) => void;
}

// Cache for tenant data
interface CachedTenant {
  info: TenantInfo;
  timestamp: number;
}
const tenantCache = new Map<string, CachedTenant>();

/** Default plan limits */
const PLAN_LIMITS: Record<PlanType, TenantLimits> = {
  STARTER: {
    maxProducts: 100,
    maxOrders: 500,
    maxStaff: 2,
    maxWarehouses: 1,
    apiRateLimit: 100,
  },
  GROWTH: {
    maxProducts: 1000,
    maxOrders: 5000,
    maxStaff: 10,
    maxWarehouses: 3,
    apiRateLimit: 500,
  },
  BUSINESS: {
    maxProducts: 10000,
    maxOrders: 50000,
    maxStaff: 50,
    maxWarehouses: 10,
    apiRateLimit: 2000,
  },
  ENTERPRISE: {
    maxProducts: -1, // Unlimited
    maxOrders: -1,
    maxStaff: -1,
    maxWarehouses: -1,
    apiRateLimit: 10000,
  },
};

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      tenantInfo?: TenantInfo;
      tenantPrisma?: PrismaClient;
      userId?: string;
      userEmail?: string;
    }
  }
}

/**
 * Clear the tenant cache (useful for testing or cache invalidation)
 */
export function clearTenantMiddlewareCache(): void {
  tenantCache.clear();
}

/**
 * Invalidate a specific tenant from cache
 */
export function invalidateTenantFromCache(tenantSlug: string): void {
  tenantCache.delete(tenantSlug);
}

/**
 * Create tenant middleware with the given options
 */
export function createTenantMiddleware(options: TenantMiddlewareOptions) {
  const { 
    jwtSecret, 
    optional = false, 
    cacheTtlMs = 60000, 
    attachPrisma = true,
    onError 
  } = options;
  const platformPrisma = getPlatformPrisma();

  return async function tenantMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      let tenantSlug: string | null = null;
      let userId: string | undefined;
      let userEmail: string | undefined;

      // 1. Try to extract from JWT token (highest priority)
      const token = extractBearerToken(req.headers.authorization);
      if (token) {
        const payload = extractTenantFromJwt(token, jwtSecret);
        if (payload) {
          tenantSlug = payload.tenantSlug;
          userId = payload.sub;
          userEmail = payload.email;
        }
      }

      // 2. Fall back to X-Tenant-Slug header
      if (!tenantSlug) {
        tenantSlug = extractTenantFromHeader(req.headers);
      }

      // 3. Check if tenant is required
      if (!tenantSlug) {
        if (optional) {
          return next();
        }
        res.status(400).json({
          error: {
            message: 'Tenant identifier required',
            code: 'TENANT_REQUIRED',
          },
        });
        return;
      }

      // 4. Check cache first
      const now = Date.now();
      const cached = tenantCache.get(tenantSlug);
      
      if (cached && (now - cached.timestamp) < cacheTtlMs) {
        // Use cached tenant info
        TenantContext.set(cached.info);
        req.tenantInfo = cached.info;
        req.userId = userId;
        req.userEmail = userEmail;

        // Attach Prisma client if requested
        if (attachPrisma) {
          req.tenantPrisma = await getTenantConnection(cached.info.tenantSlug);
        }

        return next();
      }

      // 5. Look up tenant in platform database with full entitlement data
      const tenant = await platformPrisma.tenant.findUnique({
        where: { slug: tenantSlug },
        include: {
          plan: {
            select: {
              slug: true,
            },
          },
          addons: {
            where: { status: 'ACTIVE' },
            select: {
              addonType: true,
            },
          },
        },
      });

      if (!tenant) {
        // Don't reveal whether tenant exists or not
        res.status(404).json({
          error: {
            message: 'Resource not found',
            code: 'NOT_FOUND',
          },
        });
        return;
      }

      if (tenant.status !== 'ACTIVE') {
        res.status(403).json({
          error: {
            message: 'Access denied',
            code: 'ACCESS_DENIED',
          },
        });
        return;
      }

      // 6. Build tenant info with entitlements
      const planSlug = (tenant.plan?.slug?.toUpperCase() ?? 'STARTER') as PlanType;
      const limits = PLAN_LIMITS[planSlug] ?? PLAN_LIMITS.STARTER;
      const addons = tenant.addons.map((a) => a.addonType as AddonType);

      const tenantInfo: TenantInfo = {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        name: tenant.name,
        databaseName: tenant.databaseName,
        status: tenant.status,
        plan: planSlug,
        limits,
        addons,
      };

      // 7. Cache the result
      tenantCache.set(tenantSlug, {
        info: tenantInfo,
        timestamp: now,
      });

      // 8. Set context and request properties
      TenantContext.set(tenantInfo);
      req.tenantInfo = tenantInfo;
      req.userId = userId;
      req.userEmail = userEmail;

      // 9. Attach Prisma client if requested
      if (attachPrisma) {
        req.tenantPrisma = await getTenantConnection(tenantSlug);
      }

      next();
    } catch (error) {
      if (onError) {
        onError(error as Error, req, res);
      } else {
        // Log error but return generic message
        console.error('Tenant middleware error:', error);
        res.status(503).json({
          error: {
            message: 'Service temporarily unavailable',
            code: 'SERVICE_UNAVAILABLE',
          },
        });
      }
    }
  };
}
