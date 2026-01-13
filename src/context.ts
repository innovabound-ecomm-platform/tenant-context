/**
 * Tenant Context Class
 *
 * Holds tenant information for the current request.
 */

/** Plan tier types */
export type PlanType = 'STARTER' | 'GROWTH' | 'BUSINESS' | 'ENTERPRISE';

/** Tenant resource limits based on plan */
export interface TenantLimits {
  maxProducts: number;
  maxOrders: number;
  maxStaff: number;
  maxWarehouses: number;
  apiRateLimit: number;
}

/** Add-on types available */
export type AddonType =
  | 'LABEL_GENERATION'
  | 'CAMPAIGN_MANAGER'
  | 'ADVANCED_LOYALTY'
  | 'AI_SEARCH';

/** Full tenant information including entitlements */
export interface TenantInfo {
  tenantId: string;
  tenantSlug: string;
  name: string;
  databaseName: string;
  status: string;
  plan: PlanType;
  limits: TenantLimits;
  addons: AddonType[];
}

/** Minimal tenant info for cache efficiency */
export interface TenantInfoBasic {
  tenantId: string;
  tenantSlug: string;
  databaseName: string;
  status: string;
}

export class TenantContext {
  private static currentTenant: TenantInfo | null = null;

  /**
   * Set the current tenant context
   */
  static set(tenant: TenantInfo): void {
    this.currentTenant = tenant;
  }

  /**
   * Get the current tenant context
   */
  static get(): TenantInfo | null {
    return this.currentTenant;
  }

  /**
   * Get the current tenant or throw if not set
   */
  static require(): TenantInfo {
    if (!this.currentTenant) {
      throw new Error('Tenant context not set');
    }
    return this.currentTenant;
  }

  /**
   * Clear the current tenant context
   */
  static clear(): void {
    this.currentTenant = null;
  }

  /**
   * Get the database URL for the current tenant
   */
  static getDatabaseUrl(baseUrl: string): string {
    const tenant = this.require();
    return baseUrl.replace(/\/[^/?]+(\?|$)/, `/${tenant.databaseName}$1`);
  }

  /**
   * Check if the current tenant has a specific add-on
   */
  static hasAddon(addon: AddonType): boolean {
    const tenant = this.get();
    return tenant?.addons.includes(addon) ?? false;
  }

  /**
   * Check if the current tenant's plan meets minimum tier
   */
  static hasPlanAtLeast(minPlan: PlanType): boolean {
    const tenant = this.get();
    if (!tenant) return false;

    const planOrder: PlanType[] = ['STARTER', 'GROWTH', 'BUSINESS', 'ENTERPRISE'];
    const currentIndex = planOrder.indexOf(tenant.plan);
    const minIndex = planOrder.indexOf(minPlan);
    
    return currentIndex >= minIndex;
  }
}
