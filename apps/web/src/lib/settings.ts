import { PORTAL_SETTING_DEFAULTS, type PortalSettings } from '@wd/contracts';
import { api } from './api';

/** Public portal settings; falls back to defaults if the API cannot be reached. */
export const portalSettings = (): Promise<PortalSettings> =>
  api<PortalSettings>('/api/v1/public/settings', { optionalAuth: true }).catch(
    () => PORTAL_SETTING_DEFAULTS,
  );
