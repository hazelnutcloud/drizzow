import type {
  ExtractTablesWithRelations,
  GetColumnData,
  InferInsertModel,
  InferSelectModel,
  Table,
  TableRelationalConfig,
  TablesRelationalConfig,
} from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

/**
 * Entity states for change tracking
 */
export enum EntityState {
  Unchanged = "unchanged",
  Modified = "modified",
  Added = "added",
  Deleted = "deleted",
}

/**
 * Represents a tracked entity with its state and values
 */
export interface TrackedEntity<T = any> {
  entity: T;
  state: EntityState;
  originalValues: Map<string, any>;
  tableName: string;
  primaryKey: any;
}

/**
 * Change set representing modifications to an entity
 */
export interface ChangeSet {
  entity: any;
  state: EntityState;
  changes: Map<string, { old: any; new: any }>;
  tableName: string;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  error: string | null;
}

/**
 * Checkpoint data structure
 */
export interface Checkpoint {
  id: number;
  timestamp: number;
  entityStates: Map<any, TrackedEntity>;
  identityMapSnapshot: Map<string, Map<any, any>>;
}

/**
 * Supported Drizzle database types
 */
export type AnyDrizzleDB<
  TSchema extends Record<string, any> = Record<string, any>,
> = BaseSQLiteDatabase<any, any, TSchema>;

export type ExtractSchema<TDatabase> =
  TDatabase extends AnyDrizzleDB<infer TSchema> ? TSchema : never;

export type FindParams<TTable extends TableRelationalConfig> = {
  [Col in keyof TTable["columns"] as TTable["columns"][Col]["_"]["isPrimaryKey"] extends true
    ? Col
    : never]:
    | GetColumnData<TTable["columns"][Col], "raw">
    | GetColumnData<TTable["columns"][Col], "raw">[];
};

export type FindReturnType<Params, TTable extends Table> = Params extends {
  [key: string]: any[];
}
  ? InferSelectModel<TTable>[]
  : InferSelectModel<TTable> | undefined;

export type UnitOfWorkRepos<
  TDatabase extends AnyDrizzleDB,
  TFullSchema extends Record<string, Table> = ExtractSchema<TDatabase>,
  TSchema extends
    TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>,
> = {} extends TSchema
  ? {}
  : {
      [K in keyof TSchema]: K extends keyof TFullSchema
        ? {
            find: <Params = FindParams<TSchema[K]>>(
              params: Params,
            ) => Promise<FindReturnType<Params, TFullSchema[K]>>;
            create: (
              v: InferInsertModel<TFullSchema[K]>,
            ) => InferSelectModel<TFullSchema[K]>;
            delete: (v: InferSelectModel<TFullSchema[K]>) => void;
          }
        : {};
    };

/**
 * Database adapter interface
 */
export interface DatabaseAdapter {
  beginTransaction(): Promise<any>;
  executeInsert(table: Table, values: any[]): Promise<void>;
  executeUpdate(
    table: Table,
    id: any,
    changes: Record<string, any>,
  ): Promise<void>;
  executeDelete(table: Table, id: any): Promise<void>;
  commitTransaction(tx: any): Promise<void>;
  rollbackTransaction(tx: any): Promise<void>;
  insertNewEntity(table: Table, data: any): Promise<any>;
}
