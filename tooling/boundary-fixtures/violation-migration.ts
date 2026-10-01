// Deliberate boundary violation — must FAIL eslint (see boundary.test.mjs).
import { SECURITY_DEFINER_HINT } from "./template.js";

export const migrationSql = `
CREATE FUNCTION bad() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END; $$;
SELECT * FROM patients;
`;

void SECURITY_DEFINER_HINT;
