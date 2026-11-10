/**
 * Mock for shell-env (ESM-only, and it would spawn the developer's login shell).
 */

export const shellEnv = jest.fn(async (): Promise<Record<string, string>> => ({}));
