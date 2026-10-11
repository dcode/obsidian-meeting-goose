/**
 * LicenseService - Handle license validation and feature gating
 * Supports Gumroad license keys with API validation
 */

import { Notice, requestUrl } from 'obsidian';

export type LicenseStatus = 'free' | 'pro' | 'supporter';

export interface LicenseInfo {
  status: LicenseStatus;
  email?: string;
  validUntil?: string;
  purchaseDate?: string;
  features: {
    aiEnrichment: boolean;
    participantInsights: boolean;
    prioritySupport: boolean;
  };
}

// Features available in each tier
const TIER_FEATURES = {
  free: {
    aiEnrichment: false,
    participantInsights: false,
    prioritySupport: false,
  },
  pro: {
    aiEnrichment: true,
    participantInsights: true,
    prioritySupport: false,
  },
  supporter: {
    aiEnrichment: true,
    participantInsights: true,
    prioritySupport: true,
  },
};

// Gumroad product configuration
// Product: https://tumbucon.gumroad.com/l/meetingmind-pro
// Note: Gumroad API requires the full product ID (not permalink or short ID) for products created after Jan 9, 2023
// The short_product_id "llgrpr" is NOT the same as the API product_id — use the full ID from Gumroad dashboard
const GUMROAD_PRODUCT_ID = 'IFrtaEBYVmSq-bu8jIaTBg==';

export class LicenseService {
  private licenseKey: string = '';
  private licenseInfo: LicenseInfo;
  private lastValidation: number = 0;
  private readonly VALIDATION_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days offline grace
  
  constructor() {
    this.licenseInfo = {
      status: 'free',
      features: TIER_FEATURES.free,
    };
  }
  
  /**
   * Set the license key and validate it
   */
  async setLicenseKey(key: string): Promise<LicenseInfo> {
    const nextKey = key.trim();
    if (nextKey !== this.licenseKey) {
      this.lastValidation = 0;
      this.licenseInfo = { status: 'free', features: TIER_FEATURES.free };
    }
    this.licenseKey = nextKey;
    
    if (!this.licenseKey) {
      this.licenseInfo = {
        status: 'free',
        features: TIER_FEATURES.free,
      };
      return this.licenseInfo;
    }
    
    return await this.validateLicense();
  }
  
  /**
   * Validate the current license key
   */
  async validateLicense(): Promise<LicenseInfo> {
    const key = this.licenseKey;
    if (!this.isGumroadKey(key)) {
      this.licenseInfo = {
        status: 'free',
        features: TIER_FEATURES.free,
      };
      return this.licenseInfo;
    }
    
    // Check if we validated recently (cache valid licenses)
    const now = Date.now();
    if (now - this.lastValidation < this.VALIDATION_INTERVAL && this.licenseInfo.status !== 'free') {
      return this.licenseInfo;
    }
    
    try {
      const result = await this.validateWithGumroad(key);
      // A response for a replaced key must not change the current entitlement.
      if (key !== this.licenseKey) return this.licenseInfo;
      this.licenseInfo = result;
      this.lastValidation = now;
      
      return this.licenseInfo;
    } catch {
      if (key !== this.licenseKey) return this.licenseInfo;
      console.error('MeetingMind: license validation unavailable');
      
      // On network error, keep existing Pro status for grace period
      // This only applies if they previously had a validated license
      if (this.licenseInfo.status !== 'free' && now - this.lastValidation < this.GRACE_PERIOD) {
        console.debug('MeetingMind: using cached license during grace period');
        return this.licenseInfo;
      }
      
      // Network failed and no cached license - return free
      this.licenseInfo = {
        status: 'free',
        features: TIER_FEATURES.free,
      };
      return this.licenseInfo;
    }
  }
  
  /**
   * Check if key looks like a Gumroad license key
   * Gumroad keys are typically: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (32 hex + 3 dashes = 35 chars)
   */
  private isGumroadKey(key: string): boolean {
    // Gumroad format: 8 hex chars, dash, repeated 4 times
    const gumroadPattern = /^[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/i;
    return gumroadPattern.test(key.trim());
  }
  
  /**
   * Validate license key with Gumroad API
   */
  private async validateWithGumroad(key: string): Promise<LicenseInfo> {
    const response = await requestUrl({
      url: 'https://api.gumroad.com/v2/licenses/verify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `product_id=${GUMROAD_PRODUCT_ID}&license_key=${encodeURIComponent(key)}&increment_uses_count=false`,
      throw: false, // Don't throw on non-200 responses
    });

    if (response.status === 429 || response.status >= 500) {
      throw new Error('License verification temporarily unavailable');
    }

    let data: { success?: unknown; purchase?: Record<string, unknown> } | null = null;
    try {
      data = response.json as { success?: unknown; purchase?: Record<string, unknown> } | null;
    } catch {
      // Invalid responses cannot grant an entitlement.
    }

    if (
      response.status === 200 && data?.success === true &&
      data.purchase?.product_id === GUMROAD_PRODUCT_ID &&
      !data.purchase.refunded &&
      !(data.purchase.disputed && !data.purchase.dispute_won)
    ) {
      // Check if it's a supporter tier (you can add variants in Gumroad).
      const isSupporter = (typeof data.purchase.variants === 'string' && data.purchase.variants.includes('supporter')) ||
                          (typeof data.purchase.price === 'number' && data.purchase.price >= 5000); // $50+ = supporter

      return {
        status: isSupporter ? 'supporter' : 'pro',
        email: typeof data.purchase.email === 'string' ? data.purchase.email : undefined,
        purchaseDate: typeof data.purchase.created_at === 'string' ? data.purchase.created_at : undefined,
        features: isSupporter ? TIER_FEATURES.supporter : TIER_FEATURES.pro,
        validUntil: 'lifetime',
      };
    }
    
    return {
      status: 'free',
      features: TIER_FEATURES.free,
    };
  }
  
  /**
   * Get current license info
   */
  getLicenseInfo(): LicenseInfo {
    return this.licenseInfo;
  }
  
  /**
   * Check if a specific feature is available
   */
  hasFeature(feature: keyof LicenseInfo['features']): boolean {
    return this.licenseInfo.features[feature];
  }
  
  /**
   * Check if user has Pro or higher
   */
  isPro(): boolean {
    return this.licenseInfo.status === 'pro' || this.licenseInfo.status === 'supporter';
  }
  
  /**
   * Check if user is a supporter
   */
  isSupporter(): boolean {
    return this.licenseInfo.status === 'supporter';
  }
  
  /**
   * Show upgrade notice for a feature
   */
  showUpgradeNotice(feature: string): void {
    new Notice(
      `${feature} requires MeetingMind Pro.\n\nGet it at tumbucon.gumroad.com/l/meetingmind-pro for $39 (lifetime).`,
      8000
    );
  }
  
  /**
   * Get status display text
   */
  getStatusText(): string {
    switch (this.licenseInfo.status) {
      case 'supporter':
        return '⭐ Supporter Edition';
      case 'pro':
        return '✓ Pro License (Active)';
      default:
        return 'Free (AI features locked)';
    }
  }
  
  /**
   * Get the license key (masked for display)
   */
  getMaskedKey(): string {
    if (!this.licenseKey) return '';
    if (this.licenseKey.length <= 8) return '****';
    return this.licenseKey.slice(0, 4) + '...' + this.licenseKey.slice(-4);
  }
}
