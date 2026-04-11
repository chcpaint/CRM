// ─── Google Drive Auto-Import for AccountEdge Sales CSVs ───
// Checks a shared Google Drive folder, downloads new CSVs, parses them,
// imports into sales_data, and moves processed files to a "Processed" subfolder.

const { google } = require('googleapis');

// ─── AccountEdge CSV Parser (server-side port) ───
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr;
}

function parseAccountEdgeCSV(text) {
  const lines = text.split('\n');
  const records = [];
  let currentCustomer = '';
  let customerLines = [];
  let headerPassed = false;
  let reportPeriod = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (!headerPassed && line.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i)) {
      reportPeriod = line.trim();
    }

    if (line.includes(',ID#,Date,Quantity,Item/Activity,Amount,')) {
      headerPassed = true;
      continue;
    }
    if (!headerPassed) continue;

    if (line.includes('Grand Total:')) continue;

    if (line.includes(' Total:,')) {
      if (currentCustomer && customerLines.length > 0) {
        customerLines = [];
      }
      continue;
    }

    if (!line.startsWith(',') && !line.startsWith('"') && !line.match(/^\d/)) {
      const parts = line.split(',');
      if (parts.length <= 3 && !line.includes('$')) {
        currentCustomer = line.trim();
        customerLines = [];
        continue;
      }
    }

    if (line.startsWith(',') && currentCustomer) {
      const rawLine = line.substring(1);
      const parts = parseCSVLine(rawLine);

      if (parts.length >= 6) {
        const date = parts[1]?.trim() || '';
        const quantity = parseInt(parts[2]?.trim() || '0');
        const item = parts[3]?.trim() || '';
        const amountStr = (parts[4] || '').replace(/[\$",()]/g, '').trim();
        const amount = parseFloat(amountStr) || 0;
        const cogsStr = (parts[5] || '').replace(/[\$",()]/g, '').trim();
        const cogs = parseFloat(cogsStr) || 0;
        const profitStr = (parts[6] || '').replace(/[\$",()]/g, '').trim();
        const profit = parseFloat(profitStr) || 0;
        const category = parts[8]?.trim() || '';
        const productLine = parts[9]?.trim() || '';
        const salesperson = parts[10]?.trim() || '';

        if (date && date.match(/\d+\/\d+\/\d+/) && amount !== 0) {
          const record = {
            customer_name: currentCustomer,
            date: formatDate(date),
            amount,
            item_name: item,
            quantity,
            cogs,
            profit,
            category,
            product_line: productLine,
            salesperson,
          };
          records.push(record);
          customerLines.push(record);
        }
      }
    }
  }

  return { records, reportPeriod };
}

// ─── Google Drive Service ───
function getAuth() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentials) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON environment variable not set');

  const parsed = JSON.parse(credentials);
  return new google.auth.GoogleAuth({
    credentials: parsed,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

function getDrive() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth });
}

// Get or create the "Processed" subfolder inside the import folder
async function getOrCreateProcessedFolder(drive, parentFolderId) {
  // Check if "Processed" subfolder exists
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and name = 'Processed' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  // Create "Processed" subfolder
  const folder = await drive.files.create({
    requestBody: {
      name: 'Processed',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  return folder.data.id;
}

// List CSV files in the import folder (excluding Processed subfolder)
async function listCSVFiles(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (mimeType = 'text/csv' or name contains '.csv') and trashed = false`,
    fields: 'files(id, name, createdTime, modifiedTime, size)',
    orderBy: 'createdTime',
    spaces: 'drive',
  });
  return res.data.files || [];
}

// Download file content as text
async function downloadFile(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'text' }
  );
  return res.data;
}

// Move a file to the Processed folder
async function moveToProcessed(drive, fileId, processedFolderId) {
  // Get current parents
  const file = await drive.files.get({
    fileId,
    fields: 'parents',
  });

  const previousParents = file.data.parents.join(',');

  await drive.files.update({
    fileId,
    addParents: processedFolderId,
    removeParents: previousParents,
    fields: 'id, parents',
  });
}

// ─── Main import function ───
async function runGDriveImport(queryAll, queryOne, execute) {
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!folderId) {
    console.log('[GDrive Import] GDRIVE_FOLDER_ID not set, skipping.');
    return { success: false, error: 'GDRIVE_FOLDER_ID not configured' };
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('[GDrive Import] GOOGLE_SERVICE_ACCOUNT_JSON not set, skipping.');
    return { success: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured' };
  }

  const startTime = Date.now();
  console.log(`[GDrive Import] Starting auto-import from folder ${folderId}...`);

  try {
    const drive = getDrive();
    const files = await listCSVFiles(drive, folderId);

    if (files.length === 0) {
      console.log('[GDrive Import] No CSV files found in folder.');
      await logImportRun(execute, 'success', 0, 0, 0, [], 'No CSV files found');
      return { success: true, filesProcessed: 0, totalImported: 0 };
    }

    console.log(`[GDrive Import] Found ${files.length} CSV file(s) to process.`);
    const processedFolderId = await getOrCreateProcessedFolder(drive, folderId);

    // Load all accounts for matching
    const allAccounts = await queryAll('SELECT id, shop_name FROM accounts WHERE deleted_at IS NULL');

    let totalImported = 0;
    let totalUnmatched = 0;
    const fileResults = [];

    for (const file of files) {
      console.log(`[GDrive Import] Processing: ${file.name}`);
      try {
        const csvText = await downloadFile(drive, file.id);
        const { records, reportPeriod } = parseAccountEdgeCSV(csvText);

        if (records.length === 0) {
          console.log(`[GDrive Import] No valid records in ${file.name}, moving anyway.`);
          fileResults.push({ file: file.name, imported: 0, unmatched: 0, note: 'No valid records' });
          await moveToProcessed(drive, file.id, processedFolderId);
          continue;
        }

        let imported = 0;
        const unmatched = [];

        for (const r of records) {
          const name = r.customer_name || '';
          const amt = r.amount || 0;
          const date = r.date || '';
          if (!name || !amt || !date) continue;

          // Fuzzy match to existing accounts
          let matchId = null;
          let bestScore = 0;
          for (const a of allAccounts) {
            const s = similarity(name, a.shop_name);
            if (s > bestScore && s >= 0.80) {
              bestScore = s;
              matchId = a.id;
            }
          }

          const month = date.substring(0, 7);
          await execute(
            'INSERT INTO sales_data (account_id, rep_id, sale_amount, sale_date, month, memo, customer_name, imported_from_accountedge, item_name, quantity, cogs, profit, category, product_line, salesperson) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
            [matchId, null, amt, date, month, `Auto-imported from ${file.name}`, name, true, r.item_name || '', r.quantity || 0, r.cogs || 0, r.profit || 0, r.category || '', r.product_line || '', r.salesperson || '']
          );

          if (!matchId) unmatched.push({ customer_name: name, amount: amt, date });
          imported++;
        }

        totalImported += imported;
        totalUnmatched += unmatched.length;
        fileResults.push({ file: file.name, imported, unmatched: unmatched.length, reportPeriod });

        // Move to Processed folder
        await moveToProcessed(drive, file.id, processedFolderId);
        console.log(`[GDrive Import] ${file.name}: ${imported} records imported, ${unmatched.length} unmatched. Moved to Processed.`);

      } catch (fileErr) {
        console.error(`[GDrive Import] Error processing ${file.name}:`, fileErr.message);
        fileResults.push({ file: file.name, imported: 0, error: fileErr.message });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[GDrive Import] Complete: ${files.length} files, ${totalImported} records imported in ${duration}ms`);

    await logImportRun(execute, 'success', files.length, totalImported, totalUnmatched, fileResults);

    return {
      success: true,
      filesProcessed: files.length,
      totalImported,
      totalUnmatched,
      fileResults,
      duration,
    };

  } catch (err) {
    console.error('[GDrive Import] Fatal error:', err.message);
    await logImportRun(execute, 'error', 0, 0, 0, [], err.message);
    return { success: false, error: err.message };
  }
}

// ─── Similarity function (matches server.js logic) ───
function similarity(a, b) {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1;

  // Levenshtein distance
  const m = [];
  for (let i = 0; i <= al.length; i++) {
    m[i] = [i];
    for (let j = 1; j <= bl.length; j++) {
      m[i][j] = i === 0
        ? j
        : Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (al[i - 1] === bl[j - 1] ? 0 : 1));
    }
  }
  const maxLen = Math.max(al.length, bl.length);
  return maxLen === 0 ? 1 : 1 - m[al.length][bl.length] / maxLen;
}

// ─── Import run logging ───
async function logImportRun(execute, status, filesProcessed, recordsImported, unmatchedCount, details, errorMessage = null) {
  try {
    await execute(
      `INSERT INTO gdrive_import_log (status, files_processed, records_imported, unmatched_count, details, error_message) VALUES ($1, $2, $3, $4, $5, $6)`,
      [status, filesProcessed, recordsImported, unmatchedCount, JSON.stringify(details), errorMessage]
    );
  } catch (e) {
    console.error('[GDrive Import] Failed to log import run:', e.message);
  }
}

module.exports = { runGDriveImport, parseAccountEdgeCSV };
