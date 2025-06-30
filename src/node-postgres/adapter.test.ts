import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";
import { NodePostgresAdapter } from "./adapter";
import { Client } from "pg";

// Test schema
const users = pgTable("test_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  age: integer("age"),
});

const posts = pgTable("test_posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  userId: integer("user_id").notNull(),
});

describe("NodePostgresAdapter", () => {
  let client: Client;
  let db: any;
  let adapter: NodePostgresAdapter;

  beforeEach(async () => {
    // Skip if no PostgreSQL connection is available
    if (!process.env.PG_TEST_DB_URL) {
      console.log("Skipping PostgreSQL tests - no PG_TEST_DB_URL set");
      return;
    }

    client = new Client({
      connectionString: process.env.PG_TEST_DB_URL,
    });
    await client.connect();

    db = drizzle(client, { schema: { users, posts } });
    adapter = new NodePostgresAdapter(db);

    // Create test tables
    await client.query(`
      DROP TABLE IF EXISTS test_posts CASCADE;
      DROP TABLE IF EXISTS test_users CASCADE;

      CREATE TABLE test_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER
      );

      CREATE TABLE test_posts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        user_id INTEGER NOT NULL
      );
    `);
  });

  afterEach(async () => {
    if (client) {
      await client.query(`
        DROP TABLE IF EXISTS test_posts CASCADE;
        DROP TABLE IF EXISTS test_users CASCADE;
      `);
      await client.end();
    }
  });

  it("should identify as postgres database type", () => {
    if (!process.env.PG_TEST_DB_URL) return;
    expect(adapter.getDatabaseType()).toBe("postgres");
  });

  it("should execute changesets in transaction", async () => {
    if (!process.env.PG_TEST_DB_URL) return;

    const changeSets = [
      {
        tableName: "users",
        entity: { name: "Alice", email: "alice@example.com", age: 25 },
        state: "added",
        changes: new Map(),
      },
      {
        tableName: "users",
        entity: { name: "Bob", email: "bob@example.com", age: 35 },
        state: "added",
        changes: new Map(),
      },
    ];

    await adapter.executeChangeSets(changeSets);

    // Verify the inserts
    const result = await db.select().from(users);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Alice");
    expect(result[1].name).toBe("Bob");
  });

  it("should handle updates in changesets", async () => {
    if (!process.env.PG_TEST_DB_URL) return;

    // First insert a user
    const [user] = await db
      .insert(users)
      .values({ name: "Charlie", email: "charlie@example.com", age: 40 })
      .returning();

    // Create update changeset
    const changeSets = [
      {
        tableName: "users",
        entity: {
          id: user.id,
          name: "Charlie Updated",
          email: user.email,
          age: 41,
        },
        state: "modified",
        changes: new Map([
          ["name", { old: "Charlie", new: "Charlie Updated" }],
          ["age", { old: 40, new: 41 }],
        ]),
      },
    ];

    await adapter.executeChangeSets(changeSets);

    // Verify the update
    const [updated] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated.name).toBe("Charlie Updated");
    expect(updated.age).toBe(41);
  });

  it("should handle deletes in changesets", async () => {
    if (!process.env.PG_TEST_DB_URL) return;

    // First insert a user
    const [user] = await db
      .insert(users)
      .values({ name: "David", email: "david@example.com", age: 50 })
      .returning();

    // Create delete changeset
    const changeSets = [
      {
        tableName: "users",
        entity: user,
        state: "deleted",
        changes: new Map(),
      },
    ];

    await adapter.executeChangeSets(changeSets);

    // Verify the delete
    const result = await db.select().from(users).where(eq(users.id, user.id));
    expect(result).toHaveLength(0);
  });

  it("should rollback transaction on error", async () => {
    if (!process.env.PG_TEST_DB_URL) return;

    const changeSets = [
      {
        tableName: "users",
        entity: { name: "Eve", email: "eve@example.com", age: 30 },
        state: "added",
        changes: new Map(),
      },
      {
        tableName: "invalid_table", // This will cause an error
        entity: { id: 1 },
        state: "added",
        changes: new Map(),
      },
    ];

    expect(adapter.executeChangeSets(changeSets)).rejects.toThrow();

    // Verify no users were inserted due to rollback
    const result = await db.select().from(users);
    expect(result).toHaveLength(0);
  });

  it("should handle batch operations", async () => {
    if (!process.env.PG_TEST_DB_URL) return;

    // Create many values to test batching
    const values = Array.from({ length: 100 }, (_, i) => ({
      name: `User ${i}`,
      email: `user${i}@example.com`,
      age: 20 + i,
    }));

    await adapter.executeInsert(users, values);

    // Verify all were inserted
    const result = await db.select().from(users);
    expect(result).toHaveLength(100);
  });

  it("should extract primary key correctly", () => {
    if (!process.env.PG_TEST_DB_URL) return;

    const entity = { id: 123, name: "Test", email: "test@example.com" };
    const primaryKey = adapter.extractPrimaryKeyValue(users, entity);
    expect(primaryKey).toBe(123);
  });

  it("should get primary key column", () => {
    if (!process.env.PG_TEST_DB_URL) return;

    const column = adapter.getPrimaryKeyColumn(users);
    expect(column).toBeDefined();
    expect(column?.name).toBe("id");
  });
});

// Import eq for the update test
import { eq } from "drizzle-orm";
