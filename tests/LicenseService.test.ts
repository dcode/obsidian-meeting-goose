/**
 * Tests for LicenseService
 */

import { LicenseService } from '../src/services/LicenseService';
import { requestUrl } from 'obsidian';

jest.mock('obsidian', () => ({ requestUrl: jest.fn(), Notice: jest.fn() }));

const requestMock = requestUrl as jest.Mock;
const key = 'AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD';
const otherKey = '11111111-22222222-33333333-44444444';
const purchase = {
  product_id: 'IFrtaEBYVmSq-bu8jIaTBg==',
  price: 3900,
  email: 'buyer@example.com',
  refunded: false,
  disputed: false,
  dispute_won: false,
};
const validResponse = { status: 200, json: { success: true, purchase } };

describe('LicenseService', () => {
  let licenseService: LicenseService;

  beforeEach(() => {
    requestMock.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    licenseService = new LicenseService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Gumroad verification', () => {
    it.each(['DEV-MODE', 'TEST-PRO', ' test-pro ', 'invalid', ''])('rejects %j without an API call', async (invalidKey) => {
      expect((await licenseService.setLicenseKey(invalidKey)).status).toBe('free');
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('unlocks only after verification without consuming another use', async () => {
      requestMock.mockResolvedValue(validResponse);
      expect((await licenseService.setLicenseKey(key)).status).toBe('pro');
      expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://api.gumroad.com/v2/licenses/verify',
        method: 'POST',
        body: expect.stringContaining(`license_key=${key}&increment_uses_count=false`),
      }));
      await licenseService.validateLicense();
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      { success: false },
      { success: true },
      { success: true, purchase: { ...purchase, product_id: 'other-product' } },
      { success: true, purchase: { ...purchase, refunded: true } },
      { success: true, purchase: { ...purchase, disputed: true } },
    ])('rejects invalid or revoked purchase: %j', async (json) => {
      requestMock.mockResolvedValue({ status: 200, json });
      expect((await licenseService.setLicenseKey(key)).status).toBe('free');
    });

    it('accepts a dispute won by the seller', async () => {
      requestMock.mockResolvedValue({ status: 200, json: {
        success: true, purchase: { ...purchase, disputed: true, dispute_won: true },
      } });
      expect((await licenseService.setLicenseKey(key)).status).toBe('pro');
    });

    it('preserves supporter purchases', async () => {
      requestMock.mockResolvedValue({ status: 200, json: {
        success: true, purchase: { ...purchase, price: 5000 },
      } });
      expect((await licenseService.setLicenseKey(key)).status).toBe('supporter');
    });

    it('does not transfer cached Pro access to a different key', async () => {
      requestMock.mockResolvedValueOnce(validResponse).mockRejectedValueOnce(new Error('offline'));
      await licenseService.setLicenseKey(key);
      expect((await licenseService.setLicenseKey(otherKey)).status).toBe('free');
      expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('rejects a former test key even after successful activation', async () => {
      requestMock.mockResolvedValue(validResponse);
      await licenseService.setLicenseKey(key);
      expect((await licenseService.setLicenseKey('TEST-PRO')).status).toBe('free');
    });

    it('ignores a pending response after the key is cleared', async () => {
      let resolve!: (value: typeof validResponse) => void;
      requestMock.mockReturnValue(new Promise((done) => { resolve = done; }));
      const pending = licenseService.setLicenseKey(key);
      await licenseService.setLicenseKey('');
      resolve(validResponse);
      await pending;
      expect(licenseService.isPro()).toBe(false);
    });

    it('keeps an already verified key during an outage, but expires grace', async () => {
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      requestMock.mockResolvedValueOnce(validResponse).mockRejectedValue(new Error('offline'));
      await licenseService.setLicenseKey(key);
      clock.mockReturnValue(now + 2 * 86400000);
      expect((await licenseService.validateLicense()).status).toBe('pro');
      clock.mockReturnValue(now + 8 * 86400000);
      expect((await licenseService.validateLicense()).status).toBe('free');
    });

    it.each([429, 500, 503])('preserves verified access for temporary HTTP %s failures', async (status) => {
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      requestMock.mockResolvedValueOnce(validResponse).mockResolvedValue({ status });
      await licenseService.setLicenseKey(key);
      clock.mockReturnValue(now + 2 * 86400000);
      expect((await licenseService.validateLicense()).status).toBe('pro');
    });

    it('revokes cached access when Gumroad reports a refund', async () => {
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      requestMock.mockResolvedValueOnce(validResponse).mockResolvedValue({ status: 200, json: {
        success: true, purchase: { ...purchase, refunded: true },
      } });
      await licenseService.setLicenseKey(key);
      clock.mockReturnValue(now + 2 * 86400000);
      expect((await licenseService.validateLicense()).status).toBe('free');
    });

    it('rejects malformed responses without logging raw response text', async () => {
      const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
      requestMock.mockResolvedValue({ status: 200, text: key, get json() { throw new Error(key); } });
      expect((await licenseService.setLicenseKey(key)).status).toBe('free');
      expect(debug).not.toHaveBeenCalled();
    });

    it('does not log purchase data or exception details', async () => {
      const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
      requestMock.mockResolvedValueOnce(validResponse).mockRejectedValueOnce(new Error(otherKey));
      await licenseService.setLicenseKey(key);
      await licenseService.setLicenseKey(otherKey);
      expect(debug).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('MeetingMind: license validation unavailable');
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });

  describe('initial state', () => {
    it('should start with free tier', () => {
      expect(licenseService.isPro()).toBe(false);
      expect(licenseService.hasFeature('aiEnrichment')).toBe(false);
    });
  });

  describe('setLicenseKey', () => {
    it('should accept valid license key', async () => {
      // Note: Actual validation would require a real license key
      // This tests the method exists and doesn't crash
      await expect(licenseService.setLicenseKey('')).resolves.not.toThrow();
    });

    it('should handle empty license key', async () => {
      await licenseService.setLicenseKey('');
      expect(licenseService.isPro()).toBe(false);
    });
  });

  describe('hasFeature', () => {
    it('should return false for pro features on free tier', () => {
      expect(licenseService.hasFeature('aiEnrichment')).toBe(false);
      expect(licenseService.hasFeature('participantInsights')).toBe(false);
      expect(licenseService.hasFeature('prioritySupport')).toBe(false);
    });
  });

  describe('isPro', () => {
    it('should return false by default', () => {
      expect(licenseService.isPro()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle invalid feature names gracefully', () => {
      // @ts-ignore - Testing invalid input
      const result = licenseService.hasFeature('nonexistentFeature');
      expect(result).toBeUndefined();
    });
  });
});
