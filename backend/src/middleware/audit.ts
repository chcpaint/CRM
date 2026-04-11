import { execute } from '../db';
import { AuthRequest } from '../types';

export function logAudit(
  req: AuthRequest,
  entityType: string,
  entityId: number | null,
  action: string,
  changes: object = {}
): void {
  try {
    execute(
      `INSERT INTO audit_log (user_id, entity_type, entity_id, action, changes, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user?.userId || null,
        entityType,
        entityId,
        action,
        JSON.stringify(changes),
        req.ip || req.socket.remoteAddress || 'unknown'
      ]
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}
