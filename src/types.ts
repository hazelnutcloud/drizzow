import type {
  ExtractTablesWithRelations,
  Table,
  TablesRelationalConfig,
} from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { RelationalQueryBuilder as SqliteRelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";

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
  TSchema extends Record<string, unknown> = Record<string, unknown>
> = BaseSQLiteDatabase<any, any, TSchema>;

export type ExtractSchema<TDatabase> = TDatabase extends AnyDrizzleDB<
  infer TSchema
>
  ? TSchema
  : never;

export type GenericRelationalQueryBuilder<
  TDatabase extends AnyDrizzleDB,
  TFullSchema extends Record<string, unknown> = ExtractSchema<TDatabase>,
  TSchema extends TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>
> = {} extends TSchema
  ? {}
  : TDatabase extends BaseSQLiteDatabase<infer mode, any, TFullSchema>
  ? {
      [K in keyof TSchema]: SqliteRelationalQueryBuilder<
        mode,
        TFullSchema,
        TSchema,
        TSchema[K]
      >;
    }
  : never;

/**
 * Database adapter interface
 */
export interface DatabaseAdapter {
  beginTransaction(): Promise<any>;
  executeInsert(table: Table, values: any[]): Promise<void>;
  executeUpdate(
    table: Table,
    id: any,
    changes: Record<string, any>
  ): Promise<void>;
  executeDelete(table: Table, id: any): Promise<void>;
  commitTransaction(tx: any): Promise<void>;
  rollbackTransaction(tx: any): Promise<void>;
}
