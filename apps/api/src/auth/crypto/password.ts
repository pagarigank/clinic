import { hash, verify } from "@node-rs/argon2";
import { getConfig } from "../../config.js";

/**
 * Argon2id (architecture §10) with OWASP baseline parameters (m=19 MiB,
 * t=2, p=1) from config. Password policy: min length 12; a light character
 * mix check blocks the most trivial picks without becoming a "password
 * rules" anti-pattern (NIST SP 800-63B: length is the primary control).
 */
export class PasswordService {
  // getConfig() cached singleton — no constructor DI (see tokens.ts note).
  async hashPassword(plain: string): Promise<string> {
    const config = getConfig();
    return hash(plain, {
      memoryCost: config.ARGON2_MEMORY_KIB,
      timeCost: config.ARGON2_TIME_COST,
      parallelism: config.ARGON2_PARALLELISM,
    });
  }

  async verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
    // The seed placeholder hash is not a valid argon2 string — treat any
    // hash/verify failure as a failed credential rather than a 500.
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false;
    }
  }

  validatePolicy(plain: string): { ok: boolean; errors: { path: string; message: string }[] } {
    const errors: { path: string; message: string }[] = [];
    if (plain.length < getConfig().PASSWORD_MIN_LENGTH) {
      errors.push({
        path: "password",
        message: `must be at least ${getConfig().PASSWORD_MIN_LENGTH} characters`,
      });
    }
    if (!/[a-z]/.test(plain) || !/[A-Z]/.test(plain) || !/[0-9]/.test(plain)) {
      errors.push({
        path: "password",
        message: "must include upper case, lower case, and a digit",
      });
    }
    return { ok: errors.length === 0, errors };
  }
}
