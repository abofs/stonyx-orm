declare module 'stonyx/config' {
  import type { OrmConfig } from './orm-types.js';
  const config: OrmConfig;
  export default config;
}

declare module 'stonyx/log' {
  interface Log {
    db(message: string): void;
    error(message: string, ...args: unknown[]): void;
    defineType(type: string, setting: string, options?: Record<string, unknown> | null): void;
    [key: string]: ((...args: unknown[]) => void) | undefined;
  }
  const log: Log;
  export default log;
}

declare module 'stonyx' {
  export function waitForModule(name: string): Promise<void>;
}

declare module 'stonyx/test-helpers' {
  export function setupIntegrationTests(hooks: {
    before(fn: () => void | Promise<void>): void;
    after(fn: () => void | Promise<void>): void;
  }): void;
}
