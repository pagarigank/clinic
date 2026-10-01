// Global ambient declarations for untyped packages.
// NOTE: keep this file a script (no top-level imports) so `declare module`
// stays ambient. The vitest matcher augmentation lives in vitest.d.ts.
declare module "jest-axe" {
  import type { Result } from "axe-core";

  export interface AxeResults {
    passes: Result[];
    violations: Result[];
    incomplete: Result[];
  }
  export const toHaveNoViolations: { toHaveNoViolations(): void };
  export function axe(html: string | Element, options?: unknown): Promise<AxeResults>;
}
