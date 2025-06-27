# Project Brief: drizzle-uow

## Overview
An implementation of the unit-of-work pattern as an extension for DrizzleORM that provides a layer of abstraction for managing database transactions and change tracking.

## Core Requirements

### Functional Requirements
1. **Unit of Work Pattern**: Track entity changes and persist them in a single transaction
2. **Database Agnostic**: Support ALL databases that DrizzleORM supports (PostgreSQL, MySQL, SQLite, etc.)
3. **Proxy-based Change Tracking**: Use JavaScript proxies to automatically track modifications to entities
4. **Drizzle Query API Compatibility**: Implement Drizzle's query API by passing through to the underlying Drizzle object
5. **Type Safety**: Maintain full TypeScript type safety throughout the API

### Key Features
1. **Change Tracking**
   - Automatically track property changes on entities using proxies
   - Support creating new entities with `create()` method
   - Support deleting entities with `delete()` method
   - Maintain change history for rollback capabilities
   - Implement identity map pattern to ensure entity uniqueness

2. **Transaction Management**
   - `save()` method to compute changesets and persist all changes
   - `save(checkpoint)` to persist changes up to a specific checkpoint
   - Build and execute appropriate queries based on tracked changes

3. **Checkpoint System**
   - `setCheckpoint()` to mark points in time
   - `rollback()` to revert to previous checkpoints in-memory
   - Return error information on rollback operations
   - Support saving changes up to specific checkpoints

### API Surface
```typescript
const uow = createUow(db);

// Query operations (proxy-wrapped results)
const user = await uow.users.findFirst();
const users = await uow.users.findMany();

// Create new entities
const newUser = uow.users.create({ username: "new_user" });

// Delete entities
uow.users.delete(newUser);

// Automatic change tracking via proxies
user.username = "updated_username";

// Checkpoint management
const checkpoint = uow.setCheckpoint();

// Persist changes (optionally up to a specific checkpoint)
await uow.save();  // Save all changes
await uow.save(checkpoint);  // Save only up to checkpoint

// Rollback to checkpoint
const result = uow.rollback(checkpoint);
if (result.error) {
  console.log(result.error);
}
```

### Technical Constraints
- Must work as an extension to DrizzleORM, not a replacement
- Should maintain ergonomic API similar to Drizzle's existing patterns
- Type inference must work seamlessly with Drizzle schemas
- Performance overhead from proxies should be minimal

### Success Criteria
1. Seamless integration with any Drizzle-supported database
2. Intuitive API that feels natural to Drizzle users
3. Robust change tracking without manual intervention
4. Reliable rollback mechanism for in-memory changes
5. Comprehensive TypeScript support with proper type inference
