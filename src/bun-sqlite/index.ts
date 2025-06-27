import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { UnitOfWork } from "../uow";
import type { GenericRelationalQueryBuilder } from "../types";
import { SQLiteAdapter } from "./sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { users } from "../schema";

export type CreateUowReturnType<
  TDatabase extends BaseSQLiteDatabase<any, any, any>
> = UnitOfWork<TDatabase> & GenericRelationalQueryBuilder<TDatabase>;

/**
 * Create a Unit of Work instance for a Drizzle database
 */
export function createUow<TDatabase extends BaseSQLiteDatabase<any, any, any>>(
  db: TDatabase
): CreateUowReturnType<TDatabase> {
  const adapter = new SQLiteAdapter(db);
  // Create the UoW instance
  return new UnitOfWork(db, adapter) as never;
}

const db = drizzle({ schema: { users } });

const uw = createUow(db)