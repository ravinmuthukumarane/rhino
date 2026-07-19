const { Pool } = require('pg');

const pool = new Pool({
  host: '172.235.8.137',
  port: 5432,
  database: 'rhino',
  user: 'rhinoadminuser',
  password: 'rhinosecpass951',
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const result = await pool.query('DELETE FROM users');
    console.log(`✓ Deleted ${result.rowCount} users`);
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
