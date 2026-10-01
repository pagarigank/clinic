import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ValidationFailedException,
  ZodValidationPipe,
} from "../src/http/zod-validation.pipe.js";

const Schema = z.object({
  name: z.string().min(2),
  dose: z.number().int().positive(),
});

const METADATA = { type: "body", metatype: Object, data: "" } as const;

describe("ZodValidationPipe", () => {
  it("passes parsed data through when the payload matches the schema", () => {
    const pipe = new ZodValidationPipe(Schema);
    const out = pipe.transform({ name: "Paracetamol", dose: 1 }, METADATA);
    expect(out).toEqual({ name: "Paracetamol", dose: 1 });
  });

  it("throws 422 VALIDATION_FAILED with field paths on an invalid payload", () => {
    const pipe = new ZodValidationPipe(Schema);
    try {
      pipe.transform({ name: "x", dose: -3 }, METADATA);
      expect.unreachable("pipe should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedException);
      const ex = error as ValidationFailedException;
      expect(ex.getStatus()).toBe(422);
      const payload = ex.getResponse() as {
        code: string;
        errors: { path: string; message: string }[];
      };
      expect(payload.code).toBe("VALIDATION_FAILED");
      expect(payload.errors.map((e) => e.path).sort()).toEqual(["dose", "name"]);
    }
  });
});
