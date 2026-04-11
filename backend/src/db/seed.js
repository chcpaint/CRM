const { initDatabase, execute, queryOne } = require('./init');
const bcrypt = require('bcryptjs');

const seedData = require('./seed-data.json');

async function seed() {
  await initDatabase();
  console.log('Seeding database...');

  const adminHash = await bcrypt.hash('admin123', 12);
  const repHash = await bcrypt.hash('rep123', 12);

  let existingAdmin = await queryOne('SELECT id FROM users WHERE email = $1', ['adam@chcpaint.com']);
  if (!existingAdmin) {
    await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5)',
      ['adam@chcpaint.com', adminHash, 'Adam', 'Berube', 'admin']);
    console.log('Created admin: adam@chcpaint.com / admin123');
  }

  let existingMichelle = await queryOne('SELECT id FROM users WHERE email = $1', ['michelle@chcpaint.com']);
  let michelleId;
  if (!existingMichelle) {
    const { lastId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5)',
      ['michelle@chcpaint.com', repHash, 'Michelle', 'Rep', 'rep']);
    michelleId = lastId;
    console.log('Created rep: michelle@chcpaint.com / rep123');
  } else {
    michelleId = existingMichelle.id;
  }

  let existingBen = await queryOne('SELECT id FROM users WHERE email = $1', ['ben@chcpaint.com']);
  let benId;
  if (!existingBen) {
    const { lastId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, $2, $3, $4, $5)',
      ['ben@chcpaint.com', repHash, 'Ben', 'Halliday', 'rep']);
    benId = lastId;
    console.log('Created rep: ben@chcpaint.com / rep123');
  } else {
    benId = existingBen.id;
  }

  const accountCount = await queryOne('SELECT COUNT(*) as count FROM accounts');
  if (accountCount && parseInt(accountCount.count) > 0) {
    console.log(`Already have ${accountCount.count} accounts. Skipping import.`);
    console.log('Seed complete!');
    process.exit(0);
    return;
  }

  console.log('Importing seed data...');
  let totalImported = 0;

  // Michelle's Accounts
  const michelleRows = seedData['Michelles Accounts'] || [];
  for (const row of michelleRows) {
    const shopName = row['Shop Name'];
    if (!shopName) continue;
    const { lastId } = await execute(
      `INSERT INTO accounts (shop_name, city, assigned_rep_id, status, former_sherwin_client, tags) VALUES ($1, $2, $3, 'prospect', $4, '[]')`,
      [shopName, row['City/Area'] || null, michelleId, row['Former Sherwin Client? Y/N'] === 'Y']);
    if (row['Notes']) {
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)',
        [lastId, michelleId, `[Imported] ${row['Notes']}`]);
    }
    totalImported++;
  }
  console.log(`Michelle's Accounts: ${michelleRows.length} imported`);

  // Ben's Accounts
  const benRows = seedData['Bens Accounts'] || [];
  let benCount = 0;
  for (const row of benRows) {
    const shopName = row['Shop Name'];
    if (!shopName) continue;
    await execute(`INSERT INTO accounts (shop_name, city, assigned_rep_id, status, tags) VALUES ($1, $2, $3, 'prospect', '[]')`,
      [shopName, row['City/Area'] || null, benId]);
    totalImported++; benCount++;
  }
  console.log(`Ben's Accounts: ${benCount} imported`);

  // Joint Accounts
  const jointRows = seedData['Joint Accounts'] || [];
  let jointCount = 0;
  for (const row of jointRows) {
    const shopName = row['Shop Name'];
    if (!shopName) continue;
    await execute(
      `INSERT INTO accounts (shop_name, address, city, contact_names, suppliers, paint_line, sundries, has_contract, mpo, num_techs, sq_footage, status, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', '[]')`,
      [shopName, row['Address'] || null, row['City/Area'] || null, row['Contact(s)'] || null,
       row['Supplier(s)'] || null, row['Paint'] || null, row['Sundries'] || null,
       row['Contract? Y/N'] === 'Y', row['MPO'] || null,
       row['# of Techs'] ? parseInt(row['# of Techs']) : null, row['Shop Sq. Footage'] || null]);
    totalImported++; jointCount++;
  }
  console.log(`Joint Accounts: ${jointCount} imported`);

  // Cold accounts
  const coldRows = seedData['Cold'] || [];
  let coldCount = 0;
  for (const row of coldRows) {
    const shopName = row['Shop Name'];
    if (!shopName) continue;
    const { lastId } = await execute(
      `INSERT INTO accounts (shop_name, address, city, status, tags) VALUES ($1, $2, $3, 'cold', '[]')`,
      [shopName, row['Address'] || null, row['City'] || null]);
    if (row['Reason']) {
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)',
        [lastId, benId, `[Cold - Reason] ${row['Reason']}`]);
    }
    totalImported++; coldCount++;
  }
  console.log(`Cold Accounts: ${coldCount} imported`);

  // DNC Request
  const dncRows = seedData['DNC Request'] || [];
  let dncCount = 0;
  for (const row of dncRows) {
    const shopName = row['Shop Name'];
    if (!shopName) continue;
    const repPursuing = row['Rep Pursuing'] || '';
    const assignedId = repPursuing.toLowerCase().includes('michelle') ? michelleId : benId;
    const { lastId } = await execute(
      `INSERT INTO accounts (shop_name, city, assigned_rep_id, status, tags) VALUES ($1, $2, $3, 'dnc', '[]')`,
      [shopName, row['City/Area'] || null, assignedId]);
    if (row['Notes']) {
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)',
        [lastId, assignedId, `[DNC - Reason] ${row['Notes']}`]);
    }
    totalImported++; dncCount++;
  }
  console.log(`DNC Requests: ${dncCount} imported`);

  console.log(`\nTotal accounts imported: ${totalImported}`);
  console.log('Seed complete!');
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
