import { describe, test, expect, beforeEach } from "bun:test";

import { IdentityMap } from "../src/identity-map";
import { TestDatabase, users } from "./uow.test";
import type { BunSQLiteAdapter } from "./bun-sqlite/adapter";

function createTestUser(id: number, username: string, email?: string) {
  return { id, username, email: email || `${username}@example.com` };
}

function createTestPost(
  id: number,
  title: string,
  content: string,
  userId: number,
) {
  return { id, title, content, userId };
}

describe("Identity Map", () => {
  let identityMap: IdentityMap;
  let adapter: BunSQLiteAdapter;
  let testUser: any;

  beforeEach(() => {
    adapter = new TestDatabase().getAdapter();
    identityMap = new IdentityMap();
    testUser = createTestUser(1, "alice");
  });

  test("should register and retrieve entities", () => {
    identityMap.register("users", 1, testUser);

    const retrieved = identityMap.get("users", 1);
    expect(retrieved).toBe(testUser);
  });

  test("should handle non-existent entities", () => {
    const retrieved = identityMap.get("users", 999);
    expect(retrieved).toBeUndefined();
  });

  test("should check entity existence", () => {
    identityMap.register("users", 1, testUser);

    expect(identityMap.has("users", 1)).toBe(true);
    expect(identityMap.has("users", 999)).toBe(false);
  });

  test("should remove entities", () => {
    identityMap.register("users", 1, testUser);
    expect(identityMap.has("users", 1)).toBe(true);

    identityMap.remove("users", 1);
    expect(identityMap.has("users", 1)).toBe(false);
  });

  test("should handle composite keys", () => {
    const compositeKey = [1, "A"];
    identityMap.register("composite", compositeKey, testUser);

    const retrieved = identityMap.get("composite", compositeKey);
    expect(retrieved).toBe(testUser);
  });

  test("should serialize keys correctly", () => {
    identityMap.register("users", "string-key", testUser);
    identityMap.register("users", 123, testUser);
    identityMap.register("users", [1, 2], testUser);

    expect(identityMap.has("users", "string-key")).toBe(true);
    expect(identityMap.has("users", 123)).toBe(true);
    expect(identityMap.has("users", [1, 2])).toBe(true);
  });

  test("should handle null/undefined keys", () => {
    expect(() => identityMap.register("users", null, testUser)).toThrow();
    expect(() => identityMap.register("users", undefined, testUser)).toThrow();
  });

  test("should clear table data", () => {
    identityMap.register("users", 1, testUser);
    identityMap.register("posts", 1, createTestPost(1, "Test", "Content", 1));

    identityMap.clearTable("users");

    expect(identityMap.has("users", 1)).toBe(false);
    expect(identityMap.has("posts", 1)).toBe(true);
  });

  test("should clear all data", () => {
    identityMap.register("users", 1, testUser);
    identityMap.register("posts", 1, createTestPost(1, "Test", "Content", 1));

    identityMap.clear();

    expect(identityMap.has("users", 1)).toBe(false);
    expect(identityMap.has("posts", 1)).toBe(false);
  });

  test("should get all entities for table", () => {
    const user2 = createTestUser(2, "bob");

    identityMap.register("users", 1, testUser);
    identityMap.register("users", 2, user2);

    const allUsers = identityMap.getAllForTable("users");
    expect(allUsers).toHaveLength(2);
    expect(allUsers).toContain(testUser);
    expect(allUsers).toContain(user2);
  });

  test("should create and restore snapshots", () => {
    const user2 = createTestUser(2, "bob");

    identityMap.register("users", 1, testUser);
    identityMap.register("users", 2, user2);

    const snapshot = identityMap.createSnapshot();

    identityMap.clear();
    expect(identityMap.has("users", 1)).toBe(false);

    identityMap.restoreFromSnapshot(snapshot);

    expect(identityMap.has("users", 1)).toBe(true);
    expect(identityMap.has("users", 2)).toBe(true);
  });

  test("should extract primary key from table schema", () => {
    const primaryKey = adapter.extractPrimaryKeyValue(users, testUser);
    expect(primaryKey).toBe(1);
  });
});
