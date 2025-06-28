import {
  aliasedTableColumn,
  type DBQueryConfig,
  type Table,
  type TableConfig,
  getOperators,
  sql,
  extractTablesRelationalConfig,
  type TablesRelationalConfig,
  createTableRelationsHelpers,
} from "drizzle-orm";
import { BaseDatabaseAdapter } from "../base-adapter";
import {
  BaseSQLiteDatabase,
  getTableConfig,
  SQLiteDialect,
  SQLiteSyncDialect,
} from "drizzle-orm/sqlite-core";

export abstract class SqliteAdapter extends BaseDatabaseAdapter {
  private dialect: SQLiteDialect;
  private tablesRelationalConfig: TablesRelationalConfig;

  constructor(db: BaseSQLiteDatabase<any, any, any, any>) {
    super(db);
    this.dialect = new SQLiteSyncDialect();
    this.tablesRelationalConfig = extractTablesRelationalConfig(
      db._.fullSchema,
      createTableRelationsHelpers
    ).tables;
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

  override getDatabaseType(): "sqlite" | "postgres" | "mysql" {
    return "sqlite";
  }

  override getTableConfig(table: Table): TableConfig {
    return getTableConfig(table) as never;
  }

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

  override getPrimaryKeyColumn(table: Table): any {
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

  override serializeQuery(
    tableAlias: string,
    config: DBQueryConfig<"many", true>
  ): string {
    const preparedQuery = this.prepareQueryForSerializing(tableAlias, config || {});

    return JSON.stringify(preparedQuery);
  }

  private prepareQueryForSerializing(
    tableAlias: string,
    config: DBQueryConfig<"many", true>
  ): Record<string, any> {
    const tableConfig = this.tablesRelationalConfig[tableAlias]!;
    const aliasedColumns = Object.fromEntries(
      Object.entries(tableConfig.columns).map(([key, value]) => [
        key,
        aliasedTableColumn(value, tableAlias),
      ])
    );

    const extrasRaw =
      typeof config.extras === "function"
        ? config.extras(aliasedColumns, { sql })
        : config.extras;
    const extras = extrasRaw
      ? Object.fromEntries(
          Object.entries(extrasRaw ?? {}).map(([key, sql]) => [
            key,
            this.dialect.sqlToQuery(sql.sql),
          ])
        )
      : undefined;

    const whereRaw =
      typeof config.where === "function"
        ? config.where(aliasedColumns, getOperators())
        : config.where;
    const where = whereRaw ? this.dialect.sqlToQuery(whereRaw) : undefined;

    const serializedWith = config.with
      ? Object.fromEntries(
          Object.entries(config.with ?? {})
            .filter(([, relation]) => relation !== undefined)
            .map(([key, relation]) =>
              relation === true
                ? [key, relation]
                : [key, this.prepareQueryForSerializing(key, relation!)]
            )
        )
      : undefined;

    const key = {
      columns: config.columns,
      extras,
      limit: config.limit,
      offset: config.offset,
      where,
      with: serializedWith,
    };

    return key;
  }
}
