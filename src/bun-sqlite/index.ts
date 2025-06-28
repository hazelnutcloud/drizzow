import {
  type BaseSQLiteDatabase,
} from "drizzle-orm/sqlite-core";
import { UnitOfWork } from "../uow";
import type { UnitOfWorkRepos } from "../types";
import { BunSQLiteAdapter } from "./adapter";

export type CreateUowReturnType<
  TDatabase extends BaseSQLiteDatabase<any, any, any>
> = UnitOfWork<TDatabase> & UnitOfWorkRepos<TDatabase>;

/**
 * Create a Unit of Work instance for a Drizzle database
 */
export function createUow<TDatabase extends BaseSQLiteDatabase<any, any, any>>(
  db: TDatabase
): CreateUowReturnType<TDatabase> {
  const adapter = new BunSQLiteAdapter(db);
  // Create the UoW instance
  return new UnitOfWork(db, adapter) as never;
}