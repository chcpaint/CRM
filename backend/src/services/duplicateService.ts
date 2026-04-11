import { queryAll, execute } from '../db';
import { Account } from '../types';

// Levenshtein distance for fuzzy matching
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  for (let i = 0; i <= bLen; i++) matrix[i] = [i];
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bLen][aLen];
}

export function similarityScore(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return 1.0;

  const maxLen = Math.max(aLower.length, bLower.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshtein(aLower, bLower);
  return 1 - distance / maxLen;
}

export interface DuplicateMatch {
  existingAccount: Account;
  score: number;
  matchedOn: string;
}

export function findDuplicates(
  shopName: string,
  city?: string | null,
  threshold: number = 0.85,
  excludeId?: number
): DuplicateMatch[] {
  const allAccounts = queryAll<Account>(
    'SELECT * FROM accounts WHERE deleted_at IS NULL' +
    (excludeId ? ' AND id != ?' : ''),
    excludeId ? [excludeId] : []
  );

  const matches: DuplicateMatch[] = [];

  for (const account of allAccounts) {
    const nameScore = similarityScore(shopName, account.shop_name);

    // Boost score if city also matches
    let cityBonus = 0;
    if (city && account.city) {
      const cityScore = similarityScore(city, account.city);
      if (cityScore > 0.8) cityBonus = 0.05;
    }

    const totalScore = Math.min(nameScore + cityBonus, 1.0);

    if (totalScore >= threshold) {
      matches.push({
        existingAccount: account,
        score: totalScore,
        matchedOn: `Shop name similarity: ${(nameScore * 100).toFixed(0)}%` +
          (cityBonus > 0 ? ` + city match` : '')
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export function flagDuplicate(accountId1: number, accountId2: number, score: number): void {
  // Check if already flagged
  const existing = queryAll(
    `SELECT id FROM duplicate_flags
     WHERE ((account_1_id = ? AND account_2_id = ?) OR (account_1_id = ? AND account_2_id = ?))
     AND status = 'pending'`,
    [accountId1, accountId2, accountId2, accountId1]
  );

  if (existing.length === 0) {
    execute(
      `INSERT INTO duplicate_flags (account_1_id, account_2_id, similarity_score) VALUES (?, ?, ?)`,
      [accountId1, accountId2, score]
    );
  }
}
