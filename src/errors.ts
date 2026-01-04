/**
 * Tenant Context Errors
 * 
 * Custom error classes for tenant-related failures.
 * All errors include HTTP status codes for consistent API responses.
 */

// =============================================================================
// BASE ERROR
// =============================================================================

/**
 * Base class for all tenant-related errors
 */
export class TenantError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TenantError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON response format
   */
  toJSON(): Record<string, unknown> {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

// =============================================================================
// SPECIFIC ERROR TYPES
// =============================================================================

/**
 * Thrown when tenant context is required but not present
 */
export class TenantMissingError extends TenantError {
  constructor(message = 'Tenant context is required for this operation') {
    super('TENANT_MISSING', message, 400);
    this.name = 'TenantMissingError';
  }
}

/**
 * Thrown when tenant cannot be resolved from request
 */
export class TenantNotFoundError extends TenantError {
  constructor(identifier: string, type: 'domain' | 'id' | 'slug' = 'domain') {
    super(
      'TENANT_NOT_FOUND',
      `Tenant not found for ${type}: ${identifier}`,
      404,
      { identifier, type }
    );
    this.name = 'TenantNotFoundError';
  }
}

/**
 * Thrown when tenant exists but is suspended
 */
export class TenantSuspendedError extends TenantError {
  constructor(tenantSlug: string, reason?: string) {
    super(
      'TENANT_SUSPENDED',
      `Tenant "${tenantSlug}" is suspended${reason ? `: ${reason}` : ''}`,
      403,
      { tenantSlug, reason }
    );
    this.name = 'TenantSuspendedError';
  }
}

/**
 * Thrown when tenant has been archived (permanently disabled)
 */
export class TenantArchivedError extends TenantError {
  constructor(tenantSlug: string) {
    super(
      'TENANT_ARCHIVED',
      `Tenant "${tenantSlug}" has been archived and is no longer accessible`,
      410,
      { tenantSlug }
    );
    this.name = 'TenantArchivedError';
  }
}

/**
 * Thrown when tenant is in maintenance mode
 */
export class TenantMaintenanceError extends TenantError {
  constructor(tenantSlug: string, estimatedEndTime?: Date) {
    super(
      'TENANT_MAINTENANCE',
      `Tenant "${tenantSlug}" is currently under maintenance`,
      503,
      { tenantSlug, estimatedEndTime: estimatedEndTime?.toISOString() }
    );
    this.name = 'TenantMaintenanceError';
  }
}

/**
 * Thrown when user attempts to access a tenant they don't belong to
 */
export class TenantAccessDeniedError extends TenantError {
  constructor(userId: string, tenantId: string) {
    super(
      'TENANT_ACCESS_DENIED',
      'You do not have access to this tenant',
      403,
      { userId, tenantId }
    );
    this.name = 'TenantAccessDeniedError';
  }
}

/**
 * Thrown when a tenant limit is exceeded (e.g., max products)
 */
export class TenantLimitExceededError extends TenantError {
  constructor(
    limitType: string,
    current: number,
    max: number,
    tenantSlug?: string
  ) {
    super(
      'TENANT_LIMIT_EXCEEDED',
      `Limit exceeded for ${limitType}: ${current}/${max}`,
      402, // Payment Required - upgrade plan
      { limitType, current, max, tenantSlug }
    );
    this.name = 'TenantLimitExceededError';
  }
}

/**
 * Thrown when JWT is missing required tenant claims
 */
export class TenantClaimsMissingError extends TenantError {
  constructor(missingClaims: string[]) {
    super(
      'TENANT_CLAIMS_MISSING',
      `JWT is missing required tenant claims: ${missingClaims.join(', ')}`,
      401,
      { missingClaims }
    );
    this.name = 'TenantClaimsMissingError';
  }
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if an error is a TenantError
 */
export function isTenantError(error: unknown): error is TenantError {
  return error instanceof TenantError;
}

/**
 * Check if an error indicates the tenant is unavailable (suspended/archived/maintenance)
 */
export function isTenantUnavailableError(error: unknown): boolean {
  return (
    error instanceof TenantSuspendedError ||
    error instanceof TenantArchivedError ||
    error instanceof TenantMaintenanceError
  );
}
