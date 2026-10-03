import pg from 'pg';

const client = new pg.Client('postgres://kpagarigan2:P%40ssw0rd@localhost:5432/clinic');
await client.connect();
await client.query(`
  ALTER TABLE files ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'CLEAN' CHECK (scan_status IN ('SCAN_PENDING', 'CLEAN', 'INFECTED'));
  ALTER TABLE files ADD COLUMN IF NOT EXISTS preview_object_key text;
  ALTER TABLE files ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;
`);
console.log('files columns added successfully');
await client.end();
