import { describe, test, expect, beforeEach } from "bun:test";

import { IdentityMap } from "./identity-map";
import { ChangeTracker } from "./change-tracker";
import { CheckpointManager } from "./checkpoint-manager";
import { createTestUser, TestDatabase, users } from "./uow.test";

describe("Checkpoint Manager", () => {
  let checkpointManager: CheckpointManager;
  let changeTracker: ChangeTracker;
  let identityMap: IdentityMap;

  beforeEach(() => {
    identityMap = new IdentityMap();
    changeTracker = new ChangeTracker(new TestDatabase().getAdapter());
    checkpointManager = new CheckpointManager(changeTracker, identityMap);
  });

  test("should create checkpoints", () => {
    const checkpoint1 = checkpointManager.setCheckpoint();
    const checkpoint2 = checkpointManager.setCheckpoint();

    expect(checkpoint1).toBeDefined();
    expect(checkpoint2).toBeDefined();
    expect(checkpoint2).toBeGreaterThan(checkpoint1);
  });

  test("should get available checkpoints", () => {
    const cp1 = checkpointManager.setCheckpoint();
    const cp2 = checkpointManager.setCheckpoint();

    const available = checkpointManager.getAvailableCheckpoints();

    expect(available).toContain(cp1);
    expect(available).toContain(cp2);
    expect(available).toHaveLength(2);
  });

  test("should check checkpoint existence", () => {
    const checkpoint = checkpointManager.setCheckpoint();

    expect(checkpointManager.hasCheckpoint(checkpoint)).toBe(true);
    expect(checkpointManager.hasCheckpoint(999)).toBe(false);
  });

  test("should get checkpoint info", () => {
    const testUser = createTestUser(1, "alice");
    changeTracker.track(testUser, users);

    const checkpoint = checkpointManager.setCheckpoint();
    const info = checkpointManager.getCheckpointInfo(checkpoint);

    expect(info).toBeDefined();
    expect(info!.id).toBe(checkpoint);
    expect(info!.timestamp).toBeDefined();
    expect(info!.entityCount).toBe(1);
  });

  test("should rollback to checkpoint", () => {
    const testUser = createTestUser(1, "alice");
    changeTracker.track(testUser, users);

    const checkpoint = checkpointManager.setCheckpoint();

    // Make changes after checkpoint
    testUser.username = "modified";
    changeTracker.markModified(testUser, "username", "alice");

    const result = checkpointManager.rollback(checkpoint);

    expect(result.error).toBeNull();
    expect(testUser.username).toBe("alice"); // Restored to original
  });

  test("should handle rollback to non-existent checkpoint", () => {
    const result = checkpointManager.rollback(999);

    expect(result.error).toBeDefined();
    expect(result.error).toContain("Checkpoint 999 not found");
  });

  test("should get entities at checkpoint", () => {
    const user1 = createTestUser(1, "alice");
    const user2 = createTestUser(2, "bob");

    changeTracker.track(user1, users);

    const checkpoint = checkpointManager.setCheckpoint();

    changeTracker.track(user2, users);

    const entities = checkpointManager.getEntitiesAtCheckpoint(checkpoint);

    expect(entities).toContain(user1);
    expect(entities).not.toContain(user2);
  });

  test("should get latest checkpoint", () => {
    expect(checkpointManager.getLatestCheckpointId()).toBeNull();

    const cp1 = checkpointManager.setCheckpoint();
    expect(checkpointManager.getLatestCheckpointId()).toBe(cp1);

    const cp2 = checkpointManager.setCheckpoint();
    expect(checkpointManager.getLatestCheckpointId()).toBe(cp2);
  });

  test("should clear checkpoints", () => {
    checkpointManager.setCheckpoint();
    checkpointManager.setCheckpoint();

    expect(checkpointManager.getAvailableCheckpoints()).toHaveLength(2);

    checkpointManager.clearCheckpoints();

    expect(checkpointManager.getAvailableCheckpoints()).toHaveLength(0);
    expect(checkpointManager.getLatestCheckpointId()).toBeNull();
  });

  test("should get memory info", () => {
    const user1 = createTestUser(1, "alice");
    const user2 = createTestUser(2, "bob");

    changeTracker.track(user1, users);
    checkpointManager.setCheckpoint();

    changeTracker.track(user2, users);
    checkpointManager.setCheckpoint();

    const memInfo = checkpointManager.getMemoryInfo();

    expect(memInfo.checkpointCount).toBe(2);
    expect(memInfo.totalEntitySnapshots).toBeGreaterThan(0);
    expect(memInfo.oldestCheckpoint).toBeDefined();
    expect(memInfo.newestCheckpoint).toBeDefined();
  });

  test("should limit checkpoint count", () => {
    // Create more than the limit (50) checkpoints
    for (let i = 0; i < 55; i++) {
      checkpointManager.setCheckpoint();
    }

    const available = checkpointManager.getAvailableCheckpoints();
    expect(available.length).toBeLessThanOrEqual(50);
  });

  test("should get changes since checkpoint", () => {
    const user1 = createTestUser(1, "alice");
    changeTracker.track(user1, users);

    const checkpoint = checkpointManager.setCheckpoint();

    const user2 = createTestUser(2, "bob");
    changeTracker.track(user2, users);

    user1.username = "modified";

    const changes = checkpointManager.getChangesSinceCheckpoint(checkpoint);

    expect(changes.added).toContain(user2);
    expect(changes.modified).toContain(user1);
    expect(changes.deleted).toHaveLength(0);
  });
});
