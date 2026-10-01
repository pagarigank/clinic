import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PingService } from "./ping.service.js";
import { Public } from "../../auth/auth-context.js";

@Controller("api/v1/ping")
@Public()
export class PingController {
  // Explicit @Inject: esbuild (tsx) does not emit design:paramtypes metadata.
  constructor(@Inject(PingService) private readonly pingService: PingService) {}

  @Get()
  async ping(@Req() request: FastifyRequest & { correlationId?: string }) {
    return this.pingService.ping(request.correlationId ?? crypto.randomUUID());
  }
}
