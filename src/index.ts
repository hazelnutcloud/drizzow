// Re-export types for convenience
export type * from "./types";

// Re-export core classes for advanced usage
export { UnitOfWork } from "./uow";
export { IdentityMap } from "./identity-map";
export { ChangeTracker } from "./change-tracker";
export { ProxyManager } from "./proxy";
export { CheckpointManager } from "./checkpoint-manager";

// Re-export database adapters
export { BunSQLiteAdapter } from "./bun-sqlite";
export { NodePostgresAdapter } from "./node-postgres";
