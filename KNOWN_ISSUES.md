# Known Issues

This document tracks known limitations and incomplete implementations in the drizzle-uow library.

## 1. ~~Incomplete Implementation: Checkpoint Save with Create Operations~~ ✅ RESOLVED

**Status**: ~~Incomplete Implementation~~ **RESOLVED**  
**Severity**: Medium  
**Discovered**: 2025-06-30  
**Resolved**: 2025-06-30  
**Location**: `src/uow.ts` lines 326-358 (save method with checkpoint parameter)

### Description

The checkpoint save functionality (`uow.save(checkpoint)`) only handles `EntityState.Modified` entities and completely ignores `EntityState.Created` entities. This means that entities created before a checkpoint are silently skipped when saving up to that checkpoint.

### Current Behavior

```typescript
// This works - modify operations are saved
const user = await uow.users.find({ id: 1 });
user.username = "modified";
const checkpoint = uow.setCheckpoint();
// ... more operations after checkpoint
await uow.save(checkpoint); // ✅ Saves the modification

// This doesn't work - create operations are ignored
const newUser = uow.users.create({ id: 100, username: "new" });
const checkpoint = uow.setCheckpoint();
// ... more operations after checkpoint  
await uow.save(checkpoint); // ❌ Create operation is silently ignored
```

### Expected Behavior

`uow.save(checkpoint)` should save ALL operations (creates, modifies, deletes) that occurred before the checkpoint was created.

### Root Cause

In `src/uow.ts` around line 332, the checkpoint save logic only processes entities with `EntityState.Modified`:

```typescript
for (const [entity, checkpointTracked] of checkpointState) {
  const currentTracked = this.changeTracker.getTrackedEntity(entity);
  if (!currentTracked) continue;
  
  // Only handles Modified entities - Created entities are ignored!
  if (checkpointTracked.state === EntityState.Modified) {
    // ... handle modified entities
  }
  // Missing: No handling for EntityState.Created or EntityState.Deleted
}
```

### Impact

- **Functional**: Create operations before checkpoints are lost when using partial saves
- **Data Integrity**: Silent data loss - no error is thrown, operations just don't persist
- **API Consistency**: Inconsistent behavior between `save()` and `save(checkpoint)`

### Workaround

Currently, avoid using create operations with checkpoint saves. Only use modify operations:

```typescript
// Instead of creating new entities before checkpoint
const newUser = uow.users.create({ id: 100, username: "new" });
const checkpoint = uow.setCheckpoint();

// Use regular save for creates, then checkpoint save for modifies
const newUser = uow.users.create({ id: 100, username: "new" });
await uow.save(); // Save creates first

const existingUser = await uow.users.find({ id: 1 });
existingUser.username = "modified";
const checkpoint = uow.setCheckpoint();
// ... more operations
await uow.save(checkpoint); // Now safe to use checkpoint save
```

### Implementation Notes

To fix this issue, the checkpoint save logic needs to be extended to handle:

1. **EntityState.Created**: Save new entities that were created before the checkpoint
2. **EntityState.Deleted**: Process delete operations that occurred before the checkpoint
3. **Changeset Generation**: Ensure proper changeset generation for all entity states
4. **Transaction Handling**: Maintain transaction integrity across different operation types

### Test Coverage

- ✅ Existing tests cover modify operations with checkpoints
- ✅ ~~Missing tests for create operations with checkpoints~~ **ADDED**
- ✅ ~~Missing tests for delete operations with checkpoints~~ **ADDED**
- ✅ ~~Missing tests for mixed operations (create + modify + delete) with checkpoints~~ **ADDED**

### Resolution

**Fixed on**: 2025-06-30

**Changes Made**:
1. **Core Fix**: Extended checkpoint save logic in `src/uow.ts` (lines 332-358) to handle `EntityState.Added` and `EntityState.Deleted` entities in addition to `EntityState.Modified`
2. **Test Coverage**: Added comprehensive test cases in `tests/crud-interactions.test.ts`:
   - `should save create operations with checkpoint save`
   - `should save delete operations with checkpoint save` 
   - `should handle mixed operations (create, modify, delete) with checkpoint save`

**Technical Details**:
- The issue was in the checkpoint save logic that only processed entities with `EntityState.Modified`
- Added handling for `EntityState.Added` and `EntityState.Deleted` states
- All entity states are now properly included when saving up to a specific checkpoint
- Maintains transaction integrity and proper changeset generation for all operation types

**Verification**: All new tests pass, confirming that create and delete operations are now properly saved when using `uow.save(checkpoint)`

### Related Files

- `src/uow.ts` - Main implementation file
- `src/change-tracker.ts` - Entity state tracking
- `src/checkpoint-manager.ts` - Checkpoint state management
- `tests/crud-interactions.test.ts` - Test file that revealed this issue

---

## How to Add New Issues

When documenting new issues, please include:

1. **Status**: Incomplete Implementation | Bug | Limitation | Performance Issue
2. **Severity**: Critical | High | Medium | Low  
3. **Discovered**: Date when issue was found
4. **Location**: File paths and line numbers
5. **Description**: Clear explanation of the problem
6. **Current vs Expected Behavior**: Code examples showing the issue
7. **Root Cause**: Technical explanation of why it happens
8. **Impact**: How it affects users and the system
9. **Workaround**: Temporary solutions (if any)
10. **Implementation Notes**: Guidance for fixing the issue
11. **Test Coverage**: What tests exist and what's missing
12. **Related Files**: All files that would need changes