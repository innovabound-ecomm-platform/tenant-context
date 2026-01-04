import { describe, it, expect } from 'vitest';
import {
  requireTenant,
  getTenantId,
  requireActiveTenant,
  tenantWhere,
  tenantData,
  validateTenantOwnership,
  belongsToTenant,
  filterByTenant,
} from './guards.js';
import { TenantMissingError, TenantSuspendedError, TenantArchivedError } from './errors.js';
import type { TenantContext } from './types.js';

// Test fixtures
const activeTenant: TenantContext = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  slug: 'acme-corp',
  status: 'ACTIVE',
  resolvedFrom: { type: 'hosted', domain: 'acme.platform.shop' },
  features: { customDomains: true },
};

const suspendedTenant: TenantContext = {
  ...activeTenant,
  status: 'SUSPENDED',
};

const archivedTenant: TenantContext = {
  ...activeTenant,
  status: 'ARCHIVED',
};

describe('requireTenant', () => {
  it('returns tenant when present', () => {
    const result = requireTenant(activeTenant);
    expect(result).toBe(activeTenant);
  });

  it('throws TenantMissingError when undefined', () => {
    expect(() => requireTenant(undefined)).toThrow(TenantMissingError);
  });
});

describe('getTenantId', () => {
  it('returns tenant ID when tenant present', () => {
    const result = getTenantId(activeTenant);
    expect(result).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('throws TenantMissingError when undefined', () => {
    expect(() => getTenantId(undefined)).toThrow(TenantMissingError);
  });
});

describe('requireActiveTenant', () => {
  it('returns tenant when active', () => {
    const result = requireActiveTenant(activeTenant);
    expect(result).toBe(activeTenant);
  });

  it('returns tenant when trial', () => {
    const trialTenant = { ...activeTenant, status: 'TRIAL' as const };
    const result = requireActiveTenant(trialTenant);
    expect(result).toBe(trialTenant);
  });

  it('throws TenantSuspendedError when suspended', () => {
    expect(() => requireActiveTenant(suspendedTenant)).toThrow(TenantSuspendedError);
  });

  it('throws TenantArchivedError when archived', () => {
    expect(() => requireActiveTenant(archivedTenant)).toThrow(TenantArchivedError);
  });

  it('throws TenantMissingError when undefined', () => {
    expect(() => requireActiveTenant(undefined)).toThrow(TenantMissingError);
  });
});

describe('tenantWhere', () => {
  it('injects siteId into where clause', () => {
    const where = tenantWhere(activeTenant, { status: 'PUBLISHED' });
    expect(where).toEqual({
      siteId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'PUBLISHED',
    });
  });

  it('preserves existing where conditions', () => {
    const where = tenantWhere(activeTenant, { 
      status: 'ACTIVE',
      categoryId: 'cat-123',
    });
    expect(where).toEqual({
      siteId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'ACTIVE',
      categoryId: 'cat-123',
    });
  });

  it('throws when tenant missing', () => {
    expect(() => tenantWhere(undefined, { status: 'ACTIVE' })).toThrow(TenantMissingError);
  });
});

describe('tenantData', () => {
  it('injects siteId into data', () => {
    const data = tenantData(activeTenant, { name: 'Widget', price: 9.99 });
    expect(data).toEqual({
      siteId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Widget',
      price: 9.99,
    });
  });

  it('throws when tenant missing', () => {
    expect(() => tenantData(undefined, { name: 'Widget' })).toThrow(TenantMissingError);
  });
});

describe('validateTenantOwnership', () => {
  it('passes when siteId matches', () => {
    expect(() => validateTenantOwnership(
      activeTenant, 
      '550e8400-e29b-41d4-a716-446655440000'
    )).not.toThrow();
  });

  it('throws when siteId does not match', () => {
    expect(() => validateTenantOwnership(
      activeTenant, 
      'different-site-id'
    )).toThrow(TenantMissingError);
  });

  it('throws when record siteId is null', () => {
    expect(() => validateTenantOwnership(activeTenant, null)).toThrow(TenantMissingError);
  });

  it('throws when record siteId is undefined', () => {
    expect(() => validateTenantOwnership(activeTenant, undefined)).toThrow(TenantMissingError);
  });
});

describe('belongsToTenant', () => {
  it('returns true when siteId matches', () => {
    expect(belongsToTenant(activeTenant, '550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('returns false when siteId does not match', () => {
    expect(belongsToTenant(activeTenant, 'different-site-id')).toBe(false);
  });

  it('returns false when tenant undefined', () => {
    expect(belongsToTenant(undefined, 'some-site-id')).toBe(false);
  });

  it('returns false when record siteId null', () => {
    expect(belongsToTenant(activeTenant, null)).toBe(false);
  });
});

describe('filterByTenant', () => {
  const records = [
    { id: 1, siteId: '550e8400-e29b-41d4-a716-446655440000', name: 'A' },
    { id: 2, siteId: 'other-site', name: 'B' },
    { id: 3, siteId: '550e8400-e29b-41d4-a716-446655440000', name: 'C' },
    { id: 4, siteId: null, name: 'D' },
  ];

  it('filters records to current tenant only', () => {
    const result = filterByTenant(activeTenant, records);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual([1, 3]);
  });

  it('throws when tenant missing', () => {
    expect(() => filterByTenant(undefined, records)).toThrow(TenantMissingError);
  });
});
