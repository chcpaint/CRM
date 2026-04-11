const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let pool = null;

async function initDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required. Set it to your Supabase PostgreSQL connection string.');
  }

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Test connection
  const client = await pool.connect();
  try {
    await client.query('SELECT NOW()');
    console.log('Connected to Supabase PostgreSQL');

    // Run schema (CREATE IF NOT EXISTS is safe to re-run)
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    await client.query(schema);
    console.log('Database schema initialized');
  } finally {
    client.release();
  }

  return pool;
}

async function queryAll(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function queryOne(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function execute(sql, params = []) {
  // If the SQL is an INSERT, append RETURNING id to get the inserted ID
  let finalSql = sql;
  const isInsert = sql.trim().toUpperCase().startsWith('INSERT');
  if (isInsert && !sql.toUpperCase().includes('RETURNING')) {
    finalSql = sql + ' RETURNING id';
  }

  const result = await pool.query(finalSql, params);
  return {
    changes: result.rowCount || 0,
    lastId: (result.rows && result.rows[0]) ? result.rows[0].id : 0,
  };
}

function getPool() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

module.exports = { initDatabase, getPool, queryAll, queryOne, execute };
