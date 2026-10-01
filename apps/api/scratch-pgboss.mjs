import PgBoss from 'pg-boss';

const boss = new PgBoss({ connectionString: 'postgres://localhost:5432/dummy' });
const plans = boss.getMigrationPlans('pgboss', '10.0.0');
console.log(plans);
