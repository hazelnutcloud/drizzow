import { getTableName, type Table } from "drizzle-orm";
import { ChangeTracker } from "./change-tracker";
import { IdentityMap } from "./identity-map";
import type { BaseDatabaseAdapter } from "./base-adapter";

declare const window: any;

/**
 * Proxy utilities for transparent change tracking
 */
export class ProxyManager {
  private changeTracker: ChangeTracker;
  private identityMap: IdentityMap;
  private adapter: BaseDatabaseAdapter;
  private proxyCache = new WeakMap<any, any>();

  constructor(
    changeTracker: ChangeTracker,
    identityMap: IdentityMap,
    adapter: BaseDatabaseAdapter,
  ) {
    this.changeTracker = changeTracker;
    this.identityMap = identityMap;
    this.adapter = adapter;
  }

  /**
   * Create a proxy for an entity that tracks changes
   */
  createProxy<T>(entity: T, table: Table): T {
    // Return existing proxy if already proxied
    if (this.proxyCache.has(entity)) {
      return this.proxyCache.get(entity);
    }

    // Don't proxy primitives or null/undefined
    if (!this.isProxyable(entity)) {
      return entity;
    }

    const proxy = new Proxy(entity as any, {
      set: (
        target: any,
        property: string | symbol,
        value: any,
        receiver: any,
      ) => {
        if (typeof property === "symbol") {
          // Allow symbol properties to pass through
          return Reflect.set(target, property, value, receiver);
        }

        const oldValue = target[property];

        // Set the new value first
        const result = Reflect.set(target, property, value, receiver);

        // Track the change if the entity is being tracked
        // Note: We track the proxy (receiver), not the target
        if (this.changeTracker.isTracked(receiver)) {
          // Only track if the value actually changed
          if (!this.deepEqual(oldValue, value)) {
            this.changeTracker.markModified(receiver, property, oldValue);
          }
        }

        return result;
      },

      get: (target: any, property: string | symbol, receiver: any) => {
        const value = Reflect.get(target, property, receiver);

        // Don't proxy functions, symbols, or primitives
        if (
          typeof property === "symbol" ||
          typeof value === "function" ||
          !this.isProxyable(value)
        ) {
          return value;
        }

        // For nested objects/arrays, create nested proxies
        if (
          (typeof value === "object" && value !== null) ||
          Array.isArray(value)
        ) {
          return this.createNestedProxy(
            value,
            target,
            property as string,
            table,
          );
        }

        return value;
      },
    });

    // Cache the proxy
    this.proxyCache.set(entity, proxy);
    return proxy;
  }

  /**
   * Create a proxy for a new entity (not yet in database)
   */
  createNewEntityProxy<T>(entity: T, table: Table): T {
    const proxy = this.createProxy(entity, table);

    // Track as new entity
    this.changeTracker.markAdded(proxy, table);

    return proxy;
  }

  /**
   * Wrap query results with proxies
   */
  wrapQueryResults<T>(results: T, table: Table): T {
    if (Array.isArray(results)) {
      return results.map((entity) =>
        this.wrapSingleResult(entity, table),
      ) as never;
    } else {
      return this.wrapSingleResult(results, table);
    }
  }

  /**
   * Wrap a single query result
   */
  private wrapSingleResult<T>(entity: T, table: Table): T {
    if (!entity || !this.isProxyable(entity)) {
      return entity;
    }

    const tableName = getTableName(table);
    const primaryKey = this.adapter.extractPrimaryKeyValue(table, entity);

    // Check if entity already exists in identity map
    const existingEntity = this.identityMap.get(tableName, primaryKey);
    if (existingEntity) {
      // Return the existing tracked entity
      return existingEntity;
    }

    // Create proxy and register in identity map
    const proxy = this.createProxy(entity, table);
    this.identityMap.register(tableName, primaryKey, proxy);

    // Start tracking the entity
    this.changeTracker.track(proxy, table);

    return proxy;
  }

  /**
   * Create nested proxy for object properties
   */
  private createNestedProxy(
    value: any,
    parent: any,
    parentProperty: string,
    table: Table,
  ): any {
    // Return existing proxy if already cached
    if (this.proxyCache.has(value)) {
      return this.proxyCache.get(value);
    }

    if (!this.isProxyable(value)) {
      return value;
    }

    const proxy = new Proxy(value, {
      set: (
        target: any,
        property: string | symbol,
        newValue: any,
        receiver: any,
      ) => {
        if (typeof property === "symbol") {
          return Reflect.set(target, property, newValue, receiver);
        }

        const oldValue = target[property];
        const result = Reflect.set(target, property, newValue, receiver);

        // Notify parent of the change
        // Check if the parent is tracked (parent should be the proxy)
        if (this.changeTracker.isTracked(parent)) {
          if (!this.deepEqual(oldValue, newValue)) {
            // For nested changes, we mark the parent as modified
            this.changeTracker.markModified(
              parent,
              parentProperty,
              parent[parentProperty],
            );
          }
        }

        return result;
      },

      get: (target: any, property: string | symbol, receiver: any) => {
        const propValue = Reflect.get(target, property, receiver);

        if (
          typeof property === "symbol" ||
          typeof propValue === "function" ||
          !this.isProxyable(propValue)
        ) {
          return propValue;
        }

        // Create nested proxies for deeper levels
        if (
          (typeof propValue === "object" && propValue !== null) ||
          Array.isArray(propValue)
        ) {
          return this.createNestedProxy(
            propValue,
            parent,
            parentProperty,
            table,
          );
        }

        return propValue;
      },
    });

    // Cache the nested proxy
    this.proxyCache.set(value, proxy);
    return proxy;
  }

  /**
   * Check if a value can be proxied
   */
  private isProxyable(value: any): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    const type = typeof value;
    if (type !== "object") {
      return false;
    }

    // Don't proxy special objects
    if (
      value instanceof Date ||
      value instanceof RegExp ||
      value instanceof Error
    ) {
      return false;
    }

    // Don't proxy DOM nodes if in browser environment
    if (
      typeof window !== "undefined" &&
      typeof (globalThis as any).Node !== "undefined" &&
      value instanceof (globalThis as any).Node
    ) {
      return false;
    }

    return true;
  }

  /**
   * Deep equality check for change detection
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;

    if (a == null || b == null) return a === b;

    if (typeof a !== typeof b) return false;

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], b[i])) return false;
      }
      return true;
    }

    if (typeof a === "object" && typeof b === "object") {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!this.deepEqual(a[key], b[key])) return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Clear proxy cache
   */
  clearCache(): void {
    // WeakMap doesn't have a clear method, but objects will be garbage collected
    // when they go out of scope, automatically cleaning up the cache
    this.proxyCache = new WeakMap();
  }

  /**
   * Check if an object is already proxied
   */
  isProxied(obj: any): boolean {
    return this.proxyCache.has(obj);
  }
}
