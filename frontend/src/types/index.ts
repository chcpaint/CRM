export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: 'rep' | 'manager' | 'admin';
}

export interface PhoneEntry {
  number: string;
  label: string;
  is_primary: boolean;
}

export interface EmailEntry {
  address: string;
  type: 'Painter' | 'Admin' | 'Manager' | 'Owner' | '';
  is_primary: boolean;
}

export interface Account {
  id: number;
  shop_name: string;
  address: string | null;
  city: string | null;
  area: string | null;
  province: string | null;
  postal_code: string | null;
  contact_names: string | null;
  phone: string | null;
  phone2: string | null;
  phone_numbers: string | PhoneEntry[] | null;
  email: string | null;
  email_addresses: string | EmailEntry[] | null;
  account_type: string;
  account_category: 'lead' | 'customer';
  branch: string | null;
  assigned_rep_id: number | null;
  secondary_rep_id: number | null;
  rep_first_name?: string;
  rep_last_name?: string;
  secondary_rep_first_name?: string;
  secondary_rep_last_name?: string;
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
  // Shop detail fields
  num_painters: number | null;
  num_body_men: number | null;
  num_paint_booths: number | null;
  cup_brand: string | null;
  paper_brand: string | null;
  filler_brand: string | null;
  contract_status: string | null;
  deal_details: string | null;
  banner: string | null;
  business_types: string[] | string | null;
  business_type_notes: string | null;
  contract_file_path: string | null;
  contract_expiration_date: string | null;
  pcr_managed: boolean;
  pcr_shop_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: number;
  account_id: number;
  created_by_id: number;
  first_name: string;
  last_name: string;
  content: string;
  is_voice_transcribed: number;
  created_at: string;
  updated_at?: string;
}

export interface Activity {
  id: number;
  account_id: number;
  rep_id: number;
  first_name: string;
  last_name: string;
  activity_type: string;
  description: string | null;
  shop_name?: string;
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
  shop_name?: string;
  rep_first_name?: string;
  rep_last_name?: string;
  item_name?: string;
  quantity?: number;
  cogs?: number;
  profit?: number;
  category?: string;
  product_line?: string;
  salesperson?: string;
}

export interface DashboardMetrics {
  statusCounts: { status: string; count: number }[];
  monthlyRevenue: { month: string; total: number; count: number }[];
  topAccounts: { shop_name: string; salesperson?: string; city?: string; total_revenue: number; sale_count: number }[];
  recentActivities: (Activity & { entry_type?: 'activity' | 'note' })[];
  dormantCount: number;
  totalAccounts: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

export type StatusType = 'prospect' | 'active' | 'cold' | 'dnc' | 'churned';

export const STATUS_LABELS: Record<StatusType, string> = {
  prospect: 'Prospect',
  active: 'Active Customer',
  cold: 'Cold',
  dnc: 'Do Not Contact',
  churned: 'Churned'
};

export const STATUS_COLORS: Record<StatusType, string> = {
  prospect: 'badge-prospect',
  active: 'badge-active',
  cold: 'badge-cold',
  dnc: 'badge-dnc',
  churned: 'badge-churned'
};
