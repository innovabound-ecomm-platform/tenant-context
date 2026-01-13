/**
 * Tests for Tenant Resolver
 *
 * Tests subdomain extraction, parsing, and tenant resolution.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractSubdomain,
  parseSubdomain,
  clearTenantCache,
} from './resolver';

// Mock the platform-db module
vi.mock('@repo/platform-db', () => ({
  prisma: {
    tenant: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('extractSubdomain', () => {
  const platformDomains = ['localhost', 'platform.com', 'platform.local'];

  beforeEach(() => {
    clearTenantCache();
  });

  describe('platform domain detection', () => {
    it('returns null for root platform domain', () => {
      expect(extractSubdomain('platform.com', platformDomains)).toBeNull();
      expect(extractSubdomain('localhost', platformDomains)).toBeNull();
      expect(extractSubdomain('platform.local', platformDomains)).toBeNull();
    });

    it('returns null for root platform domain with port', () => {
      expect(extractSubdomain('localhost:3000', platformDomains)).toBeNull();
      expect(extractSubdomain('platform.com:443', platformDomains)).toBeNull();
    });
  });

  describe('subdomain extraction', () => {
    it('extracts single subdomain from platform domain', () => {
      expect(extractSubdomain('acme.platform.com', platformDomains)).toBe('acme');
      expect(extractSubdomain('demo.platform.com', platformDomains)).toBe('demo');
      expect(extractSubdomain('test.localhost', platformDomains)).toBe('test');
    });

    it('extracts multi-level subdomain', () => {
      expect(extractSubdomain('admin.acme.platform.com', platformDomains)).toBe('admin.acme');
      expect(extractSubdomain('api.demo.platform.com', platformDomains)).toBe('api.demo');
    });

    it('handles subdomains with port numbers', () => {
      expect(extractSubdomain('acme.localhost:3000', platformDomains)).toBe('acme');
      expect(extractSubdomain('admin.acme.platform.com:8080', platformDomains)).toBe('admin.acme');
    });
  });

  describe('custom domain detection', () => {
    it('returns null for custom domains (not platform domains)', () => {
      expect(extractSubdomain('store.example.com', platformDomains)).toBeNull();
      expect(extractSubdomain('myshop.io', platformDomains)).toBeNull();
      expect(extractSubdomain('custom-store.net', platformDomains)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(extractSubdomain('', platformDomains)).toBeNull();
    });

    it('handles hostname that partially matches platform domain', () => {
      // "notplatform.com" should not match "platform.com"
      expect(extractSubdomain('notplatform.com', platformDomains)).toBeNull();
    });
  });
});

describe('parseSubdomain', () => {
  describe('storefront subdomain (single level)', () => {
    it('parses single subdomain as storefront', () => {
      const result = parseSubdomain('acme');
      expect(result).toEqual({ type: 'storefront', slug: 'acme' });
    });

    it('parses various tenant slugs', () => {
      expect(parseSubdomain('demo')).toEqual({ type: 'storefront', slug: 'demo' });
      expect(parseSubdomain('test-store')).toEqual({ type: 'storefront', slug: 'test-store' });
      expect(parseSubdomain('store123')).toEqual({ type: 'storefront', slug: 'store123' });
    });
  });

  describe('admin subdomain (two levels)', () => {
    it('parses admin.{tenant} as admin type', () => {
      const result = parseSubdomain('admin.acme');
      expect(result).toEqual({ type: 'admin', slug: 'acme' });
    });

    it('parses admin with various tenant slugs', () => {
      expect(parseSubdomain('admin.demo')).toEqual({ type: 'admin', slug: 'demo' });
      expect(parseSubdomain('admin.test-store')).toEqual({ type: 'admin', slug: 'test-store' });
    });
  });

  describe('api subdomain (two levels)', () => {
    it('parses api.{tenant} as api type', () => {
      const result = parseSubdomain('api.acme');
      expect(result).toEqual({ type: 'api', slug: 'acme' });
    });
  });

  describe('invalid subdomains', () => {
    it('returns null for empty string', () => {
      expect(parseSubdomain('')).toBeNull();
    });

    it('returns null for unknown prefix with two levels', () => {
      expect(parseSubdomain('unknown.acme')).toBeNull();
      expect(parseSubdomain('staging.acme')).toBeNull();
    });

    it('returns null for more than two levels', () => {
      expect(parseSubdomain('admin.acme.extra')).toBeNull();
      expect(parseSubdomain('a.b.c.d')).toBeNull();
    });
  });
});

describe('Subdomain routing integration', () => {
  const platformDomains = ['localhost', 'platform.com'];

  it('correctly routes storefront: acme.platform.com', () => {
    const subdomain = extractSubdomain('acme.platform.com', platformDomains);
    expect(subdomain).toBe('acme');
    
    const parsed = parseSubdomain(subdomain!);
    expect(parsed).toEqual({ type: 'storefront', slug: 'acme' });
  });

  it('correctly routes admin: admin.acme.platform.com', () => {
    const subdomain = extractSubdomain('admin.acme.platform.com', platformDomains);
    expect(subdomain).toBe('admin.acme');
    
    const parsed = parseSubdomain(subdomain!);
    expect(parsed).toEqual({ type: 'admin', slug: 'acme' });
  });

  it('correctly routes api: api.acme.platform.com', () => {
    const subdomain = extractSubdomain('api.acme.platform.com', platformDomains);
    expect(subdomain).toBe('api.acme');
    
    const parsed = parseSubdomain(subdomain!);
    expect(parsed).toEqual({ type: 'api', slug: 'acme' });
  });

  it('handles localhost development: acme.localhost:3000', () => {
    const subdomain = extractSubdomain('acme.localhost:3000', platformDomains);
    expect(subdomain).toBe('acme');
    
    const parsed = parseSubdomain(subdomain!);
    expect(parsed).toEqual({ type: 'storefront', slug: 'acme' });
  });

  it('handles localhost admin: admin.acme.localhost:3001', () => {
    const subdomain = extractSubdomain('admin.acme.localhost:3001', platformDomains);
    expect(subdomain).toBe('admin.acme');
    
    const parsed = parseSubdomain(subdomain!);
    expect(parsed).toEqual({ type: 'admin', slug: 'acme' });
  });

  it('identifies custom domain for resolution', () => {
    const subdomain = extractSubdomain('store.example.com', platformDomains);
    expect(subdomain).toBeNull();
    // When subdomain is null but host is not a platform domain,
    // it should be treated as a custom domain
  });
});

describe('Real-world hostname scenarios', () => {
  const platformDomains = ['localhost', 'platform.com', 'platform.local'];

  const testCases = [
    // Production scenarios
    { hostname: 'acme.platform.com', expectedSubdomain: 'acme', expectedType: 'storefront', expectedSlug: 'acme' },
    { hostname: 'admin.acme.platform.com', expectedSubdomain: 'admin.acme', expectedType: 'admin', expectedSlug: 'acme' },
    { hostname: 'api.acme.platform.com', expectedSubdomain: 'api.acme', expectedType: 'api', expectedSlug: 'acme' },
    
    // Development scenarios
    { hostname: 'demo.localhost:3000', expectedSubdomain: 'demo', expectedType: 'storefront', expectedSlug: 'demo' },
    { hostname: 'admin.demo.localhost:3001', expectedSubdomain: 'admin.demo', expectedType: 'admin', expectedSlug: 'demo' },
    
    // Staging scenarios  
    { hostname: 'test-store.platform.local', expectedSubdomain: 'test-store', expectedType: 'storefront', expectedSlug: 'test-store' },
    
    // Custom domains (should return null subdomain)
    { hostname: 'www.my-custom-shop.com', expectedSubdomain: null, expectedType: null, expectedSlug: null },
    { hostname: 'store.brandname.io', expectedSubdomain: null, expectedType: null, expectedSlug: null },
  ];

  testCases.forEach(({ hostname, expectedSubdomain, expectedType, expectedSlug }) => {
    it(`correctly handles: ${hostname}`, () => {
      const subdomain = extractSubdomain(hostname, platformDomains);
      expect(subdomain).toBe(expectedSubdomain);

      if (subdomain) {
        const parsed = parseSubdomain(subdomain);
        expect(parsed?.type).toBe(expectedType);
        expect(parsed?.slug).toBe(expectedSlug);
      }
    });
  });
});
