import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { UnitOfWork } from "./uow";
import { BunSQLiteAdapter } from "./bun-sqlite/adapter";
import type { CreateUowReturnType } from "./bun-sqlite";

// Test Schema
export const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
  email: text(),
});

export const posts = sqliteTable("posts", {
  id: integer().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  content: text(),
  userId: integer().notNull(),
});

export const testSchema = { users, posts };

// Test utilities
export class TestDatabase {
  private db: Database;
  private drizzleDb: BunSQLiteDatabase<typeof testSchema>;
  private adapter: BunSQLiteAdapter;

  constructor() {
    this.db = new Database(":memory:");
    this.drizzleDb = drizzle(this.db, { schema: testSchema });
    this.adapter = new BunSQLiteAdapter(this.drizzleDb);
  }

  async setup() {
    // Create tables using SQL since the database doesn't exist yet
    this.db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        userId INTEGER NOT NULL
      )
    `);

    // Insert test data
    await this.drizzleDb.insert(users).values([
      { username: "alice", email: "alice@example.com" },
      { username: "bob", email: "bob@example.com" },
      { username: "charlie", email: "charlie@example.com" },
    ]);

    await this.drizzleDb.insert(posts).values([
      { title: "First Post", content: "Hello World", userId: 1 },
      { title: "Second Post", content: "Testing", userId: 1 },
      { title: "Third Post", content: "More content", userId: 2 },
    ]);
  }

  getDrizzleInstance() {
    return this.drizzleDb;
  }

  getAdapter() {
    return this.adapter;
  }

  close() {
    this.db.close();
  }
}

// Test Suite
describe("Unit of Work - New API", () => {
  let testDb: TestDatabase;
  let uow: CreateUowReturnType<BunSQLiteDatabase<typeof testSchema>>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    await testDb.setup();
    uow = new UnitOfWork(
      testDb.getDrizzleInstance(),
      testDb.getAdapter()
    ) as never;
  });

  afterEach(() => {
    uow.clear();
    testDb.close();
  });

  describe("UoW Initialization", () => {
    test("should initialize with correct dependencies", () => {
      expect(uow).toBeDefined();
      expect(uow.getStats().trackedEntities).toBe(0);
      expect(uow.getStats().identityMapSize).toBe(0);
      expect(uow.getStats().checkpointCount).toBe(0);
      expect(uow.getStats().pendingChanges).toBe(0);
    });

    test("should provide table query methods", () => {
      expect(uow.users).toBeDefined();
      expect(uow.users.find).toBeDefined();
      expect(uow.posts).toBeDefined();
      expect(uow.posts.find).toBeDefined();
    });
  });

  describe("Basic Query Operations", () => {
    test("should find user by id", async () => {
      const user = await uow.users.find({ id: 1 });

      expect(user).toBeDefined();
      expect(user?.username).toBe("alice");
      expect(user?.email).toBe("alice@example.com");
      expect(uow.getStats().trackedEntities).toBe(1);
    });

    test("should find multiple users by ids", async () => {
      const users = await uow.users.find({ id: [1, 2, 3] });

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBe(3);
      expect(uow.getStats().trackedEntities).toBe(3);
    });

    test("should return undefined for non-existent entity", async () => {
      const user = await uow.users.find({ id: 999 });

      expect(user).toBeUndefined();
      expect(uow.getStats().trackedEntities).toBe(0);
    });

    test("should return empty array when no entities match", async () => {
      const users = await uow.users.find({ id: [999, 1000] });

      expect(users).toBeDefined();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBe(0);
      expect(uow.getStats().trackedEntities).toBe(0);
    });
  });

  describe("Entity Tracking and Identity Map", () => {
    test("should track entities from queries", async () => {
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 1 });

      expect(user1).toBe(user2!); // Same object reference due to identity map
      expect(uow.getStats().trackedEntities).toBe(1);
      expect(uow.getStats().identityMapSize).toBe(1);
    });

    test("should maintain separate identities for different entities", async () => {
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });

      expect(user1).not.toBe(user2);
      expect(uow.getStats().trackedEntities).toBe(2);
      expect(uow.getStats().identityMapSize).toBe(2);
    });

    test("should handle mixed queries correctly", async () => {
      const allUsers = await uow.users.find({ id: [1, 2, 3] });
      const specificUser = await uow.users.find({ id: 1 });

      expect(allUsers[0]).toBe(specificUser!); // Same object reference
      expect(uow.getStats().trackedEntities).toBe(3); // All users from find
      expect(uow.getStats().identityMapSize).toBe(3);
    });
  });

  describe("Change Tracking", () => {
    test("should detect property changes", async () => {
      const user = await uow.users.find({ id: 1 });

      expect(uow.getStats().pendingChanges).toBe(0);

      user!.username = "alice_modified";

      expect(uow.getStats().pendingChanges).toBe(1);
    });

    test("should not create changeset for unchanged entities", async () => {
      const user = await uow.users.find({ id: 1 });

      // Access properties but don't change them
      const username = user!.username;
      const email = user!.email;

      expect(uow.getStats().pendingChanges).toBe(0);
    });

    test("should track multiple property changes on same entity", async () => {
      const user = await uow.users.find({ id: 1 });

      user!.username = "alice_new";
      user!.email = "alice_new@example.com";

      expect(uow.getStats().pendingChanges).toBe(1); // Still one entity changed
    });

    test("should track changes on multiple entities", async () => {
      const users = await uow.users.find({ id: [1, 2] });

      users[0]!.username = "alice_new";
      users[1]!.username = "bob_new";

      expect(uow.getStats().pendingChanges).toBe(2);
    });

    test("should not track changes after setting same value", async () => {
      const user = await uow.users.find({ id: 1 });
      const originalUsername = user!.username;

      user!.username = "modified";
      expect(uow.getStats().pendingChanges).toBe(1);

      user!.username = originalUsername; // Back to original
      expect(uow.getStats().pendingChanges).toBe(0);
    });
  });

  describe("Save Operations", () => {
    test("should save modified entity", async () => {
      const user = await uow.users.find({ id: 1 });
      user!.username = "alice_updated";

      await uow.save();

      expect(uow.getStats().pendingChanges).toBe(0);
      expect(uow.getStats().trackedEntities).toBe(0); // Cleared after save

      // Verify in database
      const updatedUser = await testDb
        .getDrizzleInstance()
        .query.users.findFirst({
          where: (users, { eq }) => eq(users.id, user!.id),
        });
      expect(updatedUser?.username).toBe("alice_updated");
    });

    test("should handle save with no changes", async () => {
      await uow.users.find({ id: 1 });

      await uow.save(); // Should not throw

      expect(uow.getStats().pendingChanges).toBe(0);
    });

    test("should save multiple modified entities", async () => {
      const users = await uow.users.find({ id: [1, 2] });

      users[0]!.username = "alice_batch";
      users[1]!.username = "bob_batch";

      await uow.save();

      expect(uow.getStats().pendingChanges).toBe(0);

      // Verify in database
      const updatedUsers = await testDb
        .getDrizzleInstance()
        .query.users.findMany();
      expect(updatedUsers.find((u) => u.id === users[0]?.id)?.username).toBe(
        "alice_batch"
      );
      expect(updatedUsers.find((u) => u.id === users[1]?.id)?.username).toBe(
        "bob_batch"
      );
    });
  });

  describe("Checkpoint and Rollback", () => {
    test("should create checkpoints", async () => {
      const checkpoint1 = uow.setCheckpoint();
      const checkpoint2 = uow.setCheckpoint();

      expect(checkpoint1).toBeDefined();
      expect(checkpoint2).toBeDefined();
      expect(checkpoint2).toBeGreaterThan(checkpoint1);
      expect(uow.getStats().checkpointCount).toBe(2);
    });

    test("should rollback to checkpoint", async () => {
      const user = await uow.users.find({ id: 1 });
      const originalUsername = user!.username;

      const checkpoint = uow.setCheckpoint();
      user!.username = "modified";

      expect(user!.username).toBe("modified");
      expect(uow.getStats().pendingChanges).toBe(1);

      const result = uow.rollback(checkpoint);

      expect(result.error).toBeNull();
      expect(user!.username).toBe(originalUsername);
      expect(uow.getStats().pendingChanges).toBe(0);
    });

    test("should handle rollback to non-existent checkpoint", () => {
      const result = uow.rollback(999);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("Checkpoint 999 not found");
    });

    test("should rollback multiple changes", async () => {
      const users = await uow.users.find({ id: [1, 2] });
      const originalUsernames = users.map((u) => u.username);

      const checkpoint = uow.setCheckpoint();

      users[0]!.username = "modified1";
      users[1]!.username = "modified2";

      expect(uow.getStats().pendingChanges).toBe(2);

      const result = uow.rollback(checkpoint);

      expect(result.error).toBeNull();
      expect(users[0]!.username).toBe(originalUsernames[0]!);
      expect(users[1]!.username).toBe(originalUsernames[1]!);
      expect(uow.getStats().pendingChanges).toBe(0);
    });

    test("should handle partial save to checkpoint", async () => {
      // Load only first two users
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });

      // Modify entities tracked at checkpoint
      user1!.username = "checkpoint_mod1";
      user2!.username = "checkpoint_mod2";

      const checkpoint = uow.setCheckpoint();

      // Load new entity after checkpoint
      const newUser = await uow.users.find({ id: 3 });
      newUser!.username = "after_checkpoint";

      expect(uow.getStats().pendingChanges).toBe(3);

      // Save only up to checkpoint
      await uow.save(checkpoint);

      expect(uow.getStats().pendingChanges).toBe(1);

      // Verify in database
      const dbUsers = await testDb.getDrizzleInstance().query.users.findMany();
      expect(dbUsers.find((u) => u.id === user1!.id)?.username).toBe("checkpoint_mod1");
      expect(dbUsers.find((u) => u.id === user2!.id)?.username).toBe("checkpoint_mod2");
      expect(dbUsers.find((u: any) => u.id === 3)?.username).toBe("charlie"); // Not saved
    });
  });

  describe("Proxy Behavior", () => {
    test("should create transparent proxies", async () => {
      const user = await uow.users.find({ id: 1 });

      // Should behave like a normal object
      expect(user!.username).toBe("alice");
      expect(user!.email).toBe("alice@example.com");

      // Should allow property enumeration
      const keys = Object.keys(user!);
      expect(keys).toContain("id");
      expect(keys).toContain("username");
      expect(keys).toContain("email");
    });

    test("should intercept property changes", async () => {
      const user = await uow.users.find({ id: 1 });

      const originalUsername = user!.username;

      user!.username = "changed";

      expect(user!.username).toBe("changed");
      expect(uow.getStats().pendingChanges).toBe(1);
    });

    test("should handle null and undefined values", async () => {
      const user = await uow.users.find({ id: 1 });

      user!.email = null;
      expect(user!.email).toBeNull();
      expect(uow.getStats().pendingChanges).toBe(1);
    });

    test("should not interfere with array operations", async () => {
      const users = await uow.users.find({ id: [1, 2, 3] });

      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBe(3);
      expect(users.map((u) => u.username)).toContain("alice");
    });
  });

  describe("Statistics and Monitoring", () => {
    test("should provide accurate statistics", async () => {
      const users = await uow.users.find({ id: [1, 2, 3] });
      const checkpoint = uow.setCheckpoint();

      users[0]!.username = "modified";

      const stats = uow.getStats();

      expect(stats.trackedEntities).toBe(3);
      expect(stats.identityMapSize).toBe(3);
      expect(stats.checkpointCount).toBe(1);
      expect(stats.pendingChanges).toBe(1);
    });

    test("should reset statistics after clear", async () => {
      await uow.users.find({ id: [1, 2, 3] });
      uow.setCheckpoint();

      uow.clear();

      const stats = uow.getStats();
      expect(stats.trackedEntities).toBe(0);
      expect(stats.identityMapSize).toBe(0);
      expect(stats.checkpointCount).toBe(0);
      expect(stats.pendingChanges).toBe(0);
    });
  });

  describe("Memory Management", () => {
    test("should clear all caches", async () => {
      await uow.users.find({ id: [1, 2, 3] });
      const user = await uow.users.find({ id: 1 });
      user!.username = "modified";
      uow.setCheckpoint();

      expect(uow.getStats().trackedEntities).toBeGreaterThan(0);
      expect(uow.getStats().pendingChanges).toBeGreaterThan(0);

      uow.clear();

      const stats = uow.getStats();
      expect(stats.trackedEntities).toBe(0);
      expect(stats.identityMapSize).toBe(0);
      expect(stats.checkpointCount).toBe(0);
      expect(stats.pendingChanges).toBe(0);
    });
  });
});

describe("Integration Tests - New API", () => {
  let testDb: TestDatabase;
  let uow: CreateUowReturnType<BunSQLiteDatabase<typeof testSchema>>;

  beforeEach(async () => {
    testDb = new TestDatabase();
    await testDb.setup();
    uow = new UnitOfWork(
      testDb.getDrizzleInstance(),
      testDb.getAdapter()
    ) as never;
  });

  afterEach(() => {
    uow.clear();
    testDb.close();
  });

  test("complete workflow: query -> modify -> save", async () => {
    // Query
    const user = await uow.users.find({ id: 1 });
    expect(user).toBeDefined();
    expect(uow.getStats().trackedEntities).toBe(1);

    // Modify
    user!.username = "alice_workflow";
    user!.email = "alice_workflow@example.com";
    expect(uow.getStats().pendingChanges).toBe(1);

    // Save
    await uow.save();
    expect(uow.getStats().pendingChanges).toBe(0);

    // Verify in database
    const savedUser = await testDb.getDrizzleInstance().query.users.findFirst({
      where: (users, { eq }) => eq(users.id, user!.id),
    });
    expect(savedUser?.username).toBe("alice_workflow");
    expect(savedUser?.email).toBe("alice_workflow@example.com");
  });

  test("complete workflow with checkpoints", async () => {
    // Setup
    const users = await uow.users.find({ id: [1, 2, 3] });

    // Modify first user
    users[0]!.username = "alice_cp1";
    
    // Create checkpoint1 AFTER the modification
    const checkpoint1 = uow.setCheckpoint();
    
    // Save at checkpoint1 - this should save users[0] with "alice_cp1"
    await uow.save(checkpoint1);

    // Modify second user
    users[1]!.username = "bob_cp2";
    
    // Create checkpoint2 AFTER modifying second user
    const checkpoint2 = uow.setCheckpoint();

    // Third change (after checkpoint2)
    users[2]!.username = "charlie_no_cp";

    // At this point:
    // - users[0] should be unchanged (saved at checkpoint1)
    // - users[1] should be modified ("bob_cp2")
    // - users[2] should be modified ("charlie_no_cp")
    expect(uow.getStats().pendingChanges).toBe(2);

    // Rollback to checkpoint2
    uow.rollback(checkpoint2);

    // After rollback:
    // - users[0] should still be "alice_cp1" (was saved)
    // - users[1] should still be "bob_cp2" (was at checkpoint2)
    // - users[2] should be "charlie" (rolled back)
    expect(users[0]?.username).toBe("alice_cp1");
    expect(users[1]?.username).toBe("bob_cp2");
    expect(users[2]?.username).toBe("charlie");
    expect(uow.getStats().pendingChanges).toBe(1); // Only users[1] is modified

    // Verify database state
    const dbUsers = await testDb.getDrizzleInstance().query.users.findMany({
      orderBy: (users, { asc }) => asc(users.id),
    });
    expect(dbUsers[0]?.username).toBe("alice_cp1"); // Saved at checkpoint1
    expect(dbUsers[1]?.username).toBe("bob"); // Not saved yet
    expect(dbUsers[2]?.username).toBe("charlie"); // Not saved
  });

  test("batch operations with mixed changes", async () => {
    const users = await uow.users.find({ id: [1, 2, 3] });

    // Mix of modifications
    users[0]!.username = "alice_batch";
    users[1]!.email = "bob_batch@example.com";
    users[2]!.username = "charlie_batch";
    users[2]!.email = "charlie_batch@example.com";

    expect(uow.getStats().pendingChanges).toBe(3);

    await uow.save();

    // Verify all changes were saved
    const updatedUsers = await testDb
      .getDrizzleInstance()
      .query.users.findMany({
        orderBy: (users, { asc }) => asc(users.id),
      });

    expect(updatedUsers[0]?.username).toBe("alice_batch");
    expect(updatedUsers[1]?.email).toBe("bob_batch@example.com");
    expect(updatedUsers[2]?.username).toBe("charlie_batch");
    expect(updatedUsers[2]?.email).toBe("charlie_batch@example.com");
  });

  test("performance under load", async () => {
    const startTime = Date.now();

    // Create many entities
    const users = await uow.users.find({ id: [1, 2, 3] });

    // Make many changes
    for (let i = 0; i < 100; i++) {
      const userIndex = i % users.length;
      users[userIndex]!.username = `user_${i}`;
    }

    expect(uow.getStats().pendingChanges).toBe(users.length);

    // Save all changes
    await uow.save();

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should complete in reasonable time (less than 1 second)
    expect(duration).toBeLessThan(1000);
    expect(uow.getStats().pendingChanges).toBe(0);
  });

  test("memory management under stress", async () => {
    // Create many checkpoints and changes
    for (let i = 0; i < 60; i++) {
      // More than the 50 checkpoint limit
      await uow.users.find({ id: [1, 2, 3] });
      uow.setCheckpoint();
      uow.clear(); // Simulate cleanup cycles
    }

    // Should not exceed checkpoint limit
    expect(uow.getStats().checkpointCount).toBeLessThanOrEqual(50);

    // Should still be functional
    const user = await uow.users.find({ id: 1 });
    expect(user).toBeDefined();
  });
});