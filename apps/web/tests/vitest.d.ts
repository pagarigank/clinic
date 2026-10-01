// Module augmentation (file must be a module — hence the import) so
// toHaveNoViolations merges into the real vitest Assertion type.
import type { Assertion } from "vitest";

declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
}
