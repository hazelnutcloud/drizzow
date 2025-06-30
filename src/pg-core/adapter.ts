import { BaseDatabaseAdapter } from "../base-adapter";
import { NodePgDatabase } from "drizzle-orm/node-postgres";

export abstract class PostgresAdapter extends BaseDatabaseAdapter {
  constructor(db: NodePgDatabase<any>) {
    super(db);
  }

  override getDatabaseType(): "sqlite" | "postgres" | "mysql" {
    return "postgres";
  }
}