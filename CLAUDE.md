# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **drizzle-uow**, a TypeScript library that implements the Unit of Work pattern as an extension for DrizzleORM. It provides automatic change tracking, transaction management, and checkpoint/rollback functionality through JavaScript proxies while maintaining full type safety and compatibility with Drizzle's API.

## Development Commands

### Setup
```bash
bun install
```

### Running the Project
```bash
bun run ./src/index.ts
```

### Testing
```bash
bun test                    # Run all tests
bun run ./src/test.ts       # Run the main test suite
```

## Core Architecture

The library is built around several key components that work together:

### 1. UnitOfWork Class (`src/uow.ts`)
- Central coordinator for all database operations
- Manages transactions, change tracking, and persistence
- Integrates with database adapters for different database types

### 2. Proxy-Based Change Tracking
- **ProxyManager** (`src/proxy.ts`): Creates and manages entity proxies
- **ChangeTracker** (`src/change-tracker.ts`): Records and computes changesets
- Transparent tracking of property modifications without code changes

### 3. Identity Map Pattern (`src/identity-map.ts`)
- Ensures single instance per entity identity
- Prevents duplicate entities and maintains consistency
- Caches entities by table name and primary key

### 4. Checkpoint System (`src/checkpoint-manager.ts`)
- In-memory snapshots of entity states
- Supports rollback to previous states
- Enables selective saving up to specific checkpoints

### 5. Database Adapters (`src/adapters/`)
- **BaseDatabaseAdapter** (`src/adapters/base.ts`): Abstract interface
- **SQLiteAdapter** (`src/adapters/sqlite.ts`): SQLite implementation
- Designed to support PostgreSQL, MySQL, and other Drizzle-supported databases

## API Design

The library extends Drizzle's API with UoW functionality:

```typescript
// Standard Drizzle query methods (proxy-wrapped results)
const user = await uow.users.findFirst();
const users = await uow.users.findMany();

// UoW-specific methods
const newUser = uow.users.create({ username: "test" });
uow.users.delete(existingUser);

// UoW management
await uow.save();                    // Save all changes
const checkpoint = uow.setCheckpoint(); // Create checkpoint  
uow.rollback(checkpoint);           // Rollback to checkpoint
```

## Type System

The library maintains full type safety through:
- Generic database types that work with any Drizzle database
- Schema inference that preserves Drizzle's type system
- Proxy types that maintain original entity types
- Database adapter pattern for different database clients

## Key Files

- `src/index.ts`: Main entry point with `createUow()` function
- `src/types.ts`: Core TypeScript definitions and interfaces
- `src/schema.ts`: Test schema definitions
- `src/example.ts`: Usage examples
- `spec.md`: Detailed specification with API examples
- `memory-bank/`: Contains detailed technical context and system patterns

## Development Notes

- Uses Bun as the primary runtime but supports Node.js
- ESM modules with TypeScript configuration for modern development
- Strict TypeScript settings with comprehensive type checking
- Database adapter pattern allows extending to new database types
- Comprehensive error handling with transaction rollback
- Performance optimized with lazy proxy creation and efficient change detection

## Testing Strategy

The project includes:
- Unit tests for individual components
- Integration tests with real database operations
- Type safety verification
- Multi-database compatibility testing (planned)

Use `bun run ./src/test.ts` to run the comprehensive test suite that verifies change tracking, checkpoints, rollback functionality, and database persistence.