import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";

import { SQLiteAdapter } from "./sqlite";
import { EntityState } from "../types";
import { users } from "../schema";
import { TestDatabase, createTestUser } from "../uow.test";

describe("SQLite Adapter", () => {
  let testDb: TestDatabase;
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    testDb = new TestDatabase();
    await testDb.setup();
    adapter = testDb.getAdapter();
  });

  afterEach(() => {
    testDb.close();
  });

  test("should identify as SQLite", () => {
    expect(adapter.getDatabaseType()).toBe("sqlite");
  });

  test("should support returning clauses", () => {
    expect(adapter.supportsReturning()).toBe(true);
  });

  test("should support batch operations", () => {
    expect(adapter.supportsBatchOperations()).toBe(true);
  });

  test("should have correct parameter limits", () => {
    expect(adapter.getMaxParameters()).toBe(999);
  });

  test("should get table from name", () => {
    const table = (adapter as any).getTableFromName("users");
    expect(table).toBeDefined();
    // Use the proper way to get table name
    const { name } = getTableConfig(table);
    expect(name).toBe("users");
  });

  test("should handle unknown table names", () => {
    expect(() => (adapter as any).getTableFromName("unknown")).toThrow(
      "Table 'unknown' not found in schema"
    );
  });

  test("should extract primary key values", () => {
    const testUser = createTestUser(123, "test");
    const primaryKey = (adapter as any).extractPrimaryKeyValue(users, testUser);
    expect(primaryKey).toBe(123);
  });

  test("should build update changes", () => {
    const mockChangeSet = {
      entity: createTestUser(1, "alice"),
      state: EntityState.Modified,
      changes: new Map([
        ["username", { old: "alice", new: "alice_new" }],
        ["email", { old: "alice@example.com", new: "new@example.com" }],
      ]),
      tableName: "users",
    };

    const changes = (adapter as any).buildUpdateChanges(mockChangeSet);

    expect(changes.username).toBe("alice_new");
    expect(changes.email).toBe("new@example.com");
  });
});
