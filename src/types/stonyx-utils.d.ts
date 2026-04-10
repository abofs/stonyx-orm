declare module '@stonyx/utils/file' {
  export function createFile(path: string, data: unknown, options?: { json?: boolean }): Promise<void>;
  export function createDirectory(path: string): Promise<void>;
  export function updateFile(path: string, data: unknown, options?: { json?: boolean }): Promise<void>;
  export function readFile(path: string, options?: { json?: boolean; missingFileCallback?: () => Promise<unknown> }): Promise<unknown>;
  export function fileExists(path: string): Promise<boolean>;
  export function deleteDirectory(path: string): Promise<void>;
  export function forEachFileImport(
    path: string,
    callback: (exported: unknown, meta: { name: string }) => unknown,
    options?: { ignoreAccessFailure?: boolean; rawName?: boolean; recursive?: boolean; recursiveNaming?: boolean }
  ): Promise<void>;
}

declare module '@stonyx/utils/string' {
  export function pluralize(word: string): string;
  export function kebabCaseToPascalCase(str: string): string;
  export function camelCaseToKebabCase(str: string): string;
}

declare module '@stonyx/utils/object' {
  export function get(obj: unknown, path: string): unknown;
  export function getOrSet<T>(map: Map<unknown, T>, key: unknown, defaultValue: T): T;
  export function makeArray<T>(value: T | T[]): T[];
}

declare module '@stonyx/utils/date' {
  export function getTimestamp(value?: unknown): number;
}

declare module '@stonyx/utils/prompt' {
  export function confirm(message: string): Promise<boolean>;
}
