# Technical Context: drizzle-uow

## Technology Stack

### Core Dependencies
- **TypeScript**: ^5.x (peer dependency)
- **DrizzleORM**: ^0.44.2 (core dependency)
- **Bun**: Development runtime (supports Node.js as well)

### Development Tools
- **Bun**: Fast JavaScript runtime for development and testing
- **TypeScript**: For type safety and developer experience
- **@types/bun**: Type definitions for Bun runtime

## Development Setup

### Installation
```bash
bun install
```

### Running the Project
```bash
bun run ./src/index.ts
```

### Testing
```bash
bun test
```

## Technical Constraints

### Database Support
- Must support ALL Drizzle-compatible databases:
  - PostgreSQL
  - MySQL
  - SQLite
  - And any future Drizzle-supported databases

### Type System Requirements
1. **Generic Database Types**: Handle different database client types
2. **Schema Inference**: Work with Drizzle's schema type system
3. **Query Builder Types**: Maintain compatibility with Drizzle's query builders
4. **Insert/Select Models**: Properly infer insert and select types

### Proxy Implementation
- Use JavaScript Proxy API for change tracking
- Handle nested object modifications
- Track array mutations
- Maintain referential integrity

### Performance Considerations
1. **Proxy Overhead**: Minimize performance impact
2. **Memory Usage**: Efficient storage of change history
3. **Query Batching**: Optimize database operations
4. **Lazy Loading**: Support Drizzle's lazy loading patterns

## API Design Principles

### Consistency with Drizzle
- Method names match Drizzle's conventions
- Return types align with Drizzle's patterns
- Error handling follows Drizzle's approach

### Extension Points
- Allow custom change tracking strategies
- Support middleware for save operations
- Enable custom serialization for checkpoints

## Database Adapter Strategy

### Generic Implementation
```typescript
// Support any Drizzle database type
type AnyDrizzleDB = 
  | BunSQLiteDatabase<any>
  | PostgresJsDatabase<any>
  | MySql2Database<any>
  // ... other Drizzle database types
```

### Transaction Handling
- Use database-specific transaction APIs
- Ensure ACID compliance
- Handle connection pooling appropriately

## Build and Distribution

### Package Structure
```
drizzle-uow/
├── src/
│   ├── index.ts          # Main export
│   ├── uow.ts           # Core UoW implementation
│   ├── proxy.ts         # Proxy-based tracking
│   ├── changeset.ts     # Change management
│   └── types.ts         # TypeScript types
├── tests/
│   ├── sqlite.test.ts   # SQLite-specific tests
│   ├── postgres.test.ts # PostgreSQL tests
│   └── mysql.test.ts    # MySQL tests
└── package.json
```

### Export Strategy
- ESM modules (type: "module")
- CommonJS compatibility via build process
- TypeScript declaration files

## Testing Strategy

### Multi-Database Testing
1. **Unit Tests**: Mock database interactions
2. **Integration Tests**: Real database connections
3. **Database Matrix**: Test against all supported databases
4. **Type Tests**: Ensure type safety across databases

### Test Infrastructure
- Use Bun's built-in test runner
- Docker containers for database instances
- GitHub Actions for CI/CD

## Security Considerations

### SQL Injection Prevention
- Leverage Drizzle's parameterized queries
- No raw SQL construction
- Validate user inputs at boundaries

### Data Integrity
- Atomic operations within transactions
- Proper error rollback
- Consistent state management

## Future Considerations

### Extensibility
- Plugin system for custom behaviors
- Hooks for lifecycle events
- Custom storage backends for change history

### Performance Optimizations
- Lazy proxy creation
- Batch operation optimization
- Connection pooling strategies

### Community Integration
- npm/jsr package publishing
- Documentation site
- Example projects
- Integration guides
