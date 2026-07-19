import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../config/database';

async function migrate(): Promise<void> {
  const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const seedSQL = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8');
  const client = await pool.connect();
  try {
    console.log('Running schema migration…');
    await client.query(schemaSQL);
    console.log('Running seed data…');
    await client.query(seedSQL);
    console.log('✓ Migration complete.');
  } catch (err) {
    console.error('✗ Migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
