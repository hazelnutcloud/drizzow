import { describe, test, expect, beforeEach } from "bun:test";

import { IdentityMap } from "./identity-map";
import { ChangeTracker } from "./change-tracker";
import { ProxyManager } from "./proxy";
import { EntityState } from "./types";
import { createTestUser, TestDatabase, users } from "./uow.test";
import type { SQLiteAdapter } from "./bun-sqlite/adapter";

describe("Proxy Manager", () => {
  let proxyManager: ProxyManager;
  let changeTracker: ChangeTracker;
  let identityMap: IdentityMap;
  let testUser: any;

  beforeEach(() => {
    const testDb = new TestDatabase();

    identityMap = new IdentityMap();
    changeTracker = new ChangeTracker(new TestDatabase().getAdapter());
    proxyManager = new ProxyManager(
      changeTracker,
      identityMap,
      testDb.getAdapter()
    );
    testUser = createTestUser(1, "alice");
  });

  test("should create transparent proxies", () => {
    const proxy = proxyManager.createProxy(testUser, users);

    expect(proxy.username).toBe("alice");
    expect(proxy.email).toBe("alice@example.com");
    expect(proxy.id).toBe(1);
  });

  test("should intercept property changes", () => {
    changeTracker.track(testUser, users);
    const proxy = proxyManager.createProxy(testUser, users);

    // Now track the proxy instead of the original entity
    changeTracker.untrack([testUser]);
    changeTracker.track(proxy, users, EntityState.Unchanged);

    proxy.username = "modified";

    expect(proxy.username).toBe("modified");
    expect(changeTracker.getState(proxy)).toBe(EntityState.Modified);
  });

  test("should not track changes on untracked entities", () => {
    const proxy = proxyManager.createProxy(testUser, users);

    proxy.username = "modified";

    expect(proxy.username).toBe("modified");
    expect(changeTracker.isTracked(testUser)).toBe(false);
  });

  test("should cache proxies", () => {
    const proxy1 = proxyManager.createProxy(testUser, users);
    const proxy2 = proxyManager.createProxy(testUser, users);

    expect(proxy1).toBe(proxy2);
  });

  test("should wrap query results", () => {
    const users_ = [createTestUser(1, "alice"), createTestUser(2, "bob")];

    const wrapped = proxyManager.wrapQueryResults(users_, users);

    expect(Array.isArray(wrapped)).toBe(true);
    expect((wrapped as any[]).length).toBe(2);
  });

  test("should handle single query results", () => {
    const wrapped = proxyManager.wrapQueryResults(testUser, users);

    expect(wrapped).toBeDefined();
    expect((wrapped as any).username).toBe("alice");
  });

  test("should integrate with identity map", () => {
    const wrapped1 = proxyManager.wrapQueryResults(testUser, users);
    const wrapped2 = proxyManager.wrapQueryResults(
      createTestUser(1, "alice"),
      users
    );

    expect(wrapped1).toBe(wrapped2); // Same reference due to identity map
  });

  test("should handle null and undefined results", () => {
    expect(proxyManager.wrapQueryResults(null, users)).toBeNull();
    expect(proxyManager.wrapQueryResults(undefined, users)).toBeUndefined();
  });

  test("should clear proxy cache", () => {
    proxyManager.createProxy(testUser, users);
    expect(proxyManager.isProxied(testUser)).toBe(true);

    proxyManager.clearCache();

    // Note: WeakMap doesn't have a way to check if it's empty,
    // but creating a new proxy should work
    const newProxy = proxyManager.createProxy(testUser, users);
    expect(newProxy).toBeDefined();
  });

  test("should handle primitive values", () => {
    expect(proxyManager.createProxy("string" as any, users)).toBe("string");
    expect(proxyManager.createProxy(123 as any, users)).toBe(123);
    expect(proxyManager.createProxy(null as any, users)).toBeNull();
  });

  test("should create new entity proxies", () => {
    const newUser = createTestUser(0, "newuser"); // ID 0 indicates new entity

    const proxy = proxyManager.createNewEntityProxy(newUser, users);

    expect(proxy.username).toBe("newuser");
    expect(changeTracker.isTracked(proxy)).toBe(true);
    expect(changeTracker.getState(proxy)).toBe(EntityState.Added);
  });
});
