import { describe, it, expect, beforeEach } from "bun:test";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { createUow, type CreateUowReturnType } from "./bun-sqlite";
import { eq } from "drizzle-orm";
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

describe("Create and Delete Operations", () => {
  let db: BunSQLiteDatabase<typeof schema>;
  let uow: CreateUowReturnType<BunSQLiteDatabase<typeof schema>>;

  beforeEach(async () => {
    // Create in-memory database
    const sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });

    // Create tables
    db.run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT
      )
    `);

    db.run(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        authorId INTEGER,
        FOREIGN KEY (authorId) REFERENCES users(id)
      )
    `);

    // Initialize UoW
    uow = createUow(db);
  });

  describe("Create Operations", () => {
    it("should create a new entity", async () => {
      // Create a new user with an ID
      const newUser = uow.users.create({
        id: 1,
        username: "testuser",
        email: "test@example.com",
      });

      // Verify the entity is created with correct data
      expect(newUser).toBeDefined();
      expect(newUser!.username).toBe("testuser");
      expect(newUser!.email).toBe("test@example.com");

      // Save changes
      await uow.save();

      // Verify the entity was persisted
      const savedUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "testuser"));

      expect(savedUser.length).toBe(1);
      expect(savedUser[0]!.username).toBe("testuser");
      expect(savedUser[0]!.email).toBe("test@example.com");
    });

    it("should track created entities for changes", async () => {
      // Create a new user with an ID
      const newUser = uow.users.create({
        id: 2,
        username: "newuser",
        email: "new@example.com",
      });

      // Modify the created entity
      newUser.email = "updated@example.com";

      // Save changes
      await uow.save();

      // Verify the entity was persisted with updated value
      const savedUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "newuser"));

      expect(savedUser.length).toBe(1);
      expect(savedUser[0]!.email).toBe("updated@example.com");
    });

    it("should handle multiple creates", async () => {
      // Create multiple users
      uow.users.create({ id: 3, username: "user1" });
      uow.users.create({ id: 4, username: "user2" });
      uow.users.create({ id: 5, username: "user3" });

      // Save all
      await uow.save();

      // Verify all were persisted
      const allUsers = await db.select().from(schema.users);
      expect(allUsers.length).toBe(3);
      expect(allUsers.map((u) => u.username).sort()).toEqual([
        "user1",
        "user2",
        "user3",
      ]);
    });
  });

  describe("Delete Operations", () => {
    it("should delete an existing entity", async () => {
      // Insert a user directly
      await db
        .insert(schema.users)
        .values({ username: "toDelete", email: "delete@example.com" });

      // Load the user through UoW
      const user = await uow.users.findFirst({
        where: eq(schema.users.username, "toDelete"),
      });

      expect(user).toBeDefined();

      // Delete the user
      uow.users.delete(user!);

      // Save changes
      await uow.save();

      // Verify the entity was deleted
      const deletedUser = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "toDelete"));

      expect(deletedUser.length).toBe(0);
    });

    it("should throw error when deleting untracked entity", () => {
      // Create an entity outside of UoW
      const untrackedUser = {
        id: 1,
        username: "untracked",
        email: "untracked@example.com",
      };

      // Attempt to delete should throw
      expect(() => uow.users.delete(untrackedUser)).toThrow(
        "Cannot delete untracked entity"
      );
    });

    it("should handle delete of created entity", async () => {
      // Create a new user with an ID
      const newUser = uow.users.create({
        id: 1,
        username: "testuser",
        email: "test@example.com",
      });

      // Delete the just-created user
      uow.users.delete(newUser);

      // Save changes
      await uow.save();

      // Verify the entity was never persisted
      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, "createThenDelete"));

      expect(users.length).toBe(0);
    });

    it("should handle multiple deletes", async () => {
      // Insert multiple users
      await db
        .insert(schema.users)
        .values([
          { username: "user1" },
          { username: "user2" },
          { username: "user3" },
        ]);

      // Load all users through UoW
      const users = await uow.users.findMany();
      expect(users.length).toBe(3);

      // Delete all users
      users.forEach((user: any) => uow.users.delete(user));

      // Save changes
      await uow.save();

      // Verify all were deleted
      const remainingUsers = await db.select().from(schema.users);
      expect(remainingUsers.length).toBe(0);
    });
  });

  describe("Mixed Create and Delete Operations", () => {
    it("should handle creates and deletes in same transaction", async () => {
      // Insert some initial data
      await db
        .insert(schema.users)
        .values([{ username: "existing1" }, { username: "existing2" }]);

      // Load existing users
      const existingUsers = await uow.users.findMany();

      // Delete one existing user
      uow.users.delete(existingUsers[0]!);

      // Create new users
      uow.users.create({ id: 7, username: "new1" });
      uow.users.create({ id: 8, username: "new2" });

      // Save all changes
      await uow.save();

      // Verify final state
      const finalUsers = await db.select().from(schema.users);
      expect(finalUsers.length).toBe(3);
      expect(finalUsers.map((u) => u.username).sort()).toEqual([
        "existing2",
        "new1",
        "new2",
      ]);
    });

    it("should work with checkpoints", async () => {
      // Create a user
      const user1 = uow.users.create({ id: 9, username: "user1" });

      // Set checkpoint
      const checkpoint = uow.setCheckpoint();

      // Create another user and delete the first
      uow.users.create({ id: 10, username: "user2" });
      uow.users.delete(user1);

      // Rollback to checkpoint
      uow.rollback(checkpoint);

      // Save - should only save user1
      await uow.save();

      // Verify only user1 was saved
      const users = await db.select().from(schema.users);
      expect(users.length).toBe(1);
      expect(users[0]?.username).toBe("user1");
    });
  });
});
