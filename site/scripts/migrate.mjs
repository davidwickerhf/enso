#!/usr/bin/env node
// Applies migrations/NNN_*.sql in order, once each, recording a SHA-256 of
// every applied file. Refuses to run if an applied file was edited (the
// study.wicker.life lesson in wicker-infra docs/gotchas.md). Uses
// DATABASE_URL_ADMIN when set (owner role), else DATABASE_URL.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (existsSync('.env') && !process.env.DATABASE_URL) process.loadEnvFile('.env');
const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!url) {
	console.error('migrate: DATABASE_URL is not set');
	process.exit(1);
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
	// One migrator at a time, even if two containers start together.
	await client.query('SELECT pg_advisory_lock(727431)');
	await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
		name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
	const applied = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
	for (const file of files) {
		const sql = readFileSync(path.join(dir, file), 'utf8');
		const checksum = createHash('sha256').update(sql).digest('hex');
		if (applied.has(file)) {
			if (applied.get(file) !== checksum) throw new Error(`migration ${file} was edited after it was applied`);
			continue;
		}
		console.log(`migrate: applying ${file}`);
		await client.query('BEGIN');
		try {
			await client.query(sql);
			await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
			await client.query('COMMIT');
		} catch (err) {
			await client.query('ROLLBACK');
			throw err;
		}
	}
	console.log(`migrate: up to date (${files.length} migrations)`);
} finally {
	await client.end();
}
