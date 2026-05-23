import { createClient, type Config } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import * as schema from "./schema.js";

export type LucidmemoDatabase = LibSQLDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  url: Config["url"];
  authToken?: Config["authToken"];
}

export function createDatabase(options: CreateDatabaseOptions): LucidmemoDatabase {
  const client = createClient(options);
  return drizzle(client, { schema });
}
