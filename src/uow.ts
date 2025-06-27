import type { AnyDrizzleDB, ExtractSchema, RollbackResult } from "./types";
import { IdentityMap } from "./identity-map";
import { ChangeTracker } from "./change-tracker";
import { ProxyManager } from "./proxy";
import { CheckpointManager } from "./checkpoint-manager";
import type { BaseDatabaseAdapter } from "./base-adapter";

/**
 * Unit of Work implementation
 */
export class UnitOfWork<
  TDatabase extends AnyDrizzleDB,
  TSchema extends Record<string, any> = ExtractSchema<TDatabase>
> {
  private db: TDatabase;
  private schema: TSchema;
  private identityMap: IdentityMap;
  private changeTracker: ChangeTracker;
  private proxyManager: ProxyManager;
  private checkpointManager: CheckpointManager;
  private adapter: BaseDatabaseAdapter;

  constructor(db: TDatabase, adapter: BaseDatabaseAdapter) {
    this.db = db;
    this.schema = db._.fullSchema as never;

    // Initialize core components
    this.adapter = adapter;
    this.identityMap = new IdentityMap();
    this.changeTracker = new ChangeTracker(this.identityMap, adapter);
    this.proxyManager = new ProxyManager(
      this.changeTracker,
      this.identityMap,
      adapter
    );
    this.checkpointManager = new CheckpointManager(
      this.changeTracker,
      this.identityMap
    );

    for (const key of Object.keys(db.query)) {
      (this as any)[key] = {
        findFirst: (...params: any[]) => this.findFirst(key, ...params),
        findMany: (...params: any[]) => this.findMany(key, ...params),
        create: (data: any) => this.create(key, data),
        delete: (entity: any) => this.deleteEntity(key, entity),
      };
    }
  }

  private async findFirst(table: string, ...params: any[]) {
    // Get the table instance from schema
    const tableInstance = this.schema[table];
    if (!tableInstance) {
      throw new Error(`Table '${table}' not found in schema`);
    }

    // Get the query builder for this table
    const queryBuilder = (this.db.query as any)[table];
    if (!queryBuilder) {
      throw new Error(`Query builder for table '${table}' not found`);
    }

    // Execute the query using Drizzle's relational query builder
    const result = await queryBuilder.findFirst(...params);

    // If no result found, return undefined
    if (!result) {
      return undefined;
    }

    // Wrap the result with proxy for change tracking
    return this.proxyManager.wrapQueryResults(result, tableInstance);
  }

  private async findMany(table: string, ...params: any[]) {
    // Get the table instance from schema
    const tableInstance = this.schema[table];
    if (!tableInstance) {
      throw new Error(`Table '${table}' not found in schema`);
    }

    // Get the query builder for this table
    const queryBuilder = (this.db.query as any)[table];
    if (!queryBuilder) {
      throw new Error(`Query builder for table '${table}' not found`);
    }

    // Execute the query using Drizzle's relational query builder
    const results = await queryBuilder.findMany(...params);

    // If no results found, return empty array
    if (!results || !Array.isArray(results)) {
      return [];
    }

    // Wrap all results with proxies for change tracking
    return this.proxyManager.wrapQueryResults(results, tableInstance);
  }

  private create(table: string, data: any) {
    // Get the table instance from schema
    const tableInstance = this.schema[table];
    if (!tableInstance) {
      throw new Error(`Table '${table}' not found in schema`);
    }

    // Create a new entity with the provided data
    let entity = { ...data };

    // Check if the entity already has a primary key
    const primaryKey = this.adapter.extractPrimaryKeyValue(
      tableInstance,
      entity
    );

    // Require primary key for create operations
    if (primaryKey === null || primaryKey === undefined) {
      throw new Error(
        `Cannot create entity in table '${table}' without providing a primary key. ` +
        `Please provide all primary key fields when creating new entities.`
      );
    }

    // Create a proxy for the entity and mark it as added
    const proxy = this.proxyManager.createNewEntityProxy(entity, tableInstance);

    // Register the proxy in the identity map
    this.identityMap.register(table, primaryKey, proxy);

    return proxy;
  }

  private deleteEntity(table: string, entity: any) {
    // Get the table instance from schema
    const tableInstance = this.schema[table];
    if (!tableInstance) {
      throw new Error(`Table '${table}' not found in schema`);
    }

    // Check if the entity is being tracked
    if (!this.changeTracker.isTracked(entity)) {
      throw new Error(
        `Cannot delete untracked entity. Entity must be loaded through UnitOfWork or created with create().`
      );
    }

    // Mark the entity as deleted
    this.changeTracker.markDeleted(entity);
    this.identityMap.remove(table, entity);
  }

  /**
   * Save all changes to the database
   */
  async save(checkpoint?: number): Promise<void> {
    let changeSets;
    if (checkpoint !== undefined) {
      // Save only changes up to the specified checkpoint
      if (!this.checkpointManager.hasCheckpoint(checkpoint)) {
        throw new Error(`Checkpoint ${checkpoint} not found`);
      }
      // Get entities at checkpoint and compute changes for them
      const entitiesAtCheckpoint =
        this.checkpointManager.getEntitiesAtCheckpoint(checkpoint);
      const allChangeSets = this.changeTracker.computeChangeSets();
      // Filter changesets to only include entities that existed at the checkpoint
      changeSets = allChangeSets.filter((cs) =>
        entitiesAtCheckpoint.includes(cs.entity)
      );
    } else {
      // Save all changes
      changeSets = this.changeTracker.computeChangeSets();
    }
    if (changeSets.length === 0) {
      return; // Nothing to save
    }
    try {
      // Execute all changes in a transaction
      await this.adapter.executeChangeSets(changeSets);
      // Clear tracking for saved entities if saving all changes
      if (checkpoint === undefined) {
        this.changeTracker.clear();
        this.identityMap.clear();
        this.proxyManager.clearCache();
      } else {
        // For checkpoint saves, only clear entities up to that checkpoint
        const savedEntities = changeSets.map((cs) => cs.entity);
        this.changeTracker.untrack(savedEntities);
      }
    } catch (error) {
      throw new Error(
        `Failed to save changes: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Create a checkpoint
   */
  setCheckpoint(): number {
    return this.checkpointManager.setCheckpoint();
  }

  /**
   * Rollback to a checkpoint
   */
  rollback(checkpoint: number): RollbackResult {
    return this.checkpointManager.rollback(checkpoint);
  }

  /**
   * Refresh an entity from the database
   */
  async refresh(entity: any): Promise<void> {
    // This would require implementing a way to reload the entity from the database
    // For now, we'll throw an error indicating it's not implemented
    throw new Error("refresh() method is not yet implemented");
  }

  /**
   * Get tracking statistics
   */
  getStats(): {
    trackedEntities: number;
    identityMapSize: number;
    checkpointCount: number;
    pendingChanges: number;
  } {
    const changeSets = this.changeTracker.computeChangeSets();

    return {
      trackedEntities: this.changeTracker.getAllTracked().length,
      identityMapSize: Object.keys(this.schema).reduce((sum, tableName) => {
        return sum + this.identityMap.getAllForTable(tableName).length;
      }, 0),
      checkpointCount: this.checkpointManager.getAvailableCheckpoints().length,
      pendingChanges: changeSets.length,
    };
  }

  /**
   * Clear all tracking and caches
   */
  clear(): void {
    this.changeTracker.clear();
    this.identityMap.clear();
    this.proxyManager.clearCache();
    this.checkpointManager.clearCheckpoints();
  }
}
