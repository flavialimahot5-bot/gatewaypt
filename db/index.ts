import { drizzle } from "drizzle-orm/libsql";
import { getClient } from "@/lib/server/database";
import * as schema from "./schema";
export function getDb() {
  return drizzle(getClient(), { schema });
}
