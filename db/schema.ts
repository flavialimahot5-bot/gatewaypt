import { sql } from "drizzle-orm";
import {
  sqliteTable,
  check,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const recoveryJobs = sqliteTable("recovery_jobs", {
  transactionId: text("transaction_id").primaryKey(),
  productId: text("product_id").notNull(),
  template: text("template").notNull(),
  configVersion: text("config_version").notNull(),
  status: text("status").notNull().default("WAITING"),
  reason: text("reason"),
  dueAt: integer("due_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  leaseUntil: integer("lease_until").notNull().default(0),
}, t => [index("recovery_due_idx").on(t.status, t.dueAt)]);
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  hash: text("hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  callback: text("callback"),
  webhookSecret: text("webhook_secret"),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    providerId: text("provider_id").unique(),
    gateway: text("gateway").notNull().default("pagpixhub"),
    gatewayConnection: text("gateway_connection"),
    gatewaySentAt: integer("gateway_sent_at"),
    plowfProfile: text("plowf_profile"),
    externalReference: text("external_reference").notNull(),
    amount: integer("amount").notNull(),
    fee: integer("fee").notNull().default(0),
    net: integer("net").notNull().default(0),
    status: text("status").notNull(),
    pixStatus: text("pix_status"),
    copyPaste: text("copy_paste"),
    pixGeneratedAt: integer("pix_generated_at"),
    pixReviewedAt: integer("pix_reviewed_at"),
    trackerorderCode: text("trackerorder_code"),
    expiresAt: text("expires_at"),
    checkoutHash: text("checkout_hash").notNull().unique(),
    checkoutToken: text("checkout_token").notNull(),
    description: text("description").notNull(),
    customer: text("customer").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    paidAt: integer("paid_at"),
    leaseUntil: integer("lease_until").notNull().default(0),
  },
  (t) => [
    uniqueIndex("idx_transactions_idempotency").on(t.keyId, t.idempotencyKey),
    index("idx_transactions_key_created").on(t.keyId, t.createdAt),
    index("idx_transactions_paid").on(t.paidAt),
    index("idx_transactions_order_lookup").on(t.idempotencyKey, t.keyId),
    index("idx_transactions_created").on(t.createdAt),
    index("idx_transactions_pending_updated").on(t.updatedAt).where(sql`${t.status} IN ('PENDING','CREATING')`),
  ],
);
export const deliveries = sqliteTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id").notNull(),
    transactionId: text("transaction_id").notNull(),
    payload: text("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAt: integer("next_at").notNull(),
    leaseUntil: integer("lease_until").notNull().default(0),
    deliveredAt: integer("delivered_at"),
    lastStatus: integer("last_status"),
  },
  (t) => [index("idx_deliveries_due").on(t.deliveredAt, t.nextAt)],
);
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  receivedAt: integer("received_at").notNull(),
});
export const gatewayEvents = sqliteTable("gateway_events", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  providerId: text("provider_id").notNull(),
  externalReference: text("external_reference").notNull(),
  receivedAt: integer("received_at").notNull(),
  processedAt: integer("processed_at"),
  nextAt: integer("next_at").notNull(),
  leaseUntil: integer("lease_until").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
}, t => [index("gateway_events_due_idx").on(t.processedAt, t.nextAt)]);
export const audit = sqliteTable(
  "audit",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_audit_created").on(t.createdAt)],
);
export const limits = sqliteTable(
  "rate_limits",
  {
    id: text("id").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_limits_expires").on(t.expiresAt)],
);

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    amount: integer("amount").notNull(),
    image: text("image").notNull(),
    shipping: integer("shipping").notNull().default(0),
    deliveryDays: text("delivery_days").notNull(),
      upsellUrl: text("upsell_url"),
      recoveryTemplate: text("recovery_template"),
      reviews: text("reviews").default("[]").notNull(),
      productType: text("product_type").notNull().default("physical"),
    active: integer("active").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("products_amount_min", sql`${t.amount} >= 500`),
    check("products_shipping_min", sql`${t.shipping} >= 0`),
  ],
);
export const productOrders = sqliteTable(
  "product_orders",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull(),
    requestHash: text("request_hash").notNull(),
    snapshot: text("snapshot").notNull(),
    buyer: text("buyer").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_product_orders_product").on(t.productId, t.createdAt), index("idx_product_orders_created").on(t.createdAt)],
);

