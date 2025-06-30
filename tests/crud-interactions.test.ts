import { describe, it, expect, beforeEach } from "bun:test";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { drizzow, type CreateUowReturnType } from "../src/bun-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Define test schema
const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
  email: text(),
});

const posts = sqliteTable("posts", {
  id: integer().primaryKey({ autoIncrement: true }),
  title: text().notNull(),
  content: text(),
  authorId: integer().references(() => users.id),
});

const schema = { users, posts };

describe("CRUD Interactions", () => {
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
        email TEXT
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        authorId INTEGER REFERENCES users(id)
      );
    `);

    // Insert test data
    await db.insert(schema.users).values([
      { username: "alice", email: "alice@example.com" },
      { username: "bob", email: "bob@example.com" },
      { username: "charlie", email: "charlie@example.com" },
    ]);

    await db.insert(schema.posts).values([
      { title: "Post 1", content: "Content 1", authorId: 1 },
      { title: "Post 2", content: "Content 2", authorId: 2 },
    ]);

    // Create UoW instance
    uow = drizzow(db);
  });

  describe("Create -> Find Interactions", () => {
    it("should find newly created entity in same session", async () => {
      // Create a new user
      const newUser = uow.users.create({
        id: 100,
        username: "newuser",
        email: "new@example.com",
      });

      // Should be able to find it immediately (from identity map)
      const foundUser = await uow.users.find({ id: 100 });

      expect(foundUser).toBeDefined();
      expect(foundUser).toBe(newUser); // Same object reference
      expect(foundUser!.username).toBe("newuser");
      expect(foundUser!.email).toBe("new@example.com");
    });

    it("should find created entity after save", async () => {
      // Create and save
      const newUser = uow.users.create({
        id: 101,
        username: "saveduser",
        email: "saved@example.com",
      });
      await uow.save();

      // Clear UoW and create new one to test database persistence
      const newUow = drizzow(db);
      const foundUser = await newUow.users.find({ id: 101 });

      expect(foundUser).toBeDefined();
      expect(foundUser!.username).toBe("saveduser");
      expect(foundUser!.email).toBe("saved@example.com");
    });

    it("should handle create -> find -> modify -> save workflow", async () => {
      // Create
      const newUser = uow.users.create({
        id: 102,
        username: "workflow",
        email: "workflow@example.com",
      });

      // Find (should get same object)
      const foundUser = await uow.users.find({ id: 102 });
      expect(foundUser).toBe(newUser);

      // Modify
      foundUser!.username = "modified_workflow";
      foundUser!.email = "modified@example.com";

      // Save
      await uow.save();

      // Verify in database
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 102),
      });
      expect(dbUser?.username).toBe("modified_workflow");
      expect(dbUser?.email).toBe("modified@example.com");
    });
  });

  describe("Find -> Delete Interactions", () => {
    it("should delete found entity", async () => {
      // Find existing user
      const user = await uow.users.find({ id: 1 });
      expect(user).toBeDefined();

      // Delete it
      uow.users.delete(user!);

      // Save changes
      await uow.save();

      // Verify deletion in database
      const deletedUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(deletedUser).toBeUndefined();
    });

    it("should handle find -> modify -> delete workflow", async () => {
      // Find and modify
      const user = await uow.users.find({ id: 2 });
      expect(user).toBeDefined();

      user!.username = "modified_before_delete";
      expect(uow.getStats().pendingChanges).toBe(1);

      // Delete the modified entity
      uow.users.delete(user!);

      // The delete should override the modification
      expect(uow.getStats().pendingChanges).toBe(1); // Still 1 change (delete)

      // Save
      await uow.save();

      // Verify entity is deleted (not modified)
      const deletedUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 2),
      });
      expect(deletedUser).toBeUndefined();
    });

    it("should not find deleted entity in same session", async () => {
      // Find and delete
      const user = await uow.users.find({ id: 3 });
      expect(user).toBeDefined();

      uow.users.delete(user!);

      const foundAfterDelete = await uow.users.find({ id: 3 });
      expect(foundAfterDelete).toBeUndefined(); // Still in identity map

      // But after save, it should be gone from database
      await uow.save();

      // Create new UoW to test database state
      const newUow = drizzow(db);
      const notFoundInDb = await newUow.users.find({ id: 3 });
      expect(notFoundInDb).toBeUndefined();
    });
  });

  describe("Create -> Delete Interactions", () => {
    it("should handle create -> delete in same session", async () => {
      // Create
      const newUser = uow.users.create({
        id: 200,
        username: "temp",
        email: "temp@example.com",
      });

      // Delete immediately
      uow.users.delete(newUser);

      // Should have 1 pending change (the delete operation)
      expect(uow.getStats().pendingChanges).toBe(1);

      // Save (should be no-op)
      await uow.save();

      // Verify entity was never persisted
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 200),
      });
      expect(dbUser).toBeUndefined();
    });

    it("should handle create -> save -> delete workflow", async () => {
      // Create and save
      const newUser = uow.users.create({
        id: 201,
        username: "create_save_delete",
        email: "csd@example.com",
      });
      await uow.save();

      // Verify it was saved
      let dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 201),
      });
      expect(dbUser).toBeDefined();

      // Create new UoW and reload entity to delete it
      const uow2 = drizzow(db);
      const reloadedUser = await uow2.users.find({ id: 201 });
      expect(reloadedUser).toBeDefined();

      // Delete and save
      uow2.users.delete(reloadedUser!);
      await uow2.save();

      // Verify it was deleted
      dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 201),
      });
      expect(dbUser).toBeUndefined();
    });
  });

  describe("Complex Multi-Entity Interactions", () => {
    it("should handle related entity operations", async () => {
      // Create a new user
      const author = uow.users.create({
        id: 300,
        username: "author",
        email: "author@example.com",
      });

      // Create posts for the new user
      const post1 = uow.posts.create({
        id: 300,
        title: "Author's First Post",
        content: "Content 1",
        authorId: 300,
      });

      const post2 = uow.posts.create({
        id: 301,
        title: "Author's Second Post",
        content: "Content 2",
        authorId: 300,
      });

      // Save all
      await uow.save();

      // Verify in database
      const dbAuthor = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 300),
      });
      expect(dbAuthor).toBeDefined();

      const dbPosts = await db.query.posts.findMany({
        where: (posts, { eq }) => eq(posts.authorId, 300),
      });
      expect(dbPosts).toHaveLength(2);
    });

    it("should handle cascading operations", async () => {
      // Find existing user and their posts
      const user = await uow.users.find({ id: 1 });
      const userPosts = await uow.posts.find({ id: [1] }); // User 1 has post 1

      expect(user).toBeDefined();
      expect(userPosts).toHaveLength(1);

      // Delete user's posts first
      userPosts.forEach((post) => uow.posts.delete(post));

      // Then delete user
      uow.users.delete(user!);

      // Save all changes
      await uow.save();

      // Verify both user and posts are deleted
      const deletedUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(deletedUser).toBeUndefined();

      const deletedPosts = await db.query.posts.findMany({
        where: (posts, { eq }) => eq(posts.authorId, 1),
      });
      expect(deletedPosts).toHaveLength(0);
    });
  });

  describe("Checkpoint Interactions with CRUD", () => {
    it("should handle create -> checkpoint -> delete -> rollback", async () => {
      // Create entity
      const newUser = uow.users.create({
        id: 400,
        username: "checkpoint_test",
        email: "cp@example.com",
      });

      // Set checkpoint after creation
      const checkpoint = uow.setCheckpoint();

      // Delete the created entity
      uow.users.delete(newUser);

      // Rollback to checkpoint (should restore the created entity)
      uow.rollback(checkpoint);

      // Save (should save the created entity)
      await uow.save();

      // Verify entity exists in database
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 400),
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.username).toBe("checkpoint_test");
    });

    it("should handle find -> modify -> checkpoint -> delete -> rollback", async () => {
      // Find and modify
      const user = await uow.users.find({ id: 2 });
      expect(user).toBeDefined();

      const originalUsername = user!.username;
      user!.username = "modified_before_checkpoint";

      // Set checkpoint after modification
      const checkpoint = uow.setCheckpoint();

      // Delete the entity
      uow.users.delete(user!);

      // Rollback to checkpoint (should restore the modification)
      uow.rollback(checkpoint);

      // Save
      await uow.save();

      // Verify entity has the modified value
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 2),
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.username).toBe("modified_before_checkpoint");
      expect(dbUser?.username).not.toBe(originalUsername);
    });

    it("should handle partial saves with mixed operations", async () => {
      // Modify existing users
      const existingUser1 = await uow.users.find({ id: 1 });
      const existingUser2 = await uow.users.find({ id: 2 });
      existingUser1!.username = "modified_before_checkpoint";
      existingUser2!.username = "also_modified_before";

      // Set checkpoint
      const checkpoint = uow.setCheckpoint();

      // More operations after checkpoint
      const existingUser3 = await uow.users.find({ id: 3 });
      existingUser3!.username = "modified_after_checkpoint";

      // Save only up to checkpoint
      await uow.save(checkpoint);

      // Verify only operations before checkpoint were saved
      const dbUser1 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser1?.username).toBe("modified_before_checkpoint");

      const dbUser2 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 2),
      });
      expect(dbUser2?.username).toBe("also_modified_before");

      // Verify operation after checkpoint was NOT saved
      const dbUser3 = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 3),
      });
      expect(dbUser3?.username).not.toBe("modified_after_checkpoint"); // Should not be saved

      const dbAfterCheckpoint = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 501),
      });
      expect(dbAfterCheckpoint).toBeUndefined(); // Should not be saved
    });

    it("should save create operations with checkpoint save", async () => {
      // Create entity before checkpoint
      const newUser = uow.users.create({
        id: 600,
        username: "created_before_checkpoint",
        email: "created@example.com",
      });

      // Set checkpoint after creation
      const checkpoint = uow.setCheckpoint();

      // Create another entity after checkpoint
      const anotherUser = uow.users.create({
        id: 601,
        username: "created_after_checkpoint",
        email: "after@example.com",
      });

      // Save only up to checkpoint (should include the first create)
      await uow.save(checkpoint);

      // Verify entity created before checkpoint was saved
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 600),
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.username).toBe("created_before_checkpoint");

      // Verify entity created after checkpoint was NOT saved
      const dbUserAfter = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 601),
      });
      expect(dbUserAfter).toBeUndefined();
    });

    it("should save delete operations with checkpoint save", async () => {
      // Find existing entity
      const existingUser = await uow.users.find({ id: 1 });
      expect(existingUser).toBeDefined();

      // Delete entity before checkpoint
      uow.users.delete(existingUser!);

      // Set checkpoint after deletion
      const checkpoint = uow.setCheckpoint();

      // Find and delete another entity after checkpoint
      const anotherUser = await uow.users.find({ id: 2 });
      uow.users.delete(anotherUser!);

      // Save only up to checkpoint (should include the first delete)
      await uow.save(checkpoint);

      // Verify entity deleted before checkpoint was actually deleted
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser).toBeUndefined();

      // Verify entity deleted after checkpoint was NOT deleted
      const dbUserAfter = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 2),
      });
      expect(dbUserAfter).toBeDefined();
    });

    it("should handle mixed operations (create, modify, delete) with checkpoint save", async () => {
      // Create entity before checkpoint
      const newUser = uow.users.create({
        id: 700,
        username: "mixed_create",
        email: "mixed@example.com",
      });

      // Find and modify existing entity before checkpoint
      const existingUser = await uow.users.find({ id: 3 });
      existingUser!.username = "mixed_modified";

      // Find and delete another entity before checkpoint
      const toDelete = await uow.users.find({ id: 2 });
      uow.users.delete(toDelete!);

      // Set checkpoint
      const checkpoint = uow.setCheckpoint();

      // More operations after checkpoint
      const afterUser = uow.users.create({
        id: 701,
        username: "after_checkpoint",
        email: "after@example.com",
      });

      // Save only up to checkpoint
      await uow.save(checkpoint);

      // Verify create before checkpoint was saved
      const dbNewUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 700),
      });
      expect(dbNewUser).toBeDefined();
      expect(dbNewUser?.username).toBe("mixed_create");

      // Verify modify before checkpoint was saved
      const dbModified = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 3),
      });
      expect(dbModified?.username).toBe("mixed_modified");

      // Verify delete before checkpoint was executed
      const dbDeleted = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 2),
      });
      expect(dbDeleted).toBeUndefined();

      // Verify create after checkpoint was NOT saved
      const dbAfterUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 701),
      });
      expect(dbAfterUser).toBeUndefined();
    });

    it("should handle create -> modify checkpoint operations", async () => {
      const newUser = uow.users.create({
        id: 900,
        username: "new_user",
      });

      newUser.username = "new_user_modified";

      await uow.save();

      const newUserLoaded = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 900),
      });

      expect(newUserLoaded).toBeDefined();
      expect(newUserLoaded?.username).toBe("new_user_modified");
    });

    it("should throw when modifying a character after deletion", async () => {
      const user = await uow.users.find({ id: 1 });
      uow.users.delete(user!);

      expect(() => {
        user!.username = "modified";
      }).toThrow();
    });

    it("should throw when trying to create entities with the same primary key", () => {
      uow.users.create({
        id: 1010,
        username: "test",
      });

      expect(() => {
        uow.users.create({
          id: 1010,
          username: "test",
        });
      }).toThrow();
    });
  });

  describe("Identity Map Consistency", () => {
    it("should maintain object identity across operations", async () => {
      // Find entity
      const user1 = await uow.users.find({ id: 1 });

      // Find same entity again
      const user2 = await uow.users.find({ id: 1 });

      // Should be same object reference
      expect(user1).toBe(user2!);
      expect(user1).toBeDefined();

      // Modify through one reference
      user1!.username = "modified_via_user1";

      // Should see change through other reference
      expect(user2!.username).toBe("modified_via_user1");

      // Delete through one reference
      uow.users.delete(user1!);

      // Should still find through other reference (still in identity map)
      const user3 = await uow.users.find({ id: 1 });
      expect(user3).toBeUndefined();
    });

    it("should handle identity map with create operations", async () => {
      // Create entity
      const newUser = uow.users.create({
        id: 600,
        username: "identity_test",
        email: "it@example.com",
      });

      // Find the created entity
      const foundUser = await uow.users.find({ id: 600 });

      // Should be same object reference
      expect(foundUser).toBe(newUser);

      // Modify through found reference
      foundUser!.email = "modified@example.com";

      // Should see change in original reference
      expect(newUser.email).toBe("modified@example.com");
    });
  });

  describe("Error Handling in CRUD Interactions", () => {
    it("should handle delete of non-existent entity gracefully", async () => {
      // Try to find non-existent entity
      const nonExistent = await uow.users.find({ id: 999 });
      expect(nonExistent).toBeUndefined();

      // Should not throw when trying to delete undefined
      expect(() => {
        uow.users.delete(nonExistent!);
      }).toThrow(); // Should throw because entity is not tracked
    });

    it("should handle multiple operations on same entity", async () => {
      // Find entity
      const user = await uow.users.find({ id: 1 });
      expect(user).toBeDefined();

      // Modify multiple times
      user!.username = "first_modification";
      user!.username = "second_modification";
      user!.email = "modified@example.com";

      // Should only have one pending change (for this entity)
      expect(uow.getStats().pendingChanges).toBe(1);

      // Save
      await uow.save();

      // Verify final state
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser?.username).toBe("second_modification");
      expect(dbUser?.email).toBe("modified@example.com");
    });
  });
});
