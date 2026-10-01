import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "@clinic/contracts";
import { statusForCode } from "./problem.js";
import type { FieldError } from "./zod-validation.pipe.js";

/**
 * Throw an RFC 9457 problem+json by the contracts ERROR_CODES catalogue
 * (architecture §11.2). The filter (http/problem.filter.ts) renders it.
 */
export class ProblemException extends HttpException {
  constructor(
    code: ErrorCode,
    opts: { detail?: string; errors?: FieldError[] } = {},
  ) {
    super(
      {
        code,
        ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
        ...(opts.errors !== undefined ? { errors: opts.errors } : {}),
      },
      statusForCode(code),
    );
  }
}
