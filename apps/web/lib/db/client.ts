import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

const POSTGRES_URL = process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_teW7v1OYhQCM@ep-wild-dust-ajxafc43.c-3.us-east-2.aws.neon.tech/neondb?sslmode=require";

let _db: DrizzleClient | null = null;

export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    if (!_db) {
      const client = postgres(POSTGRES_URL);
      _db = drizzle(client, { schema });
    }
    return Reflect.get(_db, prop);
  },
});
