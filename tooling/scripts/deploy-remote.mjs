#!/usr/bin/env node
/**
 * Automated deployment script for Clinic Platform production server.
 * Usage:
 *   node tooling/scripts/deploy-remote.mjs
 *   node tooling/scripts/deploy-remote.mjs --api-only
 *   node tooling/scripts/deploy-remote.mjs --web-only
 *   node tooling/scripts/deploy-remote.mjs --migrate
 */
import { NodeSSH } from 'node-ssh';
import * as fs from 'fs';
import * as path from 'path';

const ssh = new NodeSSH();

const HOST = process.env.DEPLOY_HOST || '192.168.100.201';
const USER = process.env.DEPLOY_USER || 'sitadmin';
const PASSWORD = process.env.DEPLOY_PASSWORD || 'P@ssw0rd';
const REMOTE_ROOT = '/var/www/clinic.sititsolutions.com';

const args = process.argv.slice(2);
const apiOnly = args.includes('--api-only');
const webOnly = args.includes('--web-only');
const runMigrations = args.includes('--migrate');

async function main() {
  console.log(`\nConnecting to ${USER}@${HOST}...`);
  await ssh.connect({ host: HOST, username: USER, password: PASSWORD });
  console.log('Connected.');

  const sudo = "echo '" + PASSWORD + "' | sudo -S ";

  // 1. Database migrations (if requested)
  if (runMigrations) {
    console.log('\n--- Running Database Migrations ---');
    const migRes = await ssh.execCommand(
      'DATABASE_URL_MIGRATOR="postgres://kpagarigan:P%40ssw0rd@127.0.0.1:5432/clinic" ' +
      'CLINIC_DATABASE_URL="postgres://kpagarigan:P%40ssw0rd@127.0.0.1:5432/clinic" ' +
      'node packages/db/scripts/migrate.mjs up',
      { cwd: REMOTE_ROOT }
    );
    console.log(migRes.stdout, migRes.stderr);
  }

  // 2. Build API
  if (!webOnly) {
    console.log('\n--- Building Backend API ---');
    const apiRes = await ssh.execCommand('pnpm --filter @clinic/api build', { cwd: REMOTE_ROOT });
    console.log(apiRes.stdout);
    if (apiRes.code !== 0) {
      console.error('API build failed:', apiRes.stderr);
      process.exit(1);
    }
  }

  // 3. Build Web
  if (!apiOnly) {
    console.log('\n--- Building Frontend Web ---');
    const webRes = await ssh.execCommand('pnpm --filter @clinic/web build', { cwd: REMOTE_ROOT });
    console.log(webRes.stdout);
    if (webRes.code !== 0) {
      console.error('Web build failed:', webRes.stderr);
      process.exit(1);
    }
  }

  // 4. Restart PM2 Process
  if (!webOnly) {
    console.log('\n--- Restarting PM2 clinic-api ---');
    const pm2Res = await ssh.execCommand('pm2 restart clinic-api --update-env');
    console.log(pm2Res.stdout);
  }

  // 5. Reload Nginx
  console.log('\n--- Reloading Nginx ---');
  const nginxRes = await ssh.execCommand(sudo + 'systemctl reload nginx');
  console.log(nginxRes.stdout);

  // 6. Smoke Verification
  console.log('\n--- Running Smoke Verification ---');
  const smoke = await ssh.execCommand('curl -s http://127.0.0.1:3085/api/v1/ping');
  console.log('API Smoke Ping:', smoke.stdout || smoke.stderr);

  console.log('\nDeployment finished successfully!\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nDeployment error:', err);
  process.exit(1);
});
