import { Inject, Injectable } from '@nestjs/common';
import { PORTAL_SETTING_DEFAULTS, PortalSettings } from '@wd/contracts';
import type { Database } from '../../db/database.js';
import { DB } from '../../tokens.js';

const TTL_MS = 15_000;

/** Reads portal settings with a short cache; unknown or invalid stored values fall back to defaults. */
@Injectable()
export class SettingsService {
  private cached: { at: number; value: PortalSettings } | null = null;
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(): Promise<PortalSettings> {
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
    const rows = await this.db.withAnonymous((tx) =>
      tx.selectFrom('portal_setting').select(['key', 'value']).execute(),
    );
    const merged: Record<string, unknown> = { ...PORTAL_SETTING_DEFAULTS };
    for (const r of rows) {
      const one = PortalSettings.shape[r.key as keyof PortalSettings]?.safeParse(r.value);
      if (one?.success) merged[r.key] = one.data;
    }
    const value = PortalSettings.parse(merged);
    this.cached = { at: Date.now(), value };
    return value;
  }

  forget() {
    this.cached = null;
  }
}
