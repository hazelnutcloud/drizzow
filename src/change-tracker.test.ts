import { describe, test, expect, beforeEach } from "bun:test";

import { IdentityMap } from "./identity-map";
import { ChangeTracker } from "./change-tracker";
import { EntityState } from "./types";
import { createTestUser, TestDatabase, users } from "./uow.test";

describe("Change Tracker", () => {
  let changeTracker: ChangeTracker;
  let identityMap: IdentityMap;
  let testUser: any;

  beforeEach(() => {
    identityMap = new IdentityMap();
    changeTracker = new ChangeTracker(
      identityMap,
      new TestDatabase().getAdapter()
    );
    testUser = createTestUser(1, "alice");
  });

  test("should track new entities", () => {
    changeTracker.track(testUser, users, EntityState.Unchanged);

    expect(changeTracker.isTracked(testUser)).toBe(true);
    expect(changeTracker.getState(testUser)).toBe(EntityState.Unchanged);
  });

  test("should not duplicate tracking", () => {
    changeTracker.track(testUser, users);
    changeTracker.track(testUser, users); // Second call should be ignored

    const tracked = changeTracker.getAllTracked();
    expect(tracked).toHaveLength(1);
  });

  test("should mark entities as modified", () => {
    changeTracker.track(testUser, users);

    changeTracker.markModified(testUser, "username", "alice", "alice_new");

    expect(changeTracker.getState(testUser)).toBe(EntityState.Modified);
  });

  test("should mark entities as deleted", () => {
    changeTracker.track(testUser, users);

    changeTracker.markDeleted(testUser);

    expect(changeTracker.getState(testUser)).toBe(EntityState.Deleted);
  });

  test("should mark entities as added", () => {
    changeTracker.markAdded(testUser, users);

    expect(changeTracker.isTracked(testUser)).toBe(true);
    expect(changeTracker.getState(testUser)).toBe(EntityState.Added);
  });

  test("should compute change sets", () => {
    changeTracker.track(testUser, users, EntityState.Unchanged);

    // Actually change the entity properties and mark as modified
    testUser.username = "alice_new";
    testUser.email = "new@example.com";
    changeTracker.markModified(testUser, "username", "alice", "alice_new");
    changeTracker.markModified(
      testUser,
      "email",
      "alice@example.com",
      "new@example.com"
    );

    const changeSets = changeTracker.computeChangeSets();

    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.state).toBe(EntityState.Modified);
    expect(changeSets[0]?.changes.size).toBe(2);
    expect(changeSets[0]?.changes.get("username")?.new).toBe("alice_new");
    expect(changeSets[0]?.changes.get("email")?.new).toBe("new@example.com");
  });

  test("should not include unchanged entities in changesets", () => {
    changeTracker.track(testUser, users, EntityState.Unchanged);

    const changeSets = changeTracker.computeChangeSets();

    expect(changeSets).toHaveLength(0);
  });

  test("should handle entities by state", () => {
    const user2 = createTestUser(2, "bob");
    const user3 = createTestUser(3, "charlie");

    changeTracker.track(testUser, users, EntityState.Modified);
    changeTracker.markAdded(user2, users);
    changeTracker.track(user3, users, EntityState.Unchanged); // Track first
    changeTracker.markDeleted(user3);

    const modified = changeTracker.getByState(EntityState.Modified);
    const added = changeTracker.getByState(EntityState.Added);
    const deleted = changeTracker.getByState(EntityState.Deleted);

    expect(modified).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(deleted).toHaveLength(1);
  });

  test("should untrack entities", () => {
    const user2 = createTestUser(2, "bob");

    changeTracker.track(testUser, users);
    changeTracker.track(user2, users);

    expect(changeTracker.getAllTracked()).toHaveLength(2);

    changeTracker.untrack([testUser]);

    expect(changeTracker.getAllTracked()).toHaveLength(1);
    expect(changeTracker.isTracked(testUser)).toBe(false);
    expect(changeTracker.isTracked(user2)).toBe(true);
  });

  test("should clear all tracking", () => {
    changeTracker.track(testUser, users);
    changeTracker.track(createTestUser(2, "bob"), users);

    expect(changeTracker.getAllTracked()).toHaveLength(2);

    changeTracker.clear();

    expect(changeTracker.getAllTracked()).toHaveLength(0);
  });

  test("should create and restore snapshots", () => {
    changeTracker.track(testUser, users, EntityState.Modified);

    const snapshot = changeTracker.createSnapshot();

    changeTracker.clear();
    expect(changeTracker.isTracked(testUser)).toBe(false);

    changeTracker.restoreFromSnapshot(snapshot);

    expect(changeTracker.isTracked(testUser)).toBe(true);
    expect(changeTracker.getState(testUser)).toBe(EntityState.Modified);
  });

  test("should handle invalid operations", () => {
    expect(() =>
      changeTracker.markModified(testUser, "prop", "old", "new")
    ).toThrow("Cannot modify untracked entity");
    expect(() => changeTracker.markDeleted(testUser)).toThrow(
      "Cannot delete untracked entity"
    );
  });
});
