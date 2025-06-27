import type { Checkpoint, RollbackResult } from "./types";
import { ChangeTracker } from "./change-tracker";
import { IdentityMap } from "./identity-map";

/**
 * Checkpoint Manager for handling state snapshots and rollbacks
 */
export class CheckpointManager {
  private checkpoints: Checkpoint[] = [];
  private currentCheckpointId: number = 0;
  private changeTracker: ChangeTracker;
  private identityMap: IdentityMap;

  constructor(changeTracker: ChangeTracker, identityMap: IdentityMap) {
    this.changeTracker = changeTracker;
    this.identityMap = identityMap;
  }

  /**
   * Create a new checkpoint
   */
  setCheckpoint(): number {
    const checkpointId = ++this.currentCheckpointId;
    
    const checkpoint: Checkpoint = {
      id: checkpointId,
      timestamp: Date.now(),
      entityStates: this.changeTracker.createSnapshot(),
      identityMapSnapshot: this.identityMap.createSnapshot(),
    };

    this.checkpoints.push(checkpoint);
    
    // Keep only the last 50 checkpoints to prevent memory issues
    if (this.checkpoints.length > 50) {
      this.checkpoints.shift();
    }

    return checkpointId;
  }

  /**
   * Rollback to a specific checkpoint
   */
  rollback(checkpointId: number): RollbackResult {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    
    if (!checkpoint) {
      return {
        error: `Checkpoint ${checkpointId} not found. Available checkpoints: ${this.checkpoints.map(cp => cp.id).join(', ')}`
      };
    }

    try {
      // Restore change tracker state
      this.changeTracker.restoreFromSnapshot(checkpoint.entityStates);
      
      // Restore identity map state
      this.identityMap.restoreFromSnapshot(checkpoint.identityMapSnapshot);

      // Remove checkpoints created after this one
      this.checkpoints = this.checkpoints.filter(cp => cp.id <= checkpointId);
      
      return { error: null };
    } catch (error) {
      return {
        error: `Failed to rollback to checkpoint ${checkpointId}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Get all available checkpoint IDs
   */
  getAvailableCheckpoints(): number[] {
    return this.checkpoints.map(cp => cp.id);
  }

  /**
   * Get checkpoint information
   */
  getCheckpointInfo(checkpointId: number): { id: number; timestamp: number; entityCount: number } | null {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
      return null;
    }

    return {
      id: checkpoint.id,
      timestamp: checkpoint.timestamp,
      entityCount: checkpoint.entityStates.size,
    };
  }

  /**
   * Get entities that were tracked at a specific checkpoint
   */
  getEntitiesAtCheckpoint(checkpointId: number): any[] {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
      return [];
    }

    return Array.from(checkpoint.entityStates.keys());
  }

  /**
   * Check if a checkpoint exists
   */
  hasCheckpoint(checkpointId: number): boolean {
    return this.checkpoints.some(cp => cp.id === checkpointId);
  }

  /**
   * Get the latest checkpoint ID
   */
  getLatestCheckpointId(): number | null {
    if (this.checkpoints.length === 0) {
      return null;
    }
    return Math.max(...this.checkpoints.map(cp => cp.id));
  }

  /**
   * Clear all checkpoints
   */
  clearCheckpoints(): void {
    this.checkpoints = [];
    this.currentCheckpointId = 0;
  }

  /**
   * Get changes since a specific checkpoint
   */
  getChangesSinceCheckpoint(checkpointId: number): {
    added: any[];
    modified: any[];
    deleted: any[];
  } {
    const checkpoint = this.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint) {
      return { added: [], modified: [], deleted: [] };
    }

    const currentEntities = new Set(this.changeTracker.getAllTracked().map(t => t.entity));
    const checkpointEntities = new Set(Array.from(checkpoint.entityStates.keys()));

    const added: any[] = [];
    const modified: any[] = [];
    const deleted: any[] = [];

    // Find added entities (in current but not in checkpoint)
    for (const entity of currentEntities) {
      if (!checkpointEntities.has(entity)) {
        added.push(entity);
      }
    }

    // Find deleted entities (in checkpoint but not in current)
    for (const entity of checkpointEntities) {
      if (!currentEntities.has(entity)) {
        deleted.push(entity);
      }
    }

    // Find modified entities (compare states)
    for (const entity of currentEntities) {
      if (checkpointEntities.has(entity)) {
        const currentTracked = this.changeTracker.getAllTracked().find(t => t.entity === entity);
        const checkpointTracked = checkpoint.entityStates.get(entity);
        
        if (currentTracked && checkpointTracked) {
          // Compare entity states to detect modifications
          if (!this.deepEqual(currentTracked.entity, checkpointTracked.entity)) {
            modified.push(entity);
          }
        }
      }
    }

    return { added, modified, deleted };
  }

  /**
   * Get memory usage information
   */
  getMemoryInfo(): {
    checkpointCount: number;
    totalEntitySnapshots: number;
    oldestCheckpoint: number | null;
    newestCheckpoint: number | null;
  } {
    const totalEntitySnapshots = this.checkpoints.reduce(
      (sum, cp) => sum + cp.entityStates.size,
      0
    );

    return {
      checkpointCount: this.checkpoints.length,
      totalEntitySnapshots,
      oldestCheckpoint: this.checkpoints.length > 0 ? Math.min(...this.checkpoints.map(cp => cp.id)) : null,
      newestCheckpoint: this.checkpoints.length > 0 ? Math.max(...this.checkpoints.map(cp => cp.id)) : null,
    };
  }

  /**
   * Deep equality check for comparing entity states
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
    
    if (typeof a === 'object' && typeof b === 'object') {
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
}
