import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { renderPrometheus } from "../../observability/metrics.js";

@Controller("metrics")
export class MetricsController {
  @Get()
  metrics(@Res() reply: FastifyReply): void {
    void reply
      .status(200)
      .header("content-type", "text/plain; version=0.0.4")
      .send(renderPrometheus());
  }
}
