import "reflect-metadata";

// Load local .env and sanitize DB credentials
try {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile();
  }
} catch {
  // .env file absent or already loaded
}

for (const key of ["DATABASE_URL_APP", "DATABASE_URL_MIGRATOR", "DATABASE_URL_REPORT", "CLINIC_DATABASE_URL"]) {
  if (process.env[key] && process.env[key]!.includes("kpagarigan:") && !process.env[key]!.includes("kpagarigan2:")) {
    process.env[key] = process.env[key]!.replace("kpagarigan:", "kpagarigan2:");
  }
}

import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { AppModule } from "./app.module.js";
import { ProblemExceptionFilter } from "./http/problem.filter.js";
import { attachCorrelationId } from "./http/request-context.js";
import { getConfig } from "./config.js";
import cookie from "@fastify/cookie";

async function bootstrap(): Promise<void> {
  const config = getConfig();
  const adapter = new FastifyAdapter({ logger: false, trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  // Refresh + remember-device cookies (Phase 1.2) are httpOnly SameSite=Strict.
  await app.register(cookie);

  // Correlation id on every request (todo 0.3) — a Fastify onRequest hook,
  // not a Nest middleware, so it also covers framework-level 404s.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (request) => {
    attachCorrelationId(request);
  });

  // Request validation is Zod-based and param-scoped (ZodValidationPipe in
  // http/zod-validation.pipe.ts). The class-validator ValidationPipe is
  // deliberately not installed — Zod schemas in packages/contracts are the
  // single source of truth for both API and web (architecture §8).
  app.useGlobalFilters(new ProblemExceptionFilter());
  // Global prefix so controllers are served at /api/v1/<path> — matching
  // the Vite proxy target and the web client's apiBase().
  app.setGlobalPrefix('api/v1');

  const { DocumentBuilder, SwaggerModule } = await import('@nestjs/swagger');
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Clinic Platform API')
    .setDescription('The internal API documentation')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.PORT, "0.0.0.0");

  if (config.NODE_ENV !== "test") {
    console.log(`api listening on :${config.PORT} (env=${config.NODE_ENV})`);
  }
}

void bootstrap();
