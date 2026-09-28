/**
 * Common integration interfaces. Each provider implements the slice it can.
 * Business logic never imports a provider directly — it goes through
 * getIntegration(), which resolves credentials and returns typed adapters.
 */

export interface SmsAdapter {
  send(msg: { to: string; body: string }): Promise<{ id: string }>;
}

export interface EmailAdapter {
  send(msg: { to: string; subject: string; body: string; html?: string }): Promise<{ id: string }>;
}

export interface CalendarAdapter {
  freeBusy(range: { from: string; to: string }): Promise<Array<{ start: string; end: string }>>;
  createEvent(ev: { title: string; startAt: string; endAt: string; description?: string; attendees?: string[] }): Promise<{ id: string; htmlLink?: string }>;
}

export interface QboCustomer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: Record<string, unknown>;
}
export interface QboItem {
  id: string;
  name: string;
  description?: string;
  unitPriceCents?: number;
  type: string;
}

export interface AccountingAdapter {
  listCustomers(): Promise<QboCustomer[]>;
  listItems(): Promise<QboItem[]>;
  createCustomer(c: { name: string; phone?: string | null; email?: string | null }): Promise<{ id: string }>;
  createEstimate(est: { id: string; result: { lines: Array<{ name: string; quantity: number; unitPriceCents: number; subtotalCents: number }>; totalCents: number; taxCents: number }; jobs: unknown; quickbooks_customer_id?: string }): Promise<{ id: string }>;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  [k: string]: unknown;
}
