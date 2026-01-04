import { describe, it, expect } from 'vitest';
import {
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

describe('TenantError', () => {
  it('creates error with all properties', () => {
    const error = new TenantError('TEST_CODE', 'Test message', 400, { key: 'value' });
    
    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('Test message');
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.name).toBe('TenantError');
  });

  it('toJSON returns structured error', () => {
    const error = new TenantError('TEST', 'Test', 400);
    const json = error.toJSON();
    
    expect(json).toEqual({
      error: {
        code: 'TEST',
        message: 'Test',
        details: undefined,
      },
    });
  });
});

describe('TenantMissingError', () => {
  it('has correct defaults', () => {
    const error = new TenantMissingError();
    
    expect(error.code).toBe('TENANT_MISSING');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('TenantMissingError');
  });

  it('accepts custom message', () => {
    const error = new TenantMissingError('Custom message');
    expect(error.message).toBe('Custom message');
  });
});

describe('TenantNotFoundError', () => {
  it('includes identifier in message', () => {
    const error = new TenantNotFoundError('acme.example.com', 'domain');
    
    expect(error.code).toBe('TENANT_NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.message).toContain('acme.example.com');
    expect(error.details).toEqual({ identifier: 'acme.example.com', type: 'domain' });
  });
});

describe('TenantSuspendedError', () => {
  it('includes slug and reason', () => {
    const error = new TenantSuspendedError('acme', 'Payment overdue');
    
    expect(error.code).toBe('TENANT_SUSPENDED');
    expect(error.statusCode).toBe(403);
    expect(error.message).toContain('acme');
    expect(error.message).toContain('Payment overdue');
  });
});

describe('TenantArchivedError', () => {
  it('has 410 Gone status', () => {
    const error = new TenantArchivedError('old-store');
    
    expect(error.code).toBe('TENANT_ARCHIVED');
    expect(error.statusCode).toBe(410);
  });
});

describe('TenantMaintenanceError', () => {
  it('has 503 Service Unavailable status', () => {
    const error = new TenantMaintenanceError('acme');
    
    expect(error.code).toBe('TENANT_MAINTENANCE');
    expect(error.statusCode).toBe(503);
  });

  it('includes estimated end time', () => {
    const endTime = new Date('2026-01-04T12:00:00Z');
    const error = new TenantMaintenanceError('acme', endTime);
    
    expect(error.details?.estimatedEndTime).toBe('2026-01-04T12:00:00.000Z');
  });
});

describe('TenantAccessDeniedError', () => {
  it('has 403 status', () => {
    const error = new TenantAccessDeniedError('user-123', 'tenant-456');
    
    expect(error.code).toBe('TENANT_ACCESS_DENIED');
    expect(error.statusCode).toBe(403);
    expect(error.details).toEqual({ userId: 'user-123', tenantId: 'tenant-456' });
  });
});

describe('TenantLimitExceededError', () => {
  it('has 402 Payment Required status', () => {
    const error = new TenantLimitExceededError('maxProducts', 100, 50);
    
    expect(error.code).toBe('TENANT_LIMIT_EXCEEDED');
    expect(error.statusCode).toBe(402);
    expect(error.details).toEqual({ limitType: 'maxProducts', current: 100, max: 50, tenantSlug: undefined });
  });
});

describe('TenantClaimsMissingError', () => {
  it('lists missing claims', () => {
    const error = new TenantClaimsMissingError(['siteId', 'siteSlug']);
    
    expect(error.code).toBe('TENANT_CLAIMS_MISSING');
    expect(error.statusCode).toBe(401);
    expect(error.message).toContain('siteId');
    expect(error.message).toContain('siteSlug');
  });
});

describe('isTenantError', () => {
  it('returns true for TenantError', () => {
    expect(isTenantError(new TenantMissingError())).toBe(true);
    expect(isTenantError(new TenantNotFoundError('test'))).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isTenantError(new Error('test'))).toBe(false);
    expect(isTenantError(null)).toBe(false);
    expect(isTenantError({ code: 'TEST' })).toBe(false);
  });
});

describe('isTenantUnavailableError', () => {
  it('returns true for suspended/archived/maintenance', () => {
    expect(isTenantUnavailableError(new TenantSuspendedError('test'))).toBe(true);
    expect(isTenantUnavailableError(new TenantArchivedError('test'))).toBe(true);
    expect(isTenantUnavailableError(new TenantMaintenanceError('test'))).toBe(true);
  });

  it('returns false for other tenant errors', () => {
    expect(isTenantUnavailableError(new TenantMissingError())).toBe(false);
    expect(isTenantUnavailableError(new TenantNotFoundError('test'))).toBe(false);
  });
});
