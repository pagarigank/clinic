import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { AuditInterceptor } from "./audit.interceptor.js";
import { PhiAccessInterceptor } from "./phi-access.interceptor.js";

@Module({
  providers: [
    Reflector,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PhiAccessInterceptor,
    },
  ],
})
export class AuditModule {}
