import { sveltekit } from '@sveltejs/kit/vite';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The server code reads process.env directly (so it is testable outside
// SvelteKit); load .env for `vite dev` and the tests.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/**/*.test.ts'],
		globalSetup: ['tests/globalSetup.ts'],
		env: { VITEST: 'true' },
		environment: 'node',
		fileParallelism: false,
		testTimeout: 20_000,
		hookTimeout: 30_000
	}
});
