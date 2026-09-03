import { BrowserContext, Page } from 'playwright';

export interface VpsLoginSession {
  context: BrowserContext;
  page: Page;
  platform: string;
  timeoutId: NodeJS.Timeout;
}

const globalForVps = global as typeof globalThis & {
  vpsLoginSessions?: Map<number, VpsLoginSession>;
};

if (!globalForVps.vpsLoginSessions) {
  globalForVps.vpsLoginSessions = new Map();
}

export const vpsLoginSessions = globalForVps.vpsLoginSessions;
export default vpsLoginSessions;
