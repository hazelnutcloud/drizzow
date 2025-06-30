import type { Table } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { PostgresAdapter } from "../pg-core/adapter";

/**
 * PostgreSQL database adapter for node-postgres
 */
export class NodePostgresAdapter extends PostgresAdapter {
  protected override db: NodePgDatabase<any>;

  constructor(db: NodePgDatabase<any>) {
    super(db);
    this.db = db;
  }

  override async beginTransaction(): Promise<any> {
    // PostgreSQL in Drizzle uses transactions differently
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
    changes: Record<string, any>,
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

  override async commitTransaction(_tx: any): Promise<void> {
    // In Drizzle PostgreSQL, transactions are auto-committed when the callback completes
    // This is handled by the transaction wrapper
  }

  override async rollbackTransaction(_tx: any): Promise<void> {
    // In Drizzle PostgreSQL, transactions are auto-rolled back on error
    // This is handled by the transaction wrapper
    throw new Error("Transaction rolled back");
  }

  /**
   * Override the changeset execution to use PostgreSQL transactions properly
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
            `No primary key found for table ${changeSet.tableName}`,
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
            `No primary key found for table ${changeSet.tableName}`,
          );
        }

        await tx.delete(table).where(eq(primaryKeyColumn, primaryKey));
      }
    });
  }
}
