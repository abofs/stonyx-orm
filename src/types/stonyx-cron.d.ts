declare module '@stonyx/cron' {
  export default class Cron {
    register(name: string, fn: () => void | Promise<void>, interval: unknown): void;
  }
}
