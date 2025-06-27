import { getTableName, type Table } from "drizzle-orm";
import type { TrackedEntity, ChangeSet } from "./types";
import { EntityState } from "./types";
import { IdentityMap } from "./identity-map";
import type { BaseDatabaseAdapter } from "./base-adapter";

/**
 * Change Tracker implementation for monitoring entity modifications
 */
export class ChangeTracker {
  private trackedEntities = new Map<any, TrackedEntity>();
  private identityMap: IdentityMap;
  private adapter: BaseDatabaseAdapter;

  constructor(identityMap: IdentityMap, adapter: BaseDatabaseAdapter) {
    this.identityMap = identityMap;
    this.adapter = adapter;
  }

  /**
   * Start tracking an entity
   */
  track(
    entity: any,
    table: Table,
    state: EntityState = EntityState.Unchanged
  ): void {
    if (this.trackedEntities.has(entity)) {
      return; // Already tracked
    }

    const tableName = getTableName(table);
    const primaryKey = this.adapter.extractPrimaryKeyValue(table, entity);

    const trackedEntity: TrackedEntity = {
      entity,
      state,
      originalValues: new Map(),
      tableName,
      primaryKey,
    };

    // Store original values for change detection
    if (state === EntityState.Unchanged || state === EntityState.Modified) {
      this.captureOriginalValues(entity, trackedEntity.originalValues);
    }

    this.trackedEntities.set(entity, trackedEntity);
  }

  /**
   * Mark an entity as modified and record the change
   */
  markModified(
    entity: any,
    property: string,
    oldValue: any,
    newValue: any
  ): void {
    const tracked = this.trackedEntities.get(entity);
    if (!tracked) {
      throw new Error("Cannot modify untracked entity");
    }

    // If this is the first modification, capture original values
    if (tracked.state === EntityState.Unchanged) {
      tracked.state = EntityState.Modified;
    }

    // Store original value if not already stored
    if (!tracked.originalValues.has(property)) {
      tracked.originalValues.set(property, oldValue);
    }
  }

  /**
   * Mark an entity as deleted
   */
  markDeleted(entity: any): void {
    const tracked = this.trackedEntities.get(entity);
    if (!tracked) {
      throw new Error("Cannot delete untracked entity");
    }

    tracked.state = EntityState.Deleted;
  }

  /**
   * Mark an entity as added (new)
   */
  markAdded(entity: any, table: Table): void {
    this.track(entity, table, EntityState.Added);
  }

  /**
   * Get the tracking state of an entity
   */
  getState(entity: any): EntityState | undefined {
    return this.trackedEntities.get(entity)?.state;
  }

  /**
   * Check if an entity is tracked
   */
  isTracked(entity: any): boolean {
    return this.trackedEntities.has(entity);
  }

  /**
   * Get all tracked entities
   */
  getAllTracked(): TrackedEntity[] {
    return Array.from(this.trackedEntities.values());
  }

  /**
   * Get tracked entities by state
   */
  getByState(state: EntityState): TrackedEntity[] {
    return this.getAllTracked().filter((tracked) => tracked.state === state);
  }

  /**
   * Get tracked entities up to a specific checkpoint
   */
  getUpToCheckpoint(
    checkpointId: number,
    checkpoints: Map<number, Set<any>>
  ): TrackedEntity[] {
    const entitiesAtCheckpoint = checkpoints.get(checkpointId);
    if (!entitiesAtCheckpoint) {
      return [];
    }

    return Array.from(this.trackedEntities.values()).filter((tracked) =>
      entitiesAtCheckpoint.has(tracked.entity)
    );
  }

  /**
   * Compute change sets for all modified entities
   */
  computeChangeSets(): ChangeSet[] {
    const changeSets: ChangeSet[] = [];

    for (const tracked of this.trackedEntities.values()) {
      if (tracked.state === EntityState.Unchanged) {
        continue;
      }

      const changeSet: ChangeSet = {
        entity: tracked.entity,
        state: tracked.state,
        changes: new Map(),
        tableName: tracked.tableName,
      };

      if (tracked.state === EntityState.Modified) {
        // Compute the actual changes
        for (const [property, originalValue] of tracked.originalValues) {
          const currentValue = tracked.entity[property];
          if (!this.deepEqual(originalValue, currentValue)) {
            changeSet.changes.set(property, {
              old: originalValue,
              new: currentValue,
            });
          }
        }

        // Only include if there are actual changes
        if (changeSet.changes.size > 0) {
          changeSets.push(changeSet);
        }
      } else {
        // For Added and Deleted, include the changeset
        changeSets.push(changeSet);
      }
    }

    return changeSets;
  }

  /**
   * Clear tracking for specific entities
   */
  untrack(entities: any[]): void {
    for (const entity of entities) {
      this.trackedEntities.delete(entity);
    }
  }

  /**
   * Clear all tracking
   */
  clear(): void {
    this.trackedEntities.clear();
  }

  /**
   * Create a snapshot of current tracking state
   */
  createSnapshot(): Map<any, TrackedEntity> {
    const snapshot = new Map<any, TrackedEntity>();

    for (const [entity, tracked] of this.trackedEntities) {
      // Deep clone the tracked entity data
      const clonedTracked: TrackedEntity = {
        entity: this.deepClone(entity),
        state: tracked.state,
        originalValues: new Map(tracked.originalValues),
        tableName: tracked.tableName,
        primaryKey: tracked.primaryKey,
      };

      snapshot.set(entity, clonedTracked);
    }

    return snapshot;
  }

  /**
   * Restore tracking state from snapshot
   */
  restoreFromSnapshot(snapshot: Map<any, TrackedEntity>): void {
    this.trackedEntities.clear();

    for (const [entity, tracked] of snapshot) {
      // Restore the entity state
      Object.assign(entity, tracked.entity);

      // Restore tracking info
      this.trackedEntities.set(entity, {
        entity,
        state: tracked.state,
        originalValues: new Map(tracked.originalValues),
        tableName: tracked.tableName,
        primaryKey: tracked.primaryKey,
      });
    }
  }

  /**
   * Capture original values of an entity
   */
  private captureOriginalValues(
    entity: any,
    originalValues: Map<string, any>
  ): void {
    for (const [key, value] of Object.entries(entity)) {
      originalValues.set(key, this.deepClone(value));
    }
  }

  /**
   * Deep equality check
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;

    if (a == null || b == null) return a === b;

    if (typeof a !== typeof b) return false;

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    if (typeof a === "object" && typeof b === "object") {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!this.deepEqual(a[key], b[key])) return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Deep clone utility
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
