declare module '@stonyx/rest-server' {
  export class Request {
    constructor(...args: unknown[]);
  }

  interface RouteOptions {
    name: string;
    /**
     * `access` is the two-argument post-#202 shape. This is the THIRD place the
     * contract is declared (`AccessInstance.access` in
     * `src/setup-rest-server.ts` and `OrmRequest.access` in
     * `src/orm-request.ts` are the other two) and it is the one `mountRoute` is
     * actually called through, at `src/setup-rest-server.ts`. It kept the
     * pre-#202 single-argument signature after the other two migrated; the
     * union with `Record<string, unknown>` meant nothing broke, which is
     * exactly why it would have drifted silently.
     *
     * Spelled structurally rather than as `AccessFunction`: an ambient
     * `declare module` block cannot carry an `import type`.
     */
    options?: { model: string; access: (request: unknown, context: { model: string; operation: string | undefined }) => unknown } | Record<string, unknown>;
  }

  export default class RestServer {
    static instance: RestServer;
    static close(): void;
    mountRoute(RequestClass: typeof Request, options: RouteOptions): void;
  }
}
