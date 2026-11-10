/**
 * Creates (if needed) and migrates a separate test database, so the tests
 * never touch the development data. TEST_DATABASE_URL wins; otherwise the
 * database name from DATABASE_URL gets a `_test` suffix.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

export function testDatabaseUrl() {
	if (existsSync('.env')) process.loadEnvFile('.env');
	if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
	const base = process.env.DATABASE_URL;
	if (!base) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL to run the tests');
	const url = new URL(base);
	url.pathname = `/${url.pathname.slice(1)}_test`;
	return url.toString();
}

export default async function setup() {
	const url = testDatabaseUrl();
	const target = new URL(url);
	const name = target.pathname.slice(1);
	const admin = new URL(url);
	admin.pathname = '/postgres';
	const client = new pg.Client({ connectionString: admin.toString() });
	try {
		await client.connect();
		const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
		if (!rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
	} catch (err) {
		// No rights to CREATE DATABASE (e.g. CI service DB): assume it exists.
		console.warn('test setup: could not ensure database exists:', err instanceof Error ? err.message : err);
	} finally {
		await client.end().catch(() => {});
	}
	execFileSync('node', ['scripts/migrate.mjs'], {
		env: { ...process.env, DATABASE_URL: url, DATABASE_URL_ADMIN: '' },
		stdio: 'inherit'
	});
}
