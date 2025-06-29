/**
 * Identity Map implementation for ensuring entity uniqueness
 */
export class IdentityMap {
  private entities = new Map<string, Map<string, any>>();

  /**
   * Get an entity by table name and primary key
   */
  get(tableName: string, primaryKey: any): any | undefined {
    const tableMap = this.entities.get(tableName);
    if (!tableMap) return undefined;

    const key = this.serializeKey(primaryKey);
    return tableMap.get(key);
  }

  getMany(
    tableName: string,
    primaryKeys: any[],
  ): { found: any[]; missing: any[] } | undefined {
    const tableMap = this.entities.get(tableName);

    if (!tableMap) return undefined;

    const missings = [];
    const founds = [];

    for (const primaryKey of primaryKeys) {
      const key = this.serializeKey(primaryKey);
      const found = tableMap.get(key);

      if (found) {
        founds.push(found);
      } else {
        missings.push(primaryKey);
      }
    }

    return {
      missing: missings,
      found: founds,
    };
  }

  /**
   * Register an entity in the identity map
   */
  register(tableName: string, primaryKey: any, entity: any): void {
    if (!this.entities.has(tableName)) {
      this.entities.set(tableName, new Map());
    }

    const tableMap = this.entities.get(tableName)!;
    const key = this.serializeKey(primaryKey);
    tableMap.set(key, entity);
  }

  /**
   * Remove an entity from the identity map
   */
  remove(tableName: string, primaryKey: any): void {
    const tableMap = this.entities.get(tableName);
    if (!tableMap) return;

    const key = this.serializeKey(primaryKey);
    tableMap.delete(key);
  }

  /**
   * Check if an entity exists in the identity map
   */
  has(tableName: string, primaryKey: any): boolean {
    const tableMap = this.entities.get(tableName);
    if (!tableMap) return false;

    const key = this.serializeKey(primaryKey);
    return tableMap.has(key);
  }

  /**
   * Clear all entities for a specific table
   */
  clearTable(tableName: string): void {
    this.entities.delete(tableName);
  }

  /**
   * Clear all entities
   */
  clear(): void {
    this.entities.clear();
  }

  /**
   * Get all entities for a table
   */
  getAllForTable(tableName: string): any[] {
    const tableMap = this.entities.get(tableName);
    if (!tableMap) return [];

    return Array.from(tableMap.values());
  }

  /**
   * Create a snapshot of the current identity map state
   */
  createSnapshot(): Map<string, Map<string, any>> {
    const snapshot = new Map<string, Map<string, any>>();

    for (const [tableName, tableMap] of this.entities) {
      const tableSnapshot = new Map<string, any>();
      for (const [key, entity] of tableMap) {
        // Deep clone the entity to prevent mutations affecting the snapshot
        tableSnapshot.set(key, this.deepClone(entity));
      }
      snapshot.set(tableName, tableSnapshot);
    }

    return snapshot;
  }

  /**
   * Restore identity map from a snapshot
   */
  restoreFromSnapshot(snapshot: Map<string, Map<string, any>>): void {
    this.entities.clear();

    for (const [tableName, tableMap] of snapshot) {
      const restoredTableMap = new Map<string, any>();
      for (const [key, entity] of tableMap) {
        // Deep clone to prevent mutations affecting the snapshot
        restoredTableMap.set(key, this.deepClone(entity));
      }
      this.entities.set(tableName, restoredTableMap);
    }
  }

  /**
   * Serialize a primary key (could be single value or composite) to a string
   */
  private serializeKey(key: any): string {
    if (key === null || key === undefined) {
      throw new Error("Primary key cannot be null or undefined");
    }

    if (Array.isArray(key)) {
      // Composite key
      return JSON.stringify(key);
    }

    // Single key
    return String(key);
  }

  /**
   * Deep clone an object to prevent mutations
   */
  private deepClone(obj: any): any {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepClone(item));
    }

    const cloned: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }
}
