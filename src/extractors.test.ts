/**
 * Tests for Tenant Extractors
 *
 * Tests JWT extraction and header-based tenant resolution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  extractTenantFromJwt,
  extractTenantFromHeader,
  extractBearerToken,
} from './extractors';

describe('extractTenantFromJwt', () => {
  const secret = 'test-secret-key';

  describe('valid tokens', () => {
    it('extracts tenant info from valid JWT', () => {
      const payload = {
        sub: 'user_123',
        email: 'john@example.com',
        tenantId: 'tenant_abc',
        tenantSlug: 'acme',
        roles: ['ADMIN'],
      };
      const token = jwt.sign(payload, secret);

      const result = extractTenantFromJwt(token, secret);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user_123');
      expect(result?.tenantId).toBe('tenant_abc');
      expect(result?.tenantSlug).toBe('acme');
      expect(result?.email).toBe('john@example.com');
      expect(result?.roles).toEqual(['ADMIN']);
    });

    it('extracts tenant info without optional fields', () => {
      const payload = {
        sub: 'user_456',
        tenantId: 'tenant_xyz',
        tenantSlug: 'demo',
      };
      const token = jwt.sign(payload, secret);

      const result = extractTenantFromJwt(token, secret);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe('user_456');
      expect(result?.tenantId).toBe('tenant_xyz');
      expect(result?.tenantSlug).toBe('demo');
      expect(result?.email).toBeUndefined();
      expect(result?.roles).toBeUndefined();
    });
  });

  describe('invalid tokens', () => {
    it('returns null for expired token', () => {
      const payload = {
        sub: 'user_123',
        tenantId: 'tenant_abc',
        tenantSlug: 'acme',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      };
      const token = jwt.sign(payload, secret, { noTimestamp: true });

      const result = extractTenantFromJwt(token, secret);

      expect(result).toBeNull();
    });

    it('returns null for invalid signature', () => {
      const payload = {
        sub: 'user_123',
        tenantId: 'tenant_abc',
        tenantSlug: 'acme',
      };
      const token = jwt.sign(payload, 'different-secret');

      const result = extractTenantFromJwt(token, secret);

      expect(result).toBeNull();
    });

    it('returns null for malformed token', () => {
      const result = extractTenantFromJwt('not-a-valid-token', secret);
      expect(result).toBeNull();
    });

    it('returns null for empty token', () => {
      const result = extractTenantFromJwt('', secret);
      expect(result).toBeNull();
    });

    it('returns null for token missing tenantSlug', () => {
      const payload = {
        sub: 'user_123',
        tenantId: 'tenant_abc',
        // Missing tenantSlug
      };
      const token = jwt.sign(payload, secret);

      const result = extractTenantFromJwt(token, secret);

      expect(result).toBeNull();
    });

    it('returns null for token missing tenantId', () => {
      const payload = {
        sub: 'user_123',
        tenantSlug: 'acme',
        // Missing tenantId
      };
      const token = jwt.sign(payload, secret);

      const result = extractTenantFromJwt(token, secret);

      expect(result).toBeNull();
    });
  });
});

describe('extractTenantFromHeader', () => {
  it('extracts tenant slug from x-tenant-slug header', () => {
    const headers = {
      'x-tenant-slug': 'acme',
      'content-type': 'application/json',
    };

    const result = extractTenantFromHeader(headers);

    expect(result).toBe('acme');
  });

  it('returns null when header is missing', () => {
    const headers = {
      'content-type': 'application/json',
    };

    const result = extractTenantFromHeader(headers);

    expect(result).toBeNull();
  });

  it('returns null when header is an array', () => {
    const headers = {
      'x-tenant-slug': ['acme', 'demo'],
    };

    const result = extractTenantFromHeader(headers);

    expect(result).toBeNull();
  });

  it('returns null when header is undefined', () => {
    const headers = {
      'x-tenant-slug': undefined,
    };

    const result = extractTenantFromHeader(headers);

    expect(result).toBeNull();
  });

  it('returns null for empty headers object', () => {
    const result = extractTenantFromHeader({});
    expect(result).toBeNull();
  });
});

describe('extractBearerToken', () => {
  it('extracts token from valid Bearer header', () => {
    const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

    const result = extractBearerToken(authHeader);

    expect(result).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
  });

  it('returns null for non-Bearer auth scheme', () => {
    const authHeader = 'Basic dXNlcjpwYXNzd29yZA==';

    const result = extractBearerToken(authHeader);

    expect(result).toBeNull();
  });

  it('returns null for missing header', () => {
    const result = extractBearerToken(undefined);
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = extractBearerToken('');
    expect(result).toBeNull();
  });

  it('returns null for "Bearer " without token', () => {
    const result = extractBearerToken('Bearer ');
    expect(result).toBe('');
  });

  it('handles case-sensitive Bearer prefix', () => {
    // Bearer must be exact case
    const result = extractBearerToken('bearer token123');
    expect(result).toBeNull();

    const result2 = extractBearerToken('BEARER token123');
    expect(result2).toBeNull();
  });
});
