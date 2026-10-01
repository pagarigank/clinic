const PgBoss = require('pg-boss'); const boss = new PgBoss({ connectionString: 'postgres://localhost:5432/dummy' }); console.log(boss.getMigrationPlans('pgboss', '10.0.0'));
