declare module 'path' {
  export function dirname(p: string): string;
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  const path: { dirname: typeof dirname; resolve: typeof resolve; join: typeof join };
  export default path;
}

declare module 'fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  const fs: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    readdir: typeof readdir;
    mkdir: typeof mkdir;
  };
  export default fs;
}