export const trackingPixels = sqliteTable("tracking_pixels", {
  pixelId: text("pixel_id").notNull(),
  storeSlug: text("store_slug").notNull(),
  accessToken: text("access_token").notNull(),
  label: text("label").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
}, t => [primaryKey({columns: [t.storeSlug, t.pixelId]})]);
export const trackingContext = sqliteTable("tracking_context", {
  orderId: text("order_id").primaryKey(),
  context: text("context").notNull(),
  createdAt: integer("created_at").notNull(),
  checkedAt: integer("checked_at").notNull().default(0),
  completed: integer("completed").notNull().default(0),
}, t => [index("tracking_context_pending").on(t.completed, t.checkedAt), index("tracking_context_cleanup").on(t.completed, t.createdAt)]);
export const trackingEvents = sqliteTable("tracking_events", {
  id: text("id").primaryKey(),
  pixelId: text("pixel_id").notNull(),
  storeSlug: text("store_slug").notNull(),
  event: text("event").notNull(),
  payload: text("payload"),
  createdAt: integer("created_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAt: integer("next_at").notNull(),
  leaseUntil: integer("lease_until").notNull().default(0),
  deliveredAt: integer("delivered_at"),
  lastError: text("last_error"),
}, t => [index("tracking_events_pending").on(t.deliveredAt, t.nextAt, t.leaseUntil),
  index("tracking_events_expiry").on(t.createdAt).where(sql`${t.deliveredAt} IS NULL AND ${t.payload} IS NOT NULL`)]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  credentialVersion: text("credential_version").notNull(),
  subscription: text("subscription").notNull(),
  createdAt: integer("created_at").notNull(),
  revokedAt: integer("revoked_at"),
});
export const pushEvents = sqliteTable("push_events", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  event: text("event").notNull(),
  createdAt: integer("created_at").notNull(),
  fanoutAt: integer("fanout_at"),
  externalSource: text("external_source"),
  externalAmount: integer("external_amount"),
  externalCurrency: text("external_currency"),
  externalMethod: text("external_method"),
}, t => [index("push_events_unprepared").on(t.createdAt).where(sql`${t.fanoutAt} IS NULL`)]);
export const pushDeliveries = sqliteTable("push_deliveries", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  subscriptionId: text("subscription_id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAt: integer("next_at").notNull(),
  leaseUntil: integer("lease_until").notNull().default(0),
  sentAt: integer("sent_at"),
  lastStatus: integer("last_status"),
}, t => [index("push_deliveries_pending").on(t.sentAt, t.nextAt, t.leaseUntil)]);

export const checkoutSessions = sqliteTable("checkout_sessions", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  stage: integer("stage").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  lastSeen: integer("last_seen").notNull(),
  orderId: text("order_id"),
}, t => [index("checkout_sessions_created").on(t.createdAt), index("checkout_sessions_live").on(t.lastSeen)]);

export const trackerorderJobs = sqliteTable("trackerorder_jobs", {
  transactionId: text("transaction_id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  connectionId: text("connection_id").notNull(),
  state: text("state").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  nextAt: integer("next_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  trackingCode: text("tracking_code"),
  pendingCredits: integer("pending_credits").notNull().default(0),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
}, t => [index("trackerorder_jobs_due").on(t.state, t.nextAt), index("trackerorder_jobs_created").on(t.createdAt)]);

export const storeOrders = sqliteTable('store_orders', {
 id:text('id').primaryKey(),keyId:text('key_id').notNull(),sessionHash:text('session_hash').notNull(),attempt:text('attempt').notNull(),requestHash:text('request_hash').notNull(),snapshot:text('snapshot').notNull(),buyer:text('buyer').notNull(),chargeBody:text('charge_body').notNull(),amount:integer('amount').notNull(),transactionId:text('transaction_id').unique(),createdAt:integer('created_at').notNull(),paidAt:integer('paid_at'),
},t=>[uniqueIndex('store_orders_attempt').on(t.keyId,t.sessionHash,t.attempt),index('store_orders_pending').on(t.paidAt,t.createdAt)]);
export const storeWebhookEvents = sqliteTable('store_webhook_events', {
 keyId:text('key_id').notNull(),eventId:text('event_id').notNull(),payloadHash:text('payload_hash').notNull(),orderId:text('order_id').notNull(),receivedAt:integer('received_at').notNull(),
},t=>[primaryKey({columns:[t.keyId,t.eventId]})]);
export const storeEffects = sqliteTable('store_effects', {
 orderId:text('order_id').notNull(),kind:text('kind').notNull(),state:text('state').notNull().default('PENDING'),createdAt:integer('created_at').notNull(),startedAt:integer('started_at'),completedAt:integer('completed_at'),result:text('result'),
},t=>[primaryKey({columns:[t.orderId,t.kind]})]);

// Portugal-only durable payment state. Existing migrations remain immutable.
export const portugalOrders = sqliteTable('pt_orders', {
 id:text('id').primaryKey(),productId:text('product_id').notNull(),requestHash:text('request_hash').notNull(),payload:text('payload').notNull(),amount:integer('amount').notNull(),method:text('method').notNull(),status:text('status').notNull().default('creating'),providerId:text('provider_id').unique(),voucher:text('voucher'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),leaseUntil:integer('lease_until').notNull().default(0),retryAt:integer('retry_at').notNull().default(0),lastError:text('last_error'),emailSent:integer('email_sent').notNull().default(0),fallbackAt:integer('fallback_at').notNull().default(0),refunded:integer('refunded').notNull().default(0),retryCount:integer('retry_count').notNull().default(0),
});
export const portugalEvents=sqliteTable('pt_events',{id:text('id').primaryKey(),orderId:text('order_id').notNull(),receivedAt:integer('received_at').notNull()});
export const portugalRefunds=sqliteTable('pt_refunds',{id:text('id').primaryKey(),orderId:text('order_id').notNull(),requestHash:text('request_hash').notNull(),payload:text('payload').notNull(),response:text('response')});
