import { db, now } from "./core";
import { ApiError } from "./security";

export async function panelNotifications(cursor: string | null) {
  if (cursor === null) {
    // The panel itself subscribes to future events; OS push permission is optional.
    await db().prepare("INSERT OR IGNORE INTO settings(id,value,updated_at) VALUES ('push_started_at',?,?)").bind(String(now()), now()).run();
    const latest = await db().prepare("SELECT COALESCE(MAX(rowid),0) AS cursor FROM push_events").first<{cursor:number}>();
    return { cursor: latest!.cursor, events: [] };
  }
  if (!/^\d{1,16}$/.test(cursor) || !Number.isSafeInteger(Number(cursor)))
    throw new ApiError(422, "invalid_cursor", "Posição de notificações inválida.");
  // rowid follows insertion order, including approvals of older orders. SQLite
  // seeks directly to the cursor, without scanning the history or adding polling.
  const rows = await db().prepare(`SELECT e.rowid AS sequence,e.id,e.event,e.created_at,e.external_source,
    CASE WHEN e.external_source='broski' THEN e.external_amount ELSE t.amount END AS amount,
    CASE WHEN e.external_source='broski' THEN 'EUR' ELSE 'BRL' END AS currency,
    CASE WHEN e.external_source='broski' THEN 'PAID' ELSE t.status END AS current_status
    FROM push_events e LEFT JOIN transactions t ON t.id=e.transaction_id
    WHERE e.rowid>? ORDER BY e.rowid LIMIT 50`).bind(Number(cursor)).all<any>();
  return {
    cursor: rows.results.at(-1)?.sequence ?? Number(cursor),
    events: rows.results.filter(row => row.created_at >= now()-120000 && row.amount > 0 &&
      ((row.event === "PAID" && row.current_status === "PAID") || (row.event === "PENDING" && row.current_status === "PENDING")))
      .map(({ sequence, id, event, created_at, amount, currency, external_source }) => ({ sequence, id, event, created_at, amount, currency, source: external_source || "brasil" })),
  };
}
