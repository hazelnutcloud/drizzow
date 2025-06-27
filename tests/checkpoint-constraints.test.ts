import { describe, test, expect, beforeEach } from "bun:test";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";
import { UnitOfWork } from "./uow";
import { SQLiteAdapter } from "./bun-sqlite/sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CreateUowReturnType } from "./bun-sqlite";

// Define schema
const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
  email: text().notNull(),
});

const posts = sqliteTable("posts", {
  id: integer().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  content: text().notNull(),
  userId: integer("user_id").notNull(),
});

const schema = { users, posts };

describe("Checkpoint Constraints", () => {
  let sqlite: Database;
  let db: BunSQLiteDatabase<typeof schema>;
  let uow: CreateUowReturnType<BunSQLiteDatabase<typeof schema>>;

  beforeEach(() => {
    // Create database
    sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL
      );
      
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);

    // Create UoW instance
    const adapter = new SQLiteAdapter(db);
    uow = new UnitOfWork(db, adapter) as never;
  });

  test("should create checkpoints and track entity states", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    expect(user).toBeDefined();

    user!.username = "modified1";
    const checkpoint1 = uow.setCheckpoint();
    expect(checkpoint1).toBe(1);

    user!.username = "modified2";
    const checkpoint2 = uow.setCheckpoint();
    expect(checkpoint2).toBe(2);

    user!.username = "modified3";
    const checkpoint3 = uow.setCheckpoint();
    expect(checkpoint3).toBe(3);

    expect(uow.getStats().checkpointCount).toBe(3);
  });

  test("should not allow reverting to checkpoint before last persisted checkpoint", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    user!.username = "modified1";

    const checkpoint1 = uow.setCheckpoint();
    user!.username = "modified2";

    const checkpoint2 = uow.setCheckpoint();
    user!.username = "modified3";

    const checkpoint3 = uow.setCheckpoint();

    // Persist at checkpoint2
    await uow.save(checkpoint2);

    // Try to revert to checkpoint1 (should fail)
    const rollbackResult = uow.rollback(checkpoint1);
    expect(rollbackResult.error).toBeDefined();
    expect(rollbackResult.error).toContain(
      "Cannot revert to checkpoint 1 because it is before the last persisted checkpoint 2"
    );
  });

  test("should allow reverting to the same checkpoint that was persisted", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    user!.username = "modified1";

    const checkpoint1 = uow.setCheckpoint();
    user!.username = "modified2";

    const checkpoint2 = uow.setCheckpoint();

    // Persist at checkpoint2
    await uow.save(checkpoint2);

    // Revert to checkpoint2 (should succeed)
    const rollbackResult = uow.rollback(checkpoint2);
    expect(rollbackResult.error).toBeNull();
  });

  test("should not allow persisting to checkpoint after last reverted checkpoint", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    user!.username = "modified1";

    const checkpoint1 = uow.setCheckpoint();
    user!.username = "modified2";

    const checkpoint2 = uow.setCheckpoint();
    user!.username = "modified3";

    const checkpoint3 = uow.setCheckpoint();

    // Revert to checkpoint2
    const rollbackResult = uow.rollback(checkpoint2);
    expect(rollbackResult.error).toBeNull();

    // Try to persist at checkpoint3 (should fail)
    expect(uow.save(checkpoint3)).rejects.toThrow(
      "Cannot persist to checkpoint 3 because it is after the last reverted checkpoint 2"
    );
  });

  test("should allow persisting to the same checkpoint that was reverted to", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    user!.username = "modified1";

    const checkpoint1 = uow.setCheckpoint();
    user!.username = "modified2";

    const checkpoint2 = uow.setCheckpoint();

    // Persist at checkpoint2
    await uow.save(checkpoint2);

    // Revert to checkpoint2
    const rollbackResult = uow.rollback(checkpoint2);
    expect(rollbackResult.error).toBeNull();

    // Persist at checkpoint2 again (should succeed)
    expect(uow.save(checkpoint2)).resolves.toBeUndefined();
  });

  test("should handle complex checkpoint scenarios", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    const originalUsername = user!.username;

    // Create multiple checkpoints
    user!.username = "state1";
    const cp1 = uow.setCheckpoint();

    user!.username = "state2";
    const cp2 = uow.setCheckpoint();

    user!.username = "state3";
    const cp3 = uow.setCheckpoint();

    user!.username = "state4";
    const cp4 = uow.setCheckpoint();

    // Persist at cp2
    await uow.save(cp2);

    // Can't revert to cp1
    expect(uow.rollback(cp1).error).toBeDefined();

    // Can revert to cp2, cp3, or cp4
    expect(uow.rollback(cp3).error).toBeNull();
    expect(user!.username).toBe("state3");

    // After reverting to cp3, can't persist at cp4
    expect(uow.save(cp4)).rejects.toThrow();

    // But can persist at cp1, cp2, or cp3
    expect(uow.save(cp2)).resolves.toBeUndefined();
  });

  test("should maintain checkpoint state after clearing and creating new checkpoints", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();
    user!.username = "modified1";

    const checkpoint1 = uow.setCheckpoint();
    user!.username = "modified2";

    const checkpoint2 = uow.setCheckpoint();

    // Persist at checkpoint2
    await uow.save(checkpoint2);

    // Clear UoW
    uow.clear();

    // Create new checkpoint (should reset checkpoint IDs)
    const user2 = await uow.users.findFirst();
    user2!.username = "afterClear";

    const newCheckpoint = uow.setCheckpoint();
    expect(newCheckpoint).toBe(1); // Should start from 1 again

    // Should be able to persist at new checkpoint
    expect(uow.save(newCheckpoint)).resolves.toBeUndefined();
  });

  test("should properly track changes when saving to checkpoints", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com'), ('user2', 'user2@example.com'), ('user3', 'user3@example.com')`
    );

    // Load first two users
    const user1 = await uow.users.findFirst({
      where: (users, { eq }) => eq(users.id, 1),
    });
    const user2 = await uow.users.findFirst({
      where: (users, { eq }) => eq(users.id, 2),
    });

    // Modify them
    user1!.username = "user1_modified";
    user2!.username = "user2_modified";

    // Create checkpoint
    const checkpoint = uow.setCheckpoint();

    // Load and modify third user after checkpoint
    const user3 = await uow.users.findFirst({
      where: (users, { eq }) => eq(users.id, 3),
    });
    user3!.username = "user3_modified";

    // Save to checkpoint (should only save user1 and user2)
    await uow.save(checkpoint);

    // Check database state
    const dbUsers = await db.query.users.findMany();
    expect(dbUsers.find((u) => u.id === 1)?.username).toBe("user1_modified");
    expect(dbUsers.find((u) => u.id === 2)?.username).toBe("user2_modified");
    expect(dbUsers.find((u) => u.id === 3)?.username).toBe("user3"); // Should not be modified

    // user3 should still have pending changes
    expect(uow.getStats().pendingChanges).toBe(1);
  });

  test("should handle checkpoint not found errors", async () => {
    // Try to save to non-existent checkpoint
    expect(uow.save(999)).rejects.toThrow("Checkpoint 999 not found");

    // Try to rollback to non-existent checkpoint
    const rollbackResult = uow.rollback(999);
    expect(rollbackResult.error).toBeDefined();
    expect(rollbackResult.error).toContain("Checkpoint 999 not found");
  });

  test("should handle checkpoint limit correctly", async () => {
    // Insert test data
    sqlite.exec(
      `INSERT INTO users (username, email) VALUES ('test1', 'test1@example.com')`
    );

    const user = await uow.users.findFirst();

    // Create many checkpoints (more than the limit of 50)
    const checkpointIds = [];
    for (let i = 0; i < 60; i++) {
      user!.username = `state${i}`;
      checkpointIds.push(uow.setCheckpoint());
    }

    // Should only keep the last 50 checkpoints
    expect(uow.getStats().checkpointCount).toBeLessThanOrEqual(50);

    // Oldest checkpoints should not be available
    const oldestCheckpointResult = uow.rollback(checkpointIds[0]!);
    expect(oldestCheckpointResult.error).toBeDefined();

    // Recent checkpoints should be available
    const recentCheckpointResult = uow.rollback(
      checkpointIds[checkpointIds.length - 1]!
    );
    expect(recentCheckpointResult.error).toBeNull();
  });

  test("should handle interleaved saves and rollbacks", async () => {
    // Insert test data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com'), ('user2', 'user2@example.com'), ('user3', 'user3@example.com')`);
    
    const users = await uow.users.findMany();
    
    // Modify user1
    users[0]!.username = "user1_v1";
    const cp1 = uow.setCheckpoint();
    
    // Modify user2
    users[1]!.username = "user2_v1";
    const cp2 = uow.setCheckpoint();
    
    // Save at cp1 (only user1 changes)
    await uow.save(cp1);
    
    // Modify user3
    users[2]!.username = "user3_v1";
    const cp3 = uow.setCheckpoint();
    
    // Rollback to cp2 (should restore user3, keep user1 and user2)
    uow.rollback(cp2);
    
    expect(users[0]!.username).toBe("user1_v1"); // Saved at cp1
    expect(users[1]!.username).toBe("user2_v1"); // At cp2
    expect(users[2]!.username).toBe("user3"); // Rolled back
    
    // Should be able to save at cp2 (same as rollback point)
    await expect(uow.save(cp2)).resolves.toBeUndefined();
    
    // Verify database state
    const dbUsers = await db.query.users.findMany({ orderBy: (users: any, { asc }: any) => asc(users.id) });
    expect(dbUsers.find((u: any) => u.id === 1)?.username).toBe("user1_v1"); // Saved at cp1
    expect(dbUsers.find((u: any) => u.id === 2)?.username).toBe("user2_v1"); // Saved at cp2
    expect(dbUsers.find((u: any) => u.id === 3)?.username).toBe("user3"); // Never saved
  });

  test("should handle multiple saves to different checkpoints", async () => {
    // Insert test data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com'), ('user2', 'user2@example.com')`);
    
    const users = await uow.users.findMany();
    
    // First set of changes
    users[0]!.username = "user1_cp1";
    const cp1 = uow.setCheckpoint();
    
    users[1]!.username = "user2_cp2";
    const cp2 = uow.setCheckpoint();
    
    users[0]!.email = "user1_cp3@example.com";
    const cp3 = uow.setCheckpoint();
    
    // Save at cp1 (only username change for user1)
    await uow.save(cp1);
    
    // Save at cp3 (should include all changes up to cp3)
    await uow.save(cp3);
    
    // Verify final state
    const dbUsers = await db.query.users.findMany({ orderBy: (users: any, { asc }: any) => asc(users.id) });
    expect(dbUsers.find((u: any) => u.id === 1)?.username).toBe("user1_cp1");
    expect(dbUsers.find((u: any) => u.id === 1)?.email).toBe("user1_cp3@example.com");
    expect(dbUsers.find((u: any) => u.id === 2)?.username).toBe("user2_cp2");
    
    // All entities should be unchanged now
    expect(uow.getStats().pendingChanges).toBe(0);
  });

  test("should handle rollback after partial saves", async () => {
    // Insert test data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com'), ('user2', 'user2@example.com'), ('user3', 'user3@example.com')`);
    
    const users = await uow.users.findMany();
    
    // Checkpoint with all original data
    const cp0 = uow.setCheckpoint();
    
    // Modify all users
    users[0]!.username = "user1_modified";
    users[1]!.username = "user2_modified";
    users[2]!.username = "user3_modified";
    
    const cp1 = uow.setCheckpoint();
    
    // Save only user1's changes
    await uow.save(cp0); // No changes at cp0, nothing saved
    
    // Now save at cp1
    await uow.save(cp1);
    
    // Make more changes
    users[0]!.email = "user1_new@example.com";
    users[1]!.email = "user2_new@example.com";
    const cp2 = uow.setCheckpoint();
    
    // Rollback to cp1
    uow.rollback(cp1);
    
    // Usernames should be as they were at cp1, emails should be rolled back
    expect(users[0]!.username).toBe("user1_modified");
    expect(users[0]!.email).toBe("user1@example.com");
    expect(users[1]!.username).toBe("user2_modified");
    expect(users[1]!.email).toBe("user2@example.com");
    
    // All should be unchanged since they were saved at cp1
    expect(uow.getStats().pendingChanges).toBe(0);
  });

  test("should handle entity additions and deletions with checkpoints", async () => {
    // Insert initial data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('existing1', 'existing1@example.com'), ('existing2', 'existing2@example.com')`);
    
    const existingUsers = await uow.users.findMany();
    
    // Modify existing user
    existingUsers[0]!.username = "existing1_modified";
    const cp1 = uow.setCheckpoint();
    
    // Note: Since we can't test entity creation/deletion with current API,
    // we'll simulate by tracking a new entity loaded after checkpoint
    
    // Load a specific user that we'll treat as "new" for this test
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('new_user', 'new@example.com')`);
    const newUser = await uow.users.findFirst({ where: (users: any, { eq }: any) => eq(users.username, 'new_user') });
    
    newUser!.username = "new_user_modified";
    const cp2 = uow.setCheckpoint();
    
    // Save at cp1 (should only save existing1_modified)
    await uow.save(cp1);
    
    // Verify what was saved
    const dbUsers = await db.query.users.findMany({ orderBy: (users: any, { asc }: any) => asc(users.id) });
    expect(dbUsers.find((u: any) => u.id === 1)?.username).toBe("existing1_modified");
    expect(dbUsers.find((u: any) => u.id === 3)?.username).toBe("new_user"); // Not modified at cp1
    
    // Rollback to cp1
    uow.rollback(cp1);
    
    // After rollback to cp1:
    // - existingUsers[0] should still be "existing1_modified" (was saved)
    // - existingUsers[1] should be "existing2" (rolled back to cp1 state)
    // - newUser is no longer tracked (wasn't tracked at cp1)
    expect(existingUsers[0]!.username).toBe("existing1_modified"); // Was saved
    expect(existingUsers[1]!.username).toBe("existing2"); // Rolled back
    
    // The new user entity still has its modified value because it's not being tracked anymore
    // This is expected behavior - entities loaded after a checkpoint are not part of that checkpoint
    expect(newUser!.username).toBe("new_user_modified"); // Not tracked, so not rolled back
  });

  test("should handle checkpoint state across clear operations", async () => {
    // Insert test data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com')`);
    
    const user = await uow.users.findFirst();
    user!.username = "modified1";
    
    const cp1 = uow.setCheckpoint();
    await uow.save(cp1);
    
    // Clear should reset checkpoint state
    uow.clear();
    
    // Load user again
    const userAgain = await uow.users.findFirst();
    userAgain!.username = "modified2";
    
    const cp2 = uow.setCheckpoint();
    
    // Should be able to save at new checkpoint (no constraints from previous session)
    await expect(uow.save(cp2)).resolves.toBeUndefined();
    
    // Should not be able to rollback to old checkpoint
    const rollbackResult = uow.rollback(cp1);
    expect(rollbackResult.error).toBeDefined();
  });

  test("should handle rapid checkpoint creation and deletion", async () => {
    // Insert test data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com')`);
    
    const user = await uow.users.findFirst();
    const checkpoints = [];
    
    // Rapidly create many checkpoints with small changes
    for (let i = 0; i < 10; i++) {
      user!.username = `state_${i}`;
      checkpoints.push(uow.setCheckpoint());
      
      if (i % 3 === 0) {
        // Save every 3rd checkpoint
        await uow.save(checkpoints[i]!);
      }
    }
    
    // Try to rollback to various checkpoints
    // Should not be able to rollback to checkpoints before the last save
    const lastSavedIndex = 9; // Last checkpoint that was saved
    
    // This should fail (before last saved)
    const result1 = uow.rollback(checkpoints[6]!);
    expect(result1.error).toBeDefined();
    
    // This should succeed (the last saved checkpoint)
    const result2 = uow.rollback(checkpoints[9]!);
    expect(result2.error).toBeNull();
  });

  test("should maintain consistency with circular checkpoint operations", async () => {
    // Insert test data
    sqlite.exec(`INSERT INTO users (username, email) VALUES ('user1', 'user1@example.com'), ('user2', 'user2@example.com')`);
    
    const users = await uow.users.findMany();
    
    // Create a series of checkpoints
    users[0]!.username = "v1";
    const cp1 = uow.setCheckpoint();
    
    users[1]!.username = "v2";
    const cp2 = uow.setCheckpoint();
    
    users[0]!.username = "v3";
    const cp3 = uow.setCheckpoint();
    
    // Save at cp2
    await uow.save(cp2);
    
    // Rollback to cp3 (after save point)
    uow.rollback(cp3);
    
    // Make new changes
    users[1]!.username = "v4";
    const cp4 = uow.setCheckpoint();
    
    // Try to save at cp1 (should fail - before last saved)
    await expect(uow.save(cp1)).rejects.toThrow();
    
    // Try to save at cp4 (should also fail - after last reverted)
    await expect(uow.save(cp4)).rejects.toThrow();
    
    // Can only save at cp3 (the exact checkpoint we reverted to)
    await expect(uow.save(cp3)).resolves.toBeUndefined();
    
    // Verify final state
    expect(users[0]!.username).toBe("v3");
    expect(users[1]!.username).toBe("v4"); // v4 is still in memory, just couldn't save at cp4
    
    // Verify database state
    const dbUsers = await db.query.users.findMany({ orderBy: (users: any, { asc }: any) => asc(users.id) });
    expect(dbUsers[0]!.username).toBe("v3"); // Saved at cp3
    expect(dbUsers[1]!.username).toBe("v2"); // Saved at cp2, not updated to v4
  });
});
