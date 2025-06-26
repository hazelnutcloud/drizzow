# Active Context: drizzle-uow

## Current Focus
Setting up the initial memory bank for the drizzle-uow project. The project is in its initial phase with specifications defined but no implementation yet.

## Recent Actions
1. Created memory bank directory structure
2. Documented project requirements from spec.md
3. Clarified that the library must support ALL Drizzle databases, not just SQLite
4. Established foundational documentation files

## Next Steps

### Immediate Tasks
1. Complete memory bank initialization (this file and progress.md)
2. Begin implementing the core `createUow` function
3. Set up proxy-based change tracking system
4. Create type definitions that work across all Drizzle database types

### Implementation Priorities
1. **Type System Foundation**
   - Generic types that work with any Drizzle database
   - Proper type inference for schemas
   - Maintain Drizzle's type safety

2. **Core Proxy Implementation**
   - Entity proxy creation
   - Change tracking logic
   - Support for nested objects and arrays

3. **Basic CRUD Operations**
   - Implement `findFirst()` and `findMany()` with proxy wrapping
   - Implement `create()` method
   - Track entity states (new, modified, unchanged)

4. **Save Mechanism**
   - Change detection
   - Query building
   - Transaction management

## Active Decisions

### Architecture Choices
- **Database Agnostic**: Use generic types and adapters to support all Drizzle databases
- **Proxy-First**: JavaScript proxies as the primary change tracking mechanism
- **Extension Pattern**: Enhance Drizzle rather than replace it
- **Type Safety**: Maintain full TypeScript inference throughout

### Implementation Patterns
- **Adapter Pattern**: For database-specific operations
- **Repository Extension**: Each table gets UoW methods while preserving Drizzle's API
- **Immutable Checkpoints**: Snapshots for rollback functionality
- **Lazy Evaluation**: Create proxies only when needed

## Important Patterns and Preferences

### Code Style
- Use Bun as the primary runtime (per .clinerules)
- ESM modules with TypeScript
- Functional programming where appropriate
- Clear separation of concerns

### API Design
- Method names should match Drizzle conventions
- Async/await for all database operations
- Chainable API where it makes sense
- Clear error messages with actionable information

### Testing Approach
- Use Bun's built-in test runner
- Test against multiple database types
- Mock heavy operations for unit tests
- Real databases for integration tests

## Key Insights

### Technical Challenges
1. **Type Inference**: Preserving Drizzle's sophisticated type system while adding proxy layer
2. **Database Differences**: Handling variations in transaction APIs across databases
3. **Performance**: Minimizing proxy overhead for large datasets
4. **Memory Management**: Efficient tracking without memory leaks

### Design Principles
1. **Transparency**: Changes should be tracked without developer intervention
2. **Compatibility**: Must work seamlessly with existing Drizzle code
3. **Predictability**: Clear, consistent behavior across all operations
4. **Debuggability**: Easy to understand what changes are pending

### User Experience Goals
- Zero learning curve for Drizzle users
- Intuitive API that "just works"
- Clear error messages
- Excellent TypeScript support

## Working Context

### Current Files
- `spec.md`: Original specification with API examples
- `src/example.ts`: Type declarations showing desired API
- `src/schema.ts`: Sample schema for testing
- `src/index.ts`: Empty main file (entry point)

### Development Environment
- Bun runtime for fast development
- TypeScript for type safety
- DrizzleORM as the core dependency
- Memory bank for project continuity

### Next Session Focus
When returning to this project, start by:
1. Reading all memory bank files
2. Implementing the core `createUow` function
3. Setting up the proxy system
4. Creating initial tests

## Notes for Future Sessions
- The example in `src/example.ts` uses SQLite but remember the library must support ALL Drizzle databases
- The type declarations in example.ts show the desired API surface
- Focus on getting a minimal working version before optimizing
- Test early and often with multiple database types
