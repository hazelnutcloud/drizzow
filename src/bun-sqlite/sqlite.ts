import type { AnyColumn, Table, TableConfig } from "drizzle-orm";
import {
  getTableConfig,
  type BaseSQLiteDatabase,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { BaseDatabaseAdapter } from "../base-adapter";

/**
 * SQLite database adapter
 */
export class SQLiteAdapter extends BaseDatabaseAdapter {
  protected override db: BaseSQLiteDatabase<any, any, any>;
  private schema: Record<string, Table>;

  constructor(db: BaseSQLiteDatabase<any, any, any>) {
    super(db);
    this.db = db;
    this.schema = db._.fullSchema;
  }

  override async insertNewEntity(table: Table, data: any): Promise<any> {
    return (await this.db.insert(table).values(data).returning())[0];
  }

  override extractPrimaryKeyValue(table: Table, entity: any) {
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
        if (column.primary) {
          primaryKeyValues.push(entity[column.name]);
        }
      }
    }

    // Return single value for single primary key, array for composite keys
    return primaryKeyValues.length === 1
      ? primaryKeyValues[0]
      : primaryKeyValues;
  }

  async beginTransaction(): Promise<any> {
    // SQLite in Drizzle uses transactions differently
    // We'll return a transaction object that we can use later
    return this.db.transaction(async (tx) => {
      return tx;
    });
  }

  async executeInsert(table: Table, values: any[]): Promise<void> {
    if (values.length === 0) return;

    await this.executeBatchOperation(values, async (batch) => {
      for (const value of batch) {
        await this.db.insert(table).values(value);
      }
    });
  }

  async executeUpdate(
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

  async executeDelete(table: Table, id: any): Promise<void> {
    // Find the primary key column
    const primaryKeyColumn = this.getPrimaryKeyColumn(table);
    if (!primaryKeyColumn) {
      throw new Error(`No primary key found for table ${table._.name}`);
    }

    await this.db.delete(table).where(eq(primaryKeyColumn, id));
  }

  async commitTransaction(tx: any): Promise<void> {
    // In Drizzle SQLite, transactions are auto-committed when the callback completes
    // This is handled by the transaction wrapper
  }

  async rollbackTransaction(tx: any): Promise<void> {
    // In Drizzle SQLite, transactions are auto-rolled back on error
    // This is handled by the transaction wrapper
    throw new Error("Transaction rolled back");
  }

  override getDatabaseType(): "sqlite" | "postgres" | "mysql" {
    return "sqlite";
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

  /**
   * Get table instance from table name using the schema
   */
  protected override getTableFromName(tableName: string): Table {
    const table = this.schema[tableName];
    if (!table) {
      // Try to find by table name in case the key doesn't match
      for (const [key, tableInstance] of Object.entries(this.schema)) {
        const { name } = getTableConfig(tableInstance);
        if (name === tableName) {
          return tableInstance;
        }
      }
      throw new Error(`Table '${tableName}' not found in schema`);
    }
    return table;
  }

  /**
   * Get the primary key column for a table
   */
  private getPrimaryKeyColumn(table: Table): any {
    const { columns, primaryKeys } = getTableConfig(table);

    // Use the primaryKeys array from getTableConfig if available
    if (primaryKeys && primaryKeys.length > 0) {
      // Return the first column of the first primary key
      return primaryKeys[0]!.columns[0];
    } else {
      // Fallback: iterate through columns array to find primary keys
      for (const column of columns) {
        if ((column as any).primary) {
          return column;
        }
      }
    }

    return null;
  }

  /**
   * Get all primary key columns for composite keys
   */
  private getPrimaryKeyColumns(table: Table): any[] {
    const { columns, primaryKeys } = getTableConfig(table);
    const primaryKeyColumns: any[] = [];

    // Use the primaryKeys array from getTableConfig if available
    if (primaryKeys && primaryKeys.length > 0) {
      for (const pk of primaryKeys) {
        primaryKeyColumns.push(...pk.columns);
      }
    } else {
      // Fallback: iterate through columns array to find primary keys
      for (const column of columns) {
        if ((column as any).primary) {
          primaryKeyColumns.push(column);
        }
      }
    }

    return primaryKeyColumns;
  }
}
