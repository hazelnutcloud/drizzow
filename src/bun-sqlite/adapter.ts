import type { DBQueryConfig, Table } from "drizzle-orm";
import {
  SQLiteDialect,
  SQLiteSyncDialect,
  type BaseSQLiteDatabase,
} from "drizzle-orm/sqlite-core";
import { aliasedTableColumn, eq, sql, getOperators } from "drizzle-orm";
import { SqliteAdapter } from "../sqlite-core/adapter";

/**
 * SQLite database adapter
 */
export class BunSQLiteAdapter extends SqliteAdapter {
  protected override db: BaseSQLiteDatabase<any, any, any>;

  constructor(db: BaseSQLiteDatabase<any, any, any>) {
    super(db);
    this.db = db;
  }

  override async insertNewEntity(table: Table, data: any): Promise<any> {
    return (await this.db.insert(table).values(data).returning())[0];
  }

  override async beginTransaction(): Promise<any> {
    // SQLite in Drizzle uses transactions differently
    // We'll return a transaction object that we can use later
    return this.db.transaction(async (tx) => {
      return tx;
    });
  }

  override async executeInsert(table: Table, values: any[]): Promise<void> {
    if (values.length === 0) return;

    await this.executeBatchOperation(values, async (batch) => {
      for (const value of batch) {
        await this.db.insert(table).values(value);
      }
    });
  }

  override async executeUpdate(
    table: Table,
    id: any,
    changes: Record<string, any>
  ): Promise<void> {
    if (Object.keys(changes).length === 0) return;

    // Find the primary key column
    const primaryKeyColumn = this.getPrimaryKeyColumn(table);
    if (!primaryKeyColumn) {
      throw new Error(`No primary key found for table ${table._.name}`);
    }

    await this.db.update(table).set(changes).where(eq(primaryKeyColumn, id));
  }

  override async executeDelete(table: Table, id: any): Promise<void> {
    // Find the primary key column
    const primaryKeyColumn = this.getPrimaryKeyColumn(table);
    if (!primaryKeyColumn) {
      throw new Error(`No primary key found for table ${table._.name}`);
    }

    await this.db.delete(table).where(eq(primaryKeyColumn, id));
  }

  override async commitTransaction(tx: any): Promise<void> {
    // In Drizzle SQLite, transactions are auto-committed when the callback completes
    // This is handled by the transaction wrapper
  }

  override async rollbackTransaction(tx: any): Promise<void> {
    // In Drizzle SQLite, transactions are auto-rolled back on error
    // This is handled by the transaction wrapper
    throw new Error("Transaction rolled back");
  }

  /**
   * Override the changeset execution to use SQLite transactions properly
   */
  override async executeChangeSets(changeSets: any[]): Promise<void> {
    if (changeSets.length === 0) {
      return;
    }

    await this.db.transaction(async (tx) => {
      // Group changes by type for optimal execution order
      const inserts = changeSets.filter((cs: any) => cs.state === "added");
      const updates = changeSets.filter((cs: any) => cs.state === "modified");
      const deletes = changeSets.filter((cs: any) => cs.state === "deleted");

      // Execute in order: inserts, updates, deletes
      for (const changeSet of inserts) {
        const table = this.getTableFromName(changeSet.tableName);
        await tx.insert(table).values(changeSet.entity);
      }

      for (const changeSet of updates) {
        const table = this.getTableFromName(changeSet.tableName);
        const primaryKey = this.extractPrimaryKeyValue(table, changeSet.entity);
        const changes = this.buildUpdateChanges(changeSet);
        const primaryKeyColumn = this.getPrimaryKeyColumn(table);

        if (!primaryKeyColumn) {
          throw new Error(
            `No primary key found for table ${changeSet.tableName}`
          );
        }

        await tx
          .update(table)
          .set(changes)
          .where(eq(primaryKeyColumn, primaryKey));
      }

      for (const changeSet of deletes) {
        const table = this.getTableFromName(changeSet.tableName);
        const primaryKey = this.extractPrimaryKeyValue(table, changeSet.entity);
        const primaryKeyColumn = this.getPrimaryKeyColumn(table);

        if (!primaryKeyColumn) {
          throw new Error(
            `No primary key found for table ${changeSet.tableName}`
          );
        }

        await tx.delete(table).where(eq(primaryKeyColumn, primaryKey));
      }
    });
  }
}
