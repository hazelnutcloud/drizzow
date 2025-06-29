import { describe, it, expect, beforeEach } from "bun:test";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { createUow, type CreateUowReturnType } from "../src/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Define test schema
const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
  email: text(),
  age: integer(),
});

const posts = sqliteTable("posts", {
  id: integer().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  content: text(),
  authorId: integer().references(() => users.id),
  published: integer({ mode: "boolean" }).default(false),
});

const schema = { users, posts };

describe("Checkpoint and Rollback System", () => {
  let db: BunSQLiteDatabase<typeof schema>;
  let uow: CreateUowReturnType<BunSQLiteDatabase<typeof schema>>;

  beforeEach(async () => {
    // Create in-memory database
    const sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT,
        age INTEGER
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        authorId INTEGER REFERENCES users(id),
        published INTEGER DEFAULT 0
      );
    `);

    // Insert test data
    await db.insert(schema.users).values([
      { username: "alice", email: "alice@example.com", age: 25 },
      { username: "bob", email: "bob@example.com", age: 30 },
      { username: "charlie", email: "charlie@example.com", age: 35 },
    ]);

    await db.insert(schema.posts).values([
      { title: "Post 1", content: "Content 1", authorId: 1, published: true },
      { title: "Post 2", content: "Content 2", authorId: 2, published: false },
      { title: "Post 3", content: "Content 3", authorId: 1, published: true },
    ]);

    // Create UoW instance
    uow = createUow(db);
  });

  describe("Basic Checkpoint Operations", () => {
    it("should create and retrieve checkpoints", () => {
      const cp1 = uow.setCheckpoint();
      const cp2 = uow.setCheckpoint();
      const cp3 = uow.setCheckpoint();

      expect(cp1).toBeLessThan(cp2);
      expect(cp2).toBeLessThan(cp3);

      // Check stats reflect checkpoint count
      const stats = uow.getStats();
      expect(stats.checkpointCount).toBeGreaterThanOrEqual(3);
    });

    it("should track entity counts with checkpoints", async () => {
      // Initial stats
      let stats = uow.getStats();
      const initialTracked = stats.trackedEntities;

      // Load some entities
      await uow.users.find({ id: 1 });
      await uow.users.find({ id: 2 });
      await uow.posts.find({ id: 1 });

      const checkpoint = uow.setCheckpoint();
      
      // Check stats after loading entities
      stats = uow.getStats();
      expect(stats.trackedEntities).toBe(initialTracked + 3); // 2 users + 1 post
      expect(stats.identityMapSize).toBeGreaterThanOrEqual(3);
    });

    it("should handle rollback to non-existent checkpoint", () => {
      const result = uow.rollback(999);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Checkpoint 999 not found");
    });
  });

  describe("Simple Rollback Scenarios", () => {
    it("should rollback single entity modification", async () => {
      const user = await uow.users.find({ id: 1 });
      const originalUsername = user!.username;
      const originalEmail = user!.email;

      const checkpoint = uow.setCheckpoint();

      // Modify entity
      user!.username = "modified_username";
      user!.email = "modified@example.com";

      // Rollback
      uow.rollback(checkpoint);

      // Check entity is restored
      expect(user!.username).toBe(originalUsername);
      expect(user!.email).toBe(originalEmail || null);
    });

    it("should rollback multiple entity modifications", async () => {
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });
      const post1 = await uow.posts.find({ id: 1 });

      const originalUser1 = { 
        username: user1!.username, 
        age: user1!.age, 
        email: user1!.email 
      };
      const originalUser2 = { 
        username: user2!.username, 
        email: user2!.email,
        age: user2!.age
      };
      const originalPost1 = { 
        title: post1!.title, 
        published: post1!.published,
        content: post1!.content
      };

      const checkpoint = uow.setCheckpoint();

      // Modify multiple entities
      user1!.username = "modified1";
      user1!.age = 100;
      user2!.email = "newemail@example.com";
      post1!.title = "Modified Title";
      post1!.published = false;

      // Rollback
      uow.rollback(checkpoint);

      // Check all entities are restored
      expect(user1!.username).toBe(originalUser1.username);
      expect(user1!.age).toBe(originalUser1.age || null);
      expect(user2!.email).toBe(originalUser2.email || null);
      expect(post1!.title).toBe(originalPost1.title);
      expect(post1!.published).toBe(originalPost1.published || false);
    });

    it("should rollback entity creation", async () => {
      const checkpoint = uow.setCheckpoint();

      // Create new entities after checkpoint
      const newUser = uow.users.create({
        id: 100,
        username: "newuser",
        email: "new@example.com",
        age: 20,
      });

      const newPost = uow.posts.create({
        id: 100,
        title: "New Post",
        content: "New Content",
        authorId: 100,
      });

      expect(uow.getStats().pendingChanges).toBe(2);

      // Rollback
      uow.rollback(checkpoint);

      // Check entities are removed
      expect(uow.getStats().pendingChanges).toBe(0);
      
      // Try to find the created entities - should not exist
      const foundUser = await uow.users.find({ id: 100 });
      const foundPost = await uow.posts.find({ id: 100 });
      
      expect(foundUser).toBeUndefined();
      expect(foundPost).toBeUndefined();
    });

    it("should rollback entity deletion", async () => {
      const user = await uow.users.find({ id: 3 });
      const post = await uow.posts.find({ id: 2 });

      const checkpoint = uow.setCheckpoint();

      // Delete entities
      uow.users.delete(user!);
      uow.posts.delete(post!);

      expect(uow.getStats().pendingChanges).toBe(2);

      // Rollback
      uow.rollback(checkpoint);

      // Check entities are restored
      expect(uow.getStats().pendingChanges).toBe(0);
      
      // Entities should be findable again
      const restoredUser = await uow.users.find({ id: 3 });
      const restoredPost = await uow.posts.find({ id: 2 });
      
      expect(restoredUser).toBeDefined();
      expect(restoredPost).toBeDefined();
      expect(restoredUser!.username).toBe("charlie");
      expect(restoredPost!.title).toBe("Post 2");
    });
  });

  describe("Multiple Checkpoint Scenarios", () => {
    it("should handle nested checkpoints with modifications", async () => {
      const user = await uow.users.find({ id: 1 });
      const originalUsername = user!.username;

      // First checkpoint
      const cp1 = uow.setCheckpoint();
      
      user!.username = "first_modification";
      
      // Second checkpoint
      const cp2 = uow.setCheckpoint();
      
      user!.username = "second_modification";
      
      // Third checkpoint
      const cp3 = uow.setCheckpoint();
      
      user!.username = "third_modification";

      // Rollback to second checkpoint
      uow.rollback(cp2);
      expect(user!.username).toBe("first_modification");

      // Rollback to first checkpoint
      uow.rollback(cp1);
      expect(user!.username).toBe(originalUsername);
    });

    it("should handle mixed operations across multiple checkpoints", async () => {
      // Initial state
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });

      // Checkpoint 1
      const cp1 = uow.setCheckpoint();

      // Create new user
      const newUser = uow.users.create({
        id: 100,
        username: "checkpoint_user",
        email: "cp@example.com",
      });

      // Modify existing user
      user1!.username = "modified_at_cp1";

      // Checkpoint 2
      const cp2 = uow.setCheckpoint();

      // Delete user2
      uow.users.delete(user2!);

      // Modify the created user
      newUser.email = "modified@example.com";

      // Checkpoint 3
      const cp3 = uow.setCheckpoint();

      // More modifications
      user1!.email = "final@example.com";

      // Rollback to cp2 - should undo deletion and final modifications
      uow.rollback(cp2);

      expect(await uow.users.find({ id: 2 })).toBeDefined(); // User2 restored
      expect(user1!.email).not.toBe("final@example.com"); // Final mod undone
      expect(newUser.email).toBe("cp@example.com"); // Created user mod undone

      // Rollback to cp1 - should undo creation and first modification
      uow.rollback(cp1);

      expect(await uow.users.find({ id: 100 })).toBeUndefined(); // Created user gone
      expect(user1!.username).toBe("alice"); // Original username restored
    });

    it("should handle selective checkpoint saves", async () => {
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });
      const user3 = await uow.users.find({ id: 3 });

      // Modify user1
      user1!.username = "checkpoint1_mod";
      const cp1 = uow.setCheckpoint();

      // Modify user2
      user2!.username = "checkpoint2_mod";
      const cp2 = uow.setCheckpoint();

      // Modify user3
      user3!.username = "checkpoint3_mod";

      // Save only up to checkpoint 2
      await uow.save(cp2);

      // Verify in database
      const dbUser1 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      const dbUser2 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 2),
      });
      const dbUser3 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 3),
      });

      expect(dbUser1?.username).toBe("checkpoint1_mod");
      expect(dbUser2?.username).toBe("checkpoint2_mod");
      expect(dbUser3?.username).toBe("charlie"); // Not saved
    });
  });

  describe("Complex Rollback Scenarios", () => {
    it("should handle rollback with entity relationships", async () => {
      const user = await uow.users.find({ id: 1 });
      const userPosts = await uow.posts.find({ id: [1, 3] }); // User 1's posts

      const checkpoint = uow.setCheckpoint();

      // Modify user
      user!.username = "author_modified";

      // Modify user's posts
      userPosts.forEach((post) => {
        post.title = `Modified: ${post.title}`;
        post.published = false;
      });

      // Create new post for user
      const newPost = uow.posts.create({
        id: 100,
        title: "New Post After Checkpoint",
        content: "Content",
        authorId: 1,
      });

      // Rollback
      uow.rollback(checkpoint);

      // Check user is restored
      expect(user!.username).toBe("alice");

      // Check posts are restored
      const post1 = await uow.posts.find({ id: 1 });
      const post3 = await uow.posts.find({ id: 3 });
      expect(post1!.title).toBe("Post 1");
      expect(post3!.title).toBe("Post 3");
      expect(post1!.published).toBe(true);
      expect(post3!.published).toBe(true);

      // Check new post is gone
      const foundNewPost = await uow.posts.find({ id: 100 });
      expect(foundNewPost).toBeUndefined();
    });

    it("should handle create -> modify -> delete sequence with rollback", async () => {
      const checkpoint1 = uow.setCheckpoint();

      // Create entity
      const newUser = uow.users.create({
        id: 200,
        username: "temp_user",
        email: "temp@example.com",
        age: 25,
      });

      const checkpoint2 = uow.setCheckpoint();

      // Modify created entity
      newUser.username = "modified_temp_user";
      newUser.age = 30;

      const checkpoint3 = uow.setCheckpoint();

      // Delete the entity
      uow.users.delete(newUser);

      // Rollback to checkpoint3 (before delete)
      uow.rollback(checkpoint3);
      let found = await uow.users.find({ id: 200 });
      expect(found).toBeDefined();
      expect(found!.username).toBe("modified_temp_user");
      expect(found!.age).toBe(30);

      // Rollback to checkpoint2 (before modify)
      uow.rollback(checkpoint2);
      found = await uow.users.find({ id: 200 });
      expect(found).toBeDefined();
      expect(found!.username).toBe("temp_user");
      expect(found!.age).toBe(25);

      // Rollback to checkpoint1 (before create)
      uow.rollback(checkpoint1);
      found = await uow.users.find({ id: 200 });
      expect(found).toBeUndefined();
    });

    it("should handle partial rollback with saves", async () => {
      const user = await uow.users.find({ id: 1 });
      
      // Make first change
      user!.username = "first_change";
      const cp1 = uow.setCheckpoint();
      
      // Make second change
      user!.username = "second_change";
      const cp2 = uow.setCheckpoint();
      
      // Make third change
      user!.username = "third_change";
      
      // Save up to cp1
      await uow.save(cp1);
      
      // Verify database has first change
      let dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser?.username).toBe("first_change");
      
      // In-memory state should still have third change
      expect(user!.username).toBe("third_change");
      
      // Rollback to cp2
      uow.rollback(cp2);
      expect(user!.username).toBe("second_change");
      
      // Save everything
      await uow.save();
      
      // Verify database has second change
      dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser?.username).toBe("second_change");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle rollback to non-existent checkpoint", () => {
      const result = uow.rollback(999);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Checkpoint 999 not found");
    });

    it("should handle rollback with no checkpoints", () => {
      const result = uow.rollback(1);
      expect(result.error).toBeDefined();
    });

    it("should handle checkpoint after rollback", async () => {
      const user = await uow.users.find({ id: 1 });
      
      const cp1 = uow.setCheckpoint();
      user!.username = "modified";
      
      const cp2 = uow.setCheckpoint();
      user!.email = "modified@example.com";
      
      // Rollback to cp1
      uow.rollback(cp1);
      
      // Create new checkpoint after rollback
      const cp3 = uow.setCheckpoint();
      
      // After rollback, stats should reflect the state
      const stats = uow.getStats();
      expect(stats.checkpointCount).toBeGreaterThanOrEqual(2); // At least cp1 and cp3
      
      // User should be in cp1 state (rollback restores to checkpoint state)
      expect(user!.username).toBe("alice"); // Rollback to cp1 restores original
      expect(user!.email).toBe("alice@example.com"); // Original email
    });

    it("should handle entity state after failed save", async () => {
      const user = await uow.users.find({ id: 1 });
      const checkpoint = uow.setCheckpoint();
      
      // Make invalid modification that would fail on save
      user!.username = ""; // Empty username should fail NOT NULL constraint
      
      try {
        await uow.save();
      } catch (error) {
        // Save failed, rollback to checkpoint
        uow.rollback(checkpoint);
        
        // Entity should be restored
        expect(user!.username).toBe("alice");
      }
    });

    it("should handle concurrent modifications with checkpoints", async () => {
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });
      
      // Checkpoint 1
      const cp1 = uow.setCheckpoint();
      
      // Concurrent modifications
      user1!.username = "user1_modified";
      user2!.username = "user2_modified";
      
      // Checkpoint 2
      const cp2 = uow.setCheckpoint();
      
      // More modifications
      user1!.email = "user1_new@example.com";
      user2!.email = "user2_new@example.com";
      
      // Rollback to cp1 should restore both users
      uow.rollback(cp1);
      
      expect(user1!.username).toBe("alice");
      expect(user2!.username).toBe("bob");
      expect(user1!.email).toBe("alice@example.com");
      expect(user2!.email).toBe("bob@example.com");
    });
  });

  describe("Memory Management", () => {
    it("should limit checkpoint count", () => {
      // Create many checkpoints
      const checkpoints: number[] = [];
      for (let i = 0; i < 60; i++) {
        checkpoints.push(uow.setCheckpoint());
      }

      // Check stats to verify checkpoint management
      const stats = uow.getStats();
      expect(stats.checkpointCount).toBeLessThanOrEqual(50);
      
      // Recent checkpoints should still be valid for rollback
      const lastCheckpoint = checkpoints[checkpoints.length - 1];
      const result = uow.rollback(lastCheckpoint);
      expect(result.error).toBeNull();
      
      // Very old checkpoints might be pruned
      const firstCheckpoint = checkpoints[0];
      const oldResult = uow.rollback(firstCheckpoint);
      expect(oldResult.error).toBeDefined();
    });

    it("should track memory usage through stats", async () => {
      // Initial stats
      let stats = uow.getStats();
      const initialEntities = stats.trackedEntities;
      
      // Load entities and create checkpoints
      const users = await uow.users.find({ id: [1, 2, 3] });
      await uow.posts.find({ id: [1, 2, 3] });
      
      const cp1 = uow.setCheckpoint();
      
      // Modify entities
      users.forEach(u => u.username = `modified_${u.username}`);
      
      const cp2 = uow.setCheckpoint();
      
      // Check updated stats
      stats = uow.getStats();
      expect(stats.trackedEntities).toBe(initialEntities + 6); // 3 users + 3 posts
      expect(stats.identityMapSize).toBeGreaterThanOrEqual(6);
      expect(stats.checkpointCount).toBeGreaterThanOrEqual(2);
    });

    it("should clear all state with clear()", async () => {
      // Create state
      await uow.users.find({ id: [1, 2, 3] });
      uow.setCheckpoint();
      uow.setCheckpoint();
      uow.setCheckpoint();
      
      let stats = uow.getStats();
      expect(stats.checkpointCount).toBeGreaterThanOrEqual(3);
      expect(stats.trackedEntities).toBeGreaterThan(0);
      
      // Clear all
      uow.clear();
      
      stats = uow.getStats();
      expect(stats.checkpointCount).toBe(0);
      expect(stats.trackedEntities).toBe(0);
      expect(stats.identityMapSize).toBe(0);
    });
  });

  describe("Integration with Transaction Management", () => {
    it("should handle checkpoint save with transaction rollback", async () => {
      const user = await uow.users.find({ id: 1 });
      
      user!.username = "before_checkpoint";
      const checkpoint = uow.setCheckpoint();
      
      user!.username = "after_checkpoint";
      
      // Simulate transaction failure by making invalid change
      // Try to create a user with empty username (violates NOT NULL)
      const invalidUser = uow.users.create({
        id: 999,
        username: "", // Empty username should violate constraint
      });
      
      try {
        await uow.save();
      } catch (error) {
        // Transaction failed, but checkpoint should still be valid
        // Can still rollback to checkpoint
        uow.rollback(checkpoint);
        expect(user!.username).toBe("before_checkpoint");
      }
    });

    it("should maintain consistency across checkpoint operations", async () => {
      // Complex scenario with multiple entities and operations
      const user1 = await uow.users.find({ id: 1 });
      const user2 = await uow.users.find({ id: 2 });
      const post1 = await uow.posts.find({ id: 1 });
      
      // Initial modifications
      user1!.age = 50;
      post1!.published = false;
      
      const cp1 = uow.setCheckpoint();
      
      // Create new entities
      const newUser = uow.users.create({
        id: 300,
        username: "newuser",
        email: "new@example.com",
      });
      
      const newPost = uow.posts.create({
        id: 300,
        title: "New Post",
        authorId: 300,
      });
      
      // Modify existing
      user2!.username = "bob_modified";
      
      const cp2 = uow.setCheckpoint();
      
      // Delete operations
      uow.users.delete(user1!);
      uow.posts.delete(post1!);
      
      // Save up to cp1 (should save initial modifications only)
      await uow.save(cp1);
      
      // Verify database state
      const dbUser1 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser1?.age).toBe(50);
      
      const dbPost1 = await db.query.posts.findFirst({
        where: (posts, { eq }) => eq(posts.id, 1),
      });
      expect(dbPost1?.published).toBe(false);
      
      // New entities should not be in database
      const dbNewUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 300),
      });
      expect(dbNewUser).toBeUndefined();
      
      // Rollback to cp2 (before deletes)
      uow.rollback(cp2);
      
      // Save everything
      await uow.save();
      
      // Verify final state
      const finalUser1 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(finalUser1).toBeDefined(); // Not deleted
      
      const finalNewUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 300),
      });
      expect(finalNewUser).toBeDefined(); // Created
      expect(finalNewUser?.username).toBe("newuser");
    });
  });
});