# drizzle-uow

A TypeScript library that implements the Unit of Work pattern for [DrizzleORM](https://orm.drizzle.team/), providing automatic change tracking, transaction management, and checkpoint/rollback functionality.

## Features

- 🔄 **Automatic Change Tracking** - Transparently tracks entity modifications through JavaScript proxies
- 💾 **Transaction Management** - Batches database operations and commits them in a single transaction
- ⏮️ **Checkpoint & Rollback** - Create snapshots and rollback to previous states
- 🗺️ **Identity Map** - Ensures single instance per entity and prevents duplicate fetches
- 🔒 **Type Safety** - Full TypeScript support with Drizzle's type inference
- 🚀 **Zero Dependencies** - Only requires DrizzleORM as a peer dependency

## Installation

```bash
bun add drizzle-uow
# or
npm install drizzle-uow
# or
pnpm add drizzle-uow
```

## Quick Start

```typescript
import { createUow } from "drizzle-uow/bun-sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

// Define your schema
const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
  email: text(),
});

// Create database and UoW
const sqlite = new Database("app.db");
const db = drizzle(sqlite, { schema: { users } });
const uow = createUow(db);

// Use the UoW
const user = await uow.users.findFirst({
  where: eq(users.username, "alice")
});

// Changes are automatically tracked
user.email = "alice@newdomain.com";

// Save all changes in a single transaction
await uow.save();
```

## Core Concepts

### Unit of Work Pattern

The Unit of Work pattern maintains a list of objects affected by a business transaction and coordinates writing out changes. It keeps track of everything you do during a business transaction that can affect the database.

### Change Tracking

All entities returned from queries are automatically wrapped in proxies that track property changes:

```typescript
const user = await uow.users.findFirst();
console.log(uow.getStats().pendingChanges); // 0

user.username = "newUsername";
console.log(uow.getStats().pendingChanges); // 1
```

### Identity Map

The identity map ensures that each entity is loaded only once per unit of work:

```typescript
const user1 = await uow.users.findFirst({ where: eq(users.id, 1) });
const user2 = await uow.users.findFirst({ where: eq(users.id, 1) });
console.log(user1 === user2); // true - same object reference
```

## API Reference

### Creating a Unit of Work

```typescript
import { createUow } from "drizzle-uow/bun-sqlite";

const uow = createUow(drizzleDb);
```

### Query Methods

The UoW provides the same query methods as Drizzle, but returns tracked entities:

```typescript
// Find single entity
const user = await uow.users.findFirst({
  where: eq(users.username, "alice")
});

// Find multiple entities
const users = await uow.users.findMany({
  where: gt(users.createdAt, lastWeek)
});
```

### Create and Delete

```typescript
// Create new entity
const newUser = uow.users.create({
  username: "bob",
  email: "bob@example.com"
});

// Delete entity
const user = await uow.users.findFirst();
uow.users.delete(user);
```

### Save Changes

```typescript
// Save all pending changes
await uow.save();

// Save up to a specific checkpoint
const checkpoint = uow.setCheckpoint();
// ... make more changes ...
await uow.save(checkpoint); // Only saves changes up to checkpoint
```

### Checkpoints and Rollback

```typescript
// Create a checkpoint
const checkpoint = uow.setCheckpoint();

// Make changes
user.email = "new@email.com";

// Rollback to checkpoint
const result = uow.rollback(checkpoint);
if (result.error) {
  console.error("Rollback failed:", result.error);
}
```

### Statistics and Monitoring

```typescript
const stats = uow.getStats();
console.log({
  trackedEntities: stats.trackedEntities,
  pendingChanges: stats.pendingChanges,
  identityMapSize: stats.identityMapSize,
  checkpointCount: stats.checkpointCount
});
```

### Clear and Reset

```typescript
// Clear all tracked entities and checkpoints
uow.clear();
```

## Advanced Usage

### Complex Checkpoint Scenarios

```typescript
// Load initial data
const users = await uow.users.findMany();

// Create checkpoint A
const checkpointA = uow.setCheckpoint();
users[0].username = "state_A";

// Create checkpoint B
const checkpointB = uow.setCheckpoint();
users[1].username = "state_B";

// Make more changes
users[2].username = "state_C";

// Save only up to checkpoint B
await uow.save(checkpointB);

// Rollback to checkpoint A
uow.rollback(checkpointA);
```

### Batch Operations

```typescript
// Create multiple entities
const users = [
  uow.users.create({ username: "user1" }),
  uow.users.create({ username: "user2" }),
  uow.users.create({ username: "user3" })
];

// Modify existing entities
const existingUsers = await uow.users.findMany();
existingUsers.forEach(user => {
  user.lastActive = new Date();
});

// Save all changes in one transaction
await uow.save();
```

### Error Handling

```typescript
try {
  user.username = null; // Invalid change
  await uow.save();
} catch (error) {
  // Changes remain pending after failed save
  console.log(uow.getStats().pendingChanges); // Still shows pending changes
  
  // Can rollback to previous checkpoint
  uow.rollback(lastCheckpoint);
}
```

## Performance Considerations

- **Lazy Proxy Creation**: Proxies are created only when entities are accessed
- **Efficient Change Detection**: Only tracks actual modifications
- **Checkpoint Limit**: Maximum of 50 checkpoints to prevent memory issues
- **Batch Operations**: All changes are saved in a single transaction

## Development

### Setup

```bash
bun install
```

### Running Tests

```bash
bun test
```

### Running Benchmarks

```bash
bun run bench
```

## Architecture

The library consists of several key components:

- **UnitOfWork**: Central coordinator for all operations
- **ProxyManager**: Creates and manages entity proxies
- **ChangeTracker**: Records and computes changesets
- **IdentityMap**: Ensures entity uniqueness
- **CheckpointManager**: Handles snapshots and rollbacks
- **DatabaseAdapter**: Abstraction for different database types

## Limitations

- Currently only supports SQLite (PostgreSQL and MySQL adapters coming soon)
- The `refresh()` method is not yet implemented
- Relationships are not automatically tracked (manual handling required)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Acknowledgments

Built with [Bun](https://bun.sh) and [DrizzleORM](https://orm.drizzle.team/)