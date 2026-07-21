import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';

// Single entry point for provisioning a brand-new database: schema, TimescaleDB
// hypertables + compression, then seed data. Run once against a fresh Postgres
// server. Safe to re-run — every step is idempotent.
async function setup(): Promise<void> {
  const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8');
  const client = await pool.connect();
  try {
    console.log('1/3 Running schema…');
    await client.query(read('schema.sql'));

    console.log('2/3 Setting up TimescaleDB hypertables + compression…');
    await client.query(read('timescale.sql'));

    console.log('3/3 Running seed data…');
    await client.query(read('seed.sql'));

    console.log('✓ Database setup complete.');
  } catch (err) {
    console.error('✗ Database setup failed:', (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
