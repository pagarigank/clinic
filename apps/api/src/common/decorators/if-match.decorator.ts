import { createParamDecorator, BadRequestException, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * Extracts the If-Match header and parses it as an integer row_version.
 * Used for optimistic concurrency control (G-06).
 */
export const IfMatch = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const ifMatch = request.headers['if-match'];
    
    if (!ifMatch) {
      // In some cases, we might want this optional, but strict architecture usually demands it for PATCH.
      // We will return undefined if not provided, allowing the controller/service to decide if it's required.
      // But typically, missing If-Match on a concurrency-controlled route is 428 Precondition Required.
      return undefined as any;
    }

    // Strip quotes if any (ETags are often quoted like "2")
    const rawVersion = ifMatch.replace(/"/g, '');
    const version = parseInt(rawVersion, 10);
    
    if (isNaN(version)) {
      throw new BadRequestException('If-Match header must be an integer');
    }

    return version;
  },
);
