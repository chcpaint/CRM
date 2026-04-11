export interface User {
  id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: 'rep' | 'manager' | 'admin';
  is_active: number;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: number;
  shop_name: string;
  address: string | null;
  city: string | null;
  area: string | null;
  province: string | null;
  contact_names: string | null;
  phone: string | null;
  email: string | null;
  account_type: string;
  assigned_rep_id: number | null;
  status: 'prospect' | 'active' | 'cold' | 'dnc' | 'churned';
  suppliers: string | null;
  paint_line: string | null;
  allied_products: string | null;
  sundries: string | null;
  has_contract: number;
  mpo: string | null;
  num_techs: number | null;
  sq_footage: string | null;
  annual_revenue: number | null;
  former_sherwin_client: number;
  follow_up_date: string | null;
  last_contacted_at: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Note {
  id: number;
  account_id: number;
  created_by_id: number;
  content: string;
  is_voice_transcribed: number;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  account_id: number;
  rep_id: number;
  activity_type: 'call' | 'email' | 'meeting' | 'visit' | 'other';
  description: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  created_at: string;
}

export interface SalesData {
  id: number;
  account_id: number | null;
  rep_id: number | null;
  sale_amount: number;
  sale_date: string;
  month: string;
  memo: string | null;
  customer_name: string | null;
  imported_from_accountedge: number;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  entity_type: string;
  entity_id: number | null;
  action: string;
  changes: string;
  ip_address: string | null;
  created_at: string;
}

// JWT payload
export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
}

// Request with user
import { Request } from 'express';
export interface AuthRequest extends Request {
  user?: JWTPayload;
}
