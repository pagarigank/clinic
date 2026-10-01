import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuditInterceptor } from "./audit.interceptor.js";
import { PhiAccessInterceptor } from "./phi-access.interceptor.js";

@Module({
  providers: [
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
