import { UnitOfWork } from "../uow";
import type { UnitOfWorkRepos, AnyDrizzleDB } from "../types";
import { NodePostgresAdapter } from "./adapter";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export { NodePostgresAdapter } from "./adapter";

export type CreateUowReturnType<TDatabase extends AnyDrizzleDB> =
  UnitOfWork<TDatabase> & UnitOfWorkRepos<TDatabase>;

/**
 * Create a Unit of Work instance for a Drizzle PostgreSQL database
 */
export function drizzow<TDatabase extends NodePgDatabase<Record<string, any>>>(
  db: TDatabase,
): CreateUowReturnType<TDatabase> {
  const adapter = new NodePostgresAdapter(db);
  // Create the UoW instance
  return new UnitOfWork(db, adapter) as never;
}
