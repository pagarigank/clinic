import { HttpException, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/**
 * Zod-based request validation (todo 0.3: "Global validation pipe (Zod)").
 * The NestJS built-in ValidationPipe is class-validator based and is
 * intentionally NOT used — the stack standard is Zod everywhere, sharing
 * schemas with `packages/contracts` (architecture §8, frontend §4).
 *
 * Usage on a controller parameter:
 *   @Post() create(@Body(new ZodValidationPipe(CreateSchema)) body: CreateDto) {}
 *
 * Errors surface as RFC 9457 problem+json with code VALIDATION_FAILED (422)
 * and a field-path `errors[]` array (architecture §18, ERROR_CODES map).
 */
export interface FieldError {
  path: string;
  message: string;
}

export class ValidationFailedException extends HttpException {
  constructor(errors: FieldError[]) {
    super(
      {
        code: "VALIDATION_FAILED",
        detail: errors.length > 0 ? `${errors.length} validation error(s)` : "Validation failed",
        errors,
      },
      422,
    );
  }
}

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ValidationFailedException(
        result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
