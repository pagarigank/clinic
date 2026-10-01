import pg from 'pg';
const c = new pg.Client({connectionString: 'postgres://clinic_app:clinic_app_dev@localhost:5432/clinic'});
try {
  await c.connect();
  const r = await c.query("SELECT current_user, current_setting('is_superuser') AS su");
  console.log('OK', JSON.stringify(r.rows));
  await c.end();
} catch(e) {
  console.log('ERR:', e.message);
}
