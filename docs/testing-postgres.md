# Testing with PostgreSQL

This project includes commands to easily test the PostgreSQL adapter using Docker.

## Prerequisites

- Docker installed on your system
- Bun runtime

## Available Commands

### Start PostgreSQL Container
```bash
bun run docker:postgres:up
```
This command:
- Starts a PostgreSQL 16 Alpine container
- Exposes PostgreSQL on port 5432
- Creates a test database with credentials:
  - User: `postgres`
  - Password: `postgres`
  - Database: `test`
- Waits for PostgreSQL to be ready before returning

### Stop PostgreSQL Container
```bash
bun run docker:postgres:down
```
This command:
- Stops the PostgreSQL container
- Removes the container and its volumes

### Run PostgreSQL Tests
```bash
bun run test:postgres
```
This command:
- Runs the PostgreSQL adapter tests
- Requires PostgreSQL to be running (use `docker:postgres:up` first)
- Uses the PG_TEST_DB_URL environment variable

### Full Test Cycle
```bash
bun run test:postgres:full
```
This command:
- Starts PostgreSQL container
- Runs all PostgreSQL tests
- Stops and removes the container
- Useful for CI/CD pipelines

## Manual Testing

You can also manually set the PG_TEST_DB_URL environment variable:

```bash
export PG_TEST_DB_URL=postgresql://postgres:postgres@localhost:5432/test
bun test src/node-postgres/adapter.test.ts
```

