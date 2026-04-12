declare module '@stonyx/rest-server' {
  export class Request {
    constructor(...args: unknown[]);
  }

  interface RouteOptions {
    name: string;
    options?: { model: string; access: (request: unknown) => unknown } | Record<string, unknown>;
  }

  export default class RestServer {
    static instance: RestServer;
    static close(): void;
    mountRoute(RequestClass: typeof Request, options: RouteOptions): void;
  }
}
