import { BaseDatabaseAdapter } from "../base-adapter";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

export abstract class SqliteAdapter extends BaseDatabaseAdapter {
  constructor(db: BaseSQLiteDatabase<any, any, any, any>) {
    super(db);
  }

  override getDatabaseType(): "sqlite" | "postgres" | "mysql" {
    return "sqlite";
  }
}
