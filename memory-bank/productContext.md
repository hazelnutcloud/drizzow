# Product Context: drizzle-uow

## Why This Library Exists

### The Problem
When working with ORMs like DrizzleORM, developers often need to:
1. Track multiple entity changes across a session
2. Batch database operations for performance
3. Implement "all-or-nothing" transaction semantics
4. Provide undo/rollback capabilities during development
5. Reduce database round-trips by batching operations

Currently, Drizzle users must manually:
- Track which entities have changed
- Build update queries for modified fields
- Manage transaction boundaries
- Implement their own change tracking logic

### The Solution
drizzle-uow provides an elegant unit-of-work pattern implementation that:
- **Automatically tracks changes** using JavaScript proxies
- **Batches operations** into efficient transactions
- **Maintains type safety** throughout the entire process
- **Works with ANY Drizzle-supported database** (PostgreSQL, MySQL, SQLite, etc.)

## Target Users

### Primary Users
1. **Drizzle developers** who need transaction management
2. **Teams building complex applications** with multiple related entity changes
3. **Developers migrating from ORMs** with built-in unit-of-work (e.g., Entity Framework, Hibernate)

### Use Cases
1. **E-commerce platforms**: Update inventory, orders, and user data in one transaction
2. **Content management**: Manage drafts with rollback capabilities
3. **Financial applications**: Ensure data consistency across accounts
4. **Multi-tenant applications**: Batch operations for performance

## Value Proposition

### For Developers
- **Zero boilerplate**: No manual change tracking code
- **Familiar API**: Uses Drizzle's query syntax
- **Type-safe**: Full TypeScript support with inference
- **Database agnostic**: Write once, run on any Drizzle database

### For Applications
- **Performance**: Reduced database round-trips through batching
- **Reliability**: Atomic operations with rollback support
- **Maintainability**: Cleaner code without manual tracking logic
- **Flexibility**: In-memory checkpoints for complex workflows

## How It Should Work

### Developer Experience
1. **Drop-in enhancement**: Wrap existing Drizzle instance with `createUow()`
2. **Transparent tracking**: Use entities normally; changes tracked automatically
3. **Explicit saves**: Call `save()` when ready to persist
4. **Safe experimentation**: Use checkpoints to try operations risk-free

### Mental Model
Think of it as a "shopping cart" for database operations:
- Add items (changes) to your cart
- Review what's in the cart
- Checkout (save) when ready
- Or abandon cart (rollback) if needed

### Integration Philosophy
- **Non-invasive**: Doesn't replace Drizzle, extends it
- **Opt-in**: Use unit-of-work when needed, regular Drizzle when not
- **Compatible**: Works alongside existing Drizzle code
- **Progressive**: Adopt incrementally in existing projects

## Success Metrics
1. **Adoption**: Developers choose this for new Drizzle projects
2. **Performance**: Measurable reduction in database operations
3. **Developer satisfaction**: Positive feedback on ergonomics
4. **Reliability**: Zero data corruption issues
5. **Community**: Active contributions and extensions
