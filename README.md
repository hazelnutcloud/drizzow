# drizzow (drizzle of work)

A TypeScript library that implements the Unit of Work pattern for [DrizzleORM](https://orm.drizzle.team/), providing automatic change tracking, transaction management, and checkpoint/rollback functionality.

## Features

- 🔄 **Automatic Change Tracking** - Transparently tracks entity modifications through JavaScript proxies
- 💾 **Transaction Management** - Batches database operations and commits them in a single transaction
- ⏮️ **Checkpoint & Rollback** - Create snapshots and rollback to previous states with full CRUD support
- 🗺️ **Identity Map** - Ensures single instance per entity and prevents duplicate fetches
- 🔒 **Type Safety** - Full TypeScript support with Drizzle's type inference
- 🚀 **Zero Dependencies** - Only requires DrizzleORM as a peer dependency
- ⚡ **Efficient Queries** - Smart caching and optimized primary key lookups
- 🛡️ **Data Integrity** - Comprehensive validation and error handling

## Installation

```bash
bun add drizzow
# or
npm install drizzow
# or
pnpm add drizzow
```

## Quick Start

```typescript
import { drizzow } from "drizzow/bun-sqlite";
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
const uow = drizzow(db);

// Use the UoW with the new find() API
const user = await uow.users.find({ id: 1 });

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
import { drizzow } from "drizzow/bun-sqlite";

const uow = drizzow(drizzleDb);
```

### Query Methods

The UoW provides an efficient `find()` method for primary key lookups with identity map caching:

```typescript
// Find single entity by primary key
const user = await uow.users.find({ id: 1 });

// Find multiple entities by primary keys
const users = await uow.users.find({ id: [1, 2, 3] });

// Returns undefined if not found
const notFound = await uow.users.find({ id: 999 }); // undefined

// Returns empty array if none found
const empty = await uow.users.find({ id: [999, 1000] }); // []
```

### Create and Delete

```typescript
// Create new entity
const newUser = uow.users.create({
  id: 100,
  username: "bob",
  email: "bob@example.com",
});

// Delete entity
const user = await uow.users.find({ id: 1 });
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

## Recent Improvements

- **Fixed Critical Bug**: Checkpoint save operations now properly handle create and delete operations
- **Enhanced Test Coverage**: Added comprehensive CRUD interaction tests
- **Improved API**: New efficient `find()` method with identity map caching
- **Better Error Handling**: Enhanced validation and error messages

## Limitations

- Currently only supports Bun SQLite and PostgreSQL (More adapters coming soon)
- Relationships are not automatically tracked (manual handling required)
- Complex queries still require direct Drizzle usage

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Acknowledgments

Built with [Bun](https://bun.sh) and [DrizzleORM](https://orm.drizzle.team/)
