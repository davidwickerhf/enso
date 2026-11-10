import pg from 'pg';
import { config } from './config';

// BIGINT columns (sizes, versions) fit comfortably in a JS number here.
pg.types.setTypeParser(20, (v) => Number(v));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
	pool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
	return pool;
}

export async function closePool() {
	await pool?.end();
	pool = undefined;
}

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
	return getPool().query<T>(text, values);
}

/** Runs fn inside a transaction on one connection. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await fn(client);
		await client.query('COMMIT');
		return result;
	} catch (err) {
		await client.query('ROLLBACK').catch(() => {});
		throw err;
	} finally {
		client.release();
	}
}
