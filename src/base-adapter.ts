import type { Table, TableConfig } from "drizzle-orm";
import type { DatabaseAdapter, ChangeSet, EntityState } from "./types";
import { EntityState as EntityStateEnum } from "./types";
import { getTableConfig } from "drizzle-orm/sqlite-core";

/**
 * Base database adapter with common functionality
 */
export abstract class BaseDatabaseAdapter implements DatabaseAdapter {
  protected db: any;

  constructor(db: any) {
    this.db = db;
  }

  abstract beginTransaction(): Promise<any>;
  abstract executeInsert(table: Table, values: any[]): Promise<void>;
  abstract executeUpdate(
    table: Table,
    id: any,
    changes: Record<string, any>
  ): Promise<void>;
  abstract executeDelete(table: Table, id: any): Promise<void>;
  abstract commitTransaction(tx: any): Promise<void>;
  abstract rollbackTransaction(tx: any): Promise<void>;

  /**
   * Execute all changes in a transaction
   */
  async executeChangeSets(changeSets: ChangeSet[]): Promise<void> {
    if (changeSets.length === 0) {
      return;
    }

    const tx = await this.beginTransaction();

    try {
      // Group changes by type for optimal execution order
      const inserts = changeSets.filter(
        (cs) => cs.state === EntityStateEnum.Added
      );
      const updates = changeSets.filter(
        (cs) => cs.state === EntityStateEnum.Modified
      );
      const deletes = changeSets.filter(
        (cs) => cs.state === EntityStateEnum.Deleted
      );

      // Execute in order: inserts, updates, deletes
      // This helps avoid foreign key constraint issues

      for (const changeSet of inserts) {
        const table = this.getTableFromName(changeSet.tableName);
        await this.executeInsert(table, [changeSet.entity]);
      }

      for (const changeSet of updates) {
        const table = this.getTableFromName(changeSet.tableName);
        const primaryKey = this.extractPrimaryKeyValue(table, changeSet.entity);
        const changes = this.buildUpdateChanges(changeSet);
        await this.executeUpdate(table, primaryKey, changes);
      }

      for (const changeSet of deletes) {
        const table = this.getTableFromName(changeSet.tableName);
        const primaryKey = this.extractPrimaryKeyValue(table, changeSet.entity);
        await this.executeDelete(table, primaryKey);
      }

      await this.commitTransaction(tx);
    } catch (error) {
      await this.rollbackTransaction(tx);
      throw error;
    }
  }

  /**
   * Build update changes from a changeset
   */
  protected buildUpdateChanges(changeSet: ChangeSet): Record<string, any> {
    const changes: Record<string, any> = {};

    for (const [property, change] of changeSet.changes) {
      changes[property] = change.new;
    }

    return changes;
  }

  /**
   * Extract primary key value from an entity
   */
  protected extractPrimaryKeyValue(table: Table, entity: any): any {
    const { columns, primaryKeys } = getTableConfig(table);
    const primaryKeyValues: any[] = [];

    // Use the primaryKeys array from getTableConfig if available
    if (primaryKeys && primaryKeys.length > 0) {
      for (const pk of primaryKeys) {
        for (const column of pk.columns) {
          primaryKeyValues.push(entity[column.name]);
        }
      }
    } else {
      // Fallback: iterate through columns array to find primary keys
      for (const column of columns) {
        if ((column as any).primary) {
          primaryKeyValues.push(entity[column.name]);
        }
      }
    }

    // Return single value for single primary key, array for composite keys
    return primaryKeyValues.length === 1
      ? primaryKeyValues[0]
      : primaryKeyValues;
  }

  /**
   * Get table instance from table name
   * This is a placeholder - implementations should override this
   */
  protected getTableFromName(tableName: string): Table {
    // This should be implemented by specific adapters
    // They should maintain a mapping of table names to table instances
    throw new Error(
      `Table '${tableName}' not found. Adapter must implement getTableFromName.`
    );
  }

  /**
   * Get the database type
   */
  abstract getDatabaseType(): "sqlite" | "postgres" | "mysql";

  /**
   * Check if the database supports a specific feature
   */
  supportsReturning(): boolean {
    const dbType = this.getDatabaseType();
    return dbType === "postgres" || dbType === "sqlite";
  }

  /**
   * Check if the database supports batch operations
   */
  supportsBatchOperations(): boolean {
    return true; // Most databases support batch operations
  }

  /**
   * Get the maximum number of parameters for a single query
   */
  getMaxParameters(): number {
    const dbType = this.getDatabaseType();
    switch (dbType) {
      case "sqlite":
        return 999; // SQLite default limit
      case "postgres":
        return 65535; // PostgreSQL limit
      case "mysql":
        return 65535; // MySQL limit
      default:
        return 999; // Conservative default
    }
  }

  /**
   * Batch operations if they exceed parameter limits
   */
  protected async executeBatchOperation<T>(
    items: T[],
    operation: (batch: T[]) => Promise<void>,
    batchSize?: number
  ): Promise<void> {
    const maxBatch = batchSize || Math.floor(this.getMaxParameters() / 10); // Conservative estimate

    for (let i = 0; i < items.length; i += maxBatch) {
      const batch = items.slice(i, i + maxBatch);
      await operation(batch);
    }
  }

  abstract extractPrimaryKey(table: Table, entity: unknown): unknown;
}
