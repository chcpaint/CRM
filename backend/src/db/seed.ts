import { initDatabase, execute, queryOne } from './index';
import bcrypt from 'bcryptjs';
import XLSX from 'xlsx';
import path from 'path';

const SPREADSHEET_PATH = '/sessions/quirky-zen-rubin/mnt/uploads/Michelle Ben Current & Prospect Accounts - 2026.xlsx';

async function seed() {
  await initDatabase();
  console.log('Seeding database...');

  // Create default users
  const adminHash = await bcrypt.hash('admin123', 12);
  const repHash = await bcrypt.hash('rep123', 12);

  // Check if users exist
  const existingAdmin = queryOne('SELECT id FROM users WHERE email = ?', ['adam@chcpaint.com']);
  if (!existingAdmin) {
    execute(
      'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      ['adam@chcpaint.com', adminHash, 'Adam', 'Berube', 'admin']
    );
    console.log('Created admin user: adam@chcpaint.com');
  }

  const existingMichelle = queryOne('SELECT id FROM users WHERE email = ?', ['michelle@chcpaint.com']);
  let michelleId: number;
  if (!existingMichelle) {
    const { lastId } = execute(
      'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      ['michelle@chcpaint.com', repHash, 'Michelle', 'Rep', 'rep']
    );
    michelleId = lastId;
    console.log('Created rep user: michelle@chcpaint.com');
  } else {
    michelleId = (existingMichelle as any).id;
  }

  const existingBen = queryOne('SELECT id FROM users WHERE email = ?', ['ben@chcpaint.com']);
  let benId: number;
  if (!existingBen) {
    const { lastId } = execute(
      'INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)',
      ['ben@chcpaint.com', repHash, 'Ben', 'Halliday', 'rep']
    );
    benId = lastId;
    console.log('Created rep user: ben@chcpaint.com');
  } else {
    benId = (existingBen as any).id;
  }

  // Check if accounts already imported
  const accountCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM accounts');
  if (accountCount && accountCount.count > 0) {
    console.log(`Database already has ${accountCount.count} accounts. Skipping import.`);
    console.log('Seed complete!');
    return;
  }

  // Import spreadsheet
  console.log('Reading spreadsheet:', SPREADSHEET_PATH);
  const workbook = XLSX.readFile(SPREADSHEET_PATH);

  let totalImported = 0;

  // 1. Michelle's Accounts - columns: Shop Name, City/Area, Former Sherwin Client?, Notes
  const michelleSheet = workbook.Sheets['Michelles Accounts'];
  if (michelleSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(michelleSheet, { defval: null });
    for (const row of rows) {
      const shopName = row['Shop Name'];
      if (!shopName || shopName === 'Shop Name') continue;

      const notes = row['Notes'] || null;
      const formerSherwin = row['Former Sherwin Client? Y/N'];

      execute(
        `INSERT INTO accounts (shop_name, city, assigned_rep_id, status, former_sherwin_client, tags)
         VALUES (?, ?, ?, 'prospect', ?, '[]')`,
        [shopName, row['City/Area'] || null, michelleId, formerSherwin === 'Y' ? 1 : 0]
      );

      if (notes) {
        const accountId = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
        if (accountId) {
          execute(
            'INSERT INTO notes (account_id, created_by_id, content) VALUES (?, ?, ?)',
            [accountId.id, michelleId, `[Imported] ${notes}`]
          );
        }
      }
      totalImported++;
    }
    console.log(`Imported Michelle's Accounts: ${rows.length} rows`);
  }

  // 2. Ben's Accounts - columns: Shop Name, City/Area
  const benSheet = workbook.Sheets['Bens Accounts'];
  if (benSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(benSheet, { defval: null });
    for (const row of rows) {
      const shopName = row['Shop Name'];
      if (!shopName || shopName === 'Shop Name') continue;

      execute(
        `INSERT INTO accounts (shop_name, city, assigned_rep_id, status, tags) VALUES (?, ?, ?, 'prospect', '[]')`,
        [shopName, row['City/Area'] || null, benId]
      );
      totalImported++;
    }
    console.log(`Imported Ben's Accounts: ${rows.length} rows`);
  }

  // 3. Joint Accounts - richer data
  const jointSheet = workbook.Sheets['Joint Accounts'];
  if (jointSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(jointSheet, { defval: null });
    for (const row of rows) {
      const shopName = row['Shop Name'];
      if (!shopName || shopName === 'Shop Name') continue;

      execute(
        `INSERT INTO accounts (shop_name, address, city, contact_names, suppliers, paint_line, sundries,
          has_contract, mpo, num_techs, sq_footage, status, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', '[]')`,
        [
          shopName, row['Address'] || null, row['City/Area'] || null,
          row['Contact(s)'] || null, row['Supplier(s)'] || null,
          row['Paint'] || null, row['Sundries'] || null,
          row['Contract? Y/N'] === 'Y' ? 1 : 0,
          row['MPO'] || null,
          row['# of Techs'] || null,
          row['Shop Sq. Footage'] || null
        ]
      );
      totalImported++;
    }
    console.log(`Imported Joint Accounts: ${rows.length} rows`);
  }

  // 4. Cold accounts
  const coldSheet = workbook.Sheets['Cold'];
  if (coldSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(coldSheet, { defval: null });
    for (const row of rows) {
      const shopName = row['Shop Name'];
      if (!shopName || shopName === 'Shop Name') continue;

      const { lastId } = execute(
        `INSERT INTO accounts (shop_name, address, city, status, tags) VALUES (?, ?, ?, 'cold', '[]')`,
        [shopName, row['Address'] || null, row['City'] || null]
      );

      // Add reason as a note
      if (row['Reason']) {
        execute(
          'INSERT INTO notes (account_id, created_by_id, content) VALUES (?, ?, ?)',
          [lastId, benId, `[Cold - Reason] ${row['Reason']}`]
        );
      }
      totalImported++;
    }
    console.log(`Imported Cold Accounts: ${rows.length} rows`);
  }

  // 5. DNC Request
  const dncSheet = workbook.Sheets['DNC Request'];
  if (dncSheet) {
    const rows: any[] = XLSX.utils.sheet_to_json(dncSheet, { defval: null });
    for (const row of rows) {
      const shopName = row['Shop Name'];
      if (!shopName || shopName === 'Shop Name') continue;

      const repPursuing = row['Rep Pursuing'] || '';
      const assignedId = repPursuing.toLowerCase().includes('michelle') ? michelleId : benId;

      const { lastId } = execute(
        `INSERT INTO accounts (shop_name, city, assigned_rep_id, status, tags) VALUES (?, ?, ?, 'dnc', '[]')`,
        [shopName, row['City/Area'] || null, assignedId]
      );

      if (row['Notes']) {
        execute(
          'INSERT INTO notes (account_id, created_by_id, content) VALUES (?, ?, ?)',
          [lastId, assignedId, `[DNC - Reason] ${row['Notes']}`]
        );
      }
      totalImported++;
    }
    console.log(`Imported DNC Requests: ${rows.length} rows`);
  }

  console.log(`\nTotal accounts imported: ${totalImported}`);
  console.log('Seed complete!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
