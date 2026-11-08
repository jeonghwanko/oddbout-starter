// The page globals the site's analytics code reads and sets: site-analytics.mjs startAnalytics and site-milestones.mjs bridge.
// Declared here rather than cast inline, because those functions ship as their own source text (Function.prototype.toString).
interface Window {
  /** Google's tag queue: startAnalytics creates it before gtag pushes to it. */
  dataLayer: IArguments[];
  // biome-ignore lint/suspicious/noExplicitAny: gtag('get') hands back whatever the field holds
  gtag: { (command: 'get', target: string, field: string, done: (value: any) => void): void; (...args: unknown[]): void };
  oddboutAnalyticsStarted?: boolean;
  /** Google's opt-out flag, window['ga-disable-<measurement id>']. */
  [gaDisable: `ga-disable-${string}`]: unknown;
  /** Set by startAnalytics; site-milestones.mjs calls it after sign-in. */
  oddboutBindAnalytics?: (api: string, token: string, key: string) => Promise<void>;
}
interface Navigator {
  globalPrivacyControl?: boolean;
}
interface WindowEventMap {
  // biome-ignore lint/suspicious/noExplicitAny: a milestone's detail is each milestone's own shape
  'oddbout:milestone': CustomEvent<any>;
}
