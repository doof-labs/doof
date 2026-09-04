import { PostHog } from 'posthog-node';
import { config } from './config.js';
import { sha256 } from './crypto.js';

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

export interface Analytics {
  capture(event: string, distinctId: string, properties?: AnalyticsProperties): void;
  shutdown(): Promise<void>;
}

export const noAnalytics: Analytics = {
  capture() {},
  async shutdown() {},
};

/** A stable analytics identity that cannot reveal the underlying doof record identifier. */
export function analyticsId(kind: 'binding' | 'verification', id: string): string {
  return `${kind}_${sha256(`doof-analytics:${kind}:${id}`).slice(0, 32)}`;
}

export function createAnalytics(): Analytics {
  if (!config.posthogKey) return noAnalytics;
  const client = new PostHog(config.posthogKey, { host: config.posthogHost });
  return {
    capture(event, distinctId, properties = {}) {
      try {
        client.capture({
          event,
          distinctId,
          disableGeoip: true,
          properties: {
            ...properties,
            $process_person_profile: false,
            source: 'server',
          },
        });
      } catch (error) {
        console.error('analytics capture failed', event, error);
      }
    },
    async shutdown() {
      await Promise.resolve(client.shutdown(5_000));
    },
  };
}
