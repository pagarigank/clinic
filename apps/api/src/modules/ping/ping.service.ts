import { Injectable } from "@nestjs/common";
import { withTenant } from "@clinic/db";

@Injectable()
export class PingService {
  /** Round trip to Postgres under the app role; RLS applies (no tenant → 0 rows). */
  async ping(requestId: string): Promise<{ message: string; dbTime: string; request_id: string }> {
    const result = await withTenant({ requestId }, async (tx) => {
      const res = await tx.query<{ now: string }>("SELECT to_char(now(), 'YYYY-MM-DD HH24:MI:SSOF') AS now");
      return res.rows[0]?.now ?? "";
    });
    return { message: "pong", dbTime: result, request_id: requestId };
  }
}
