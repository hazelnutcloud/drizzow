import {
  EntityState,
  type AnyDrizzleDB,
  type ExtractSchema,
  type RollbackResult,
  type TrackedEntity,
} from "./types";
import { IdentityMap } from "./identity-map";
import { ChangeTracker } from "./change-tracker";
import { ProxyManager } from "./proxy";
import { CheckpointManager } from "./checkpoint-manager";
import type { BaseDatabaseAdapter } from "./base-adapter";
import {
  aliasedTableColumn,
  getOperators,
  sql,
  type DBQueryConfig,
  type Table,
} from "drizzle-orm";

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
  private queryCache: Map<string, { result: any; timestamp: number }>;
  private cacheEnabled: boolean;
  private cacheTTL: number;

  constructor(
    db: TDatabase,
    adapter: BaseDatabaseAdapter,
    options?: { cacheEnabled?: boolean; cacheTTL?: number }
  ) {
    this.db = db;
    this.schema = db._.fullSchema as never;

    // Initialize cache settings
    this.cacheEnabled = options?.cacheEnabled ?? true;
    this.cacheTTL = options?.cacheTTL ?? 60000; // Default 60 seconds
    this.queryCache = new Map();

    // Initialize core components
    this.adapter = adapter;
    this.identityMap = new IdentityMap();
    this.changeTracker = new ChangeTracker(adapter);
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
        findFirst: (config: DBQueryConfig<"many", true>) =>
          this.findFirst(key, config),
        findMany: (config: DBQueryConfig<"many", true>) =>
          this.findMany(key, config),
        create: (data: any) => this.create(key, data),
        delete: (entity: any) => this.deleteEntity(key, entity),
      };
    }
  }

  private async findFirst(table: string, config: DBQueryConfig<"many", true>) {
    const queryKey = this.adapter.serializeQuery(table, config);

    // Check cache if enabled
    if (this.cacheEnabled) {
      const cached = this.queryCache.get(queryKey);
      if (cached) {
        const now = Date.now();
        if (now - cached.timestamp < this.cacheTTL) {
          // Return cached result if still valid
          return cached.result;
        } else {
          // Remove expired cache entry
          this.queryCache.delete(queryKey);
        }
      }
    }

    // Get the table instance from schema
    const tableInstance = this.schema[table]!;

    // Get the query builder for this table
    const queryBuilder = (this.db.query as any)[table]!;

    // Execute the query using Drizzle's relational query builder
    const result = await queryBuilder.findFirst(config);

    // If no result found, cache and return undefined
    if (!result) {
      if (this.cacheEnabled) {
        this.queryCache.set(queryKey, {
          result: undefined,
          timestamp: Date.now(),
        });
      }
      return undefined;
    }

    // Wrap the result with proxy for change tracking
    const wrappedResult = this.proxyManager.wrapQueryResults(result, tableInstance);

    // Cache the wrapped result
    if (this.cacheEnabled) {
      this.queryCache.set(queryKey, {
        result: wrappedResult,
        timestamp: Date.now(),
      });
    }

    return wrappedResult;
  }

  private async findMany(table: string, config: DBQueryConfig<"many", true>) {
    const queryKey = this.adapter.serializeQuery(table, config);

    // Check cache if enabled
    if (this.cacheEnabled) {
      const cached = this.queryCache.get(queryKey);
      if (cached) {
        const now = Date.now();
        if (now - cached.timestamp < this.cacheTTL) {
          // Return cached result if still valid
          return cached.result;
        } else {
          // Remove expired cache entry
          this.queryCache.delete(queryKey);
        }
      }
    }

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
    const results = await queryBuilder.findMany(config);

    // If no results found, cache and return empty array
    if (!results || !Array.isArray(results)) {
      if (this.cacheEnabled) {
        this.queryCache.set(queryKey, {
          result: [],
          timestamp: Date.now(),
        });
      }
      return [];
    }

    // Wrap all results with proxies for change tracking
    const wrappedResults = this.proxyManager.wrapQueryResults(results, tableInstance);

    // Cache the wrapped results
    if (this.cacheEnabled) {
      this.queryCache.set(queryKey, {
        result: wrappedResults,
        timestamp: Date.now(),
      });
    }

    return wrappedResults;
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
    let checkpointState: Map<any, TrackedEntity> | null = null;
    if (checkpoint !== undefined) {
      const validationError =
        this.checkpointManager.getPersistedCheckpointError(checkpoint);
      if (validationError) {
        throw new Error(validationError);
      }

      // Get the checkpoint state
      checkpointState =
        this.checkpointManager.getEntityStatesAtCheckpoint(checkpoint);
      if (!checkpointState) {
        throw new Error(`Checkpoint ${checkpoint} not found`);
      }

      // Compute changesets based on what was modified up to the checkpoint
      changeSets = [];
      for (const [entity, checkpointTracked] of checkpointState) {
        // Check if this entity is still being tracked
        const currentTracked = this.changeTracker.getTrackedEntity(entity);
        if (!currentTracked) continue;
        // If the entity was modified at the checkpoint, include it
        if (checkpointTracked.state === EntityState.Modified) {
          const changeSet = {
            entity: entity,
            state: checkpointTracked.state,
            changes: new Map(),
            tableName: checkpointTracked.tableName,
          };

          // Use the changes from the checkpoint state
          for (const [
            property,
            originalValue,
          ] of checkpointTracked.originalValues) {
            const checkpointValue = checkpointTracked.entity[property];
            if (originalValue !== checkpointValue) {
              changeSet.changes.set(property, {
                old: originalValue,
                new: checkpointValue,
              });
            }
          }

          if (changeSet.changes.size > 0) {
            changeSets.push(changeSet);
          }
        }
      }
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
      // Mark checkpoint as persisted if saving to a specific checkpoint
      if (checkpoint !== undefined) {
        this.checkpointManager.markCheckpointAsPersisted(checkpoint);
        // For checkpoint saves, we need to update the original values of saved entities
        // to reflect their state at the checkpoint
        for (const changeSet of changeSets) {
          const tracked = this.changeTracker.getTrackedEntity(changeSet.entity);
          const checkpointTracked = checkpointState?.get(changeSet.entity);
          if (tracked && checkpointTracked) {
            // Update original values to the checkpoint state (what was saved)
            for (const [property, value] of Object.entries(
              checkpointTracked.entity
            )) {
              tracked.originalValues.set(property, value);
            }
            // Mark this entity as having persisted original values
            this.changeTracker.markOriginalValuesAsPersisted(
              changeSet.entity,
              tracked.originalValues
            );
            // Recompute the state based on current vs new original values
            let hasChanges = false;
            for (const [property, originalValue] of tracked.originalValues) {
              if (tracked.entity[property] !== originalValue) {
                hasChanges = true;
                break;
              }
            }
            tracked.state = hasChanges
              ? EntityState.Modified
              : EntityState.Unchanged;
          }
        }
      } else {
        this.changeTracker.clear();
        this.identityMap.clear();
        this.proxyManager.clearCache();
        this.checkpointManager.clearCheckpoints();
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
    this.queryCache.clear();
  }
}
