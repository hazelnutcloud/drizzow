# Drizzle-UoW

An implementation of the unit-of-work pattern as an extension for DrizzleORM

## Technicals

- This library leverages typescript and javascript proxies to implement unit-of-work in a highly ergonomic and typesafe manner. It should act as an extension for DrizzleORM, providing a layer of abstraction on top of it that provides unit-of-work capabilities.

## Code examples

```typescript
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { createUow } from "drizzle-uow";

const db = drizzle({ schema });

const uow = createUow(db);

// implements drizzle's `query` API by passing through to underlying drizzle object and wrapping objects returned in proxies
// const users = await uow.users.findMany();
const user = await uow.users.findFirst();

if (user) {
  user.username = "cool_new_username"; // uow keeps track of changes using javascript proxies
}

const newUser = uow.users.create({
  username: "new_user",
});

await uow.save(); // computes a changeset, builds queries, and persists to the database

const checkpoint = uow.setCheckpoint();

// ... do changes

const result = uow.rollback(checkpoint); // rollback to a certain checkpoint in-memory

if (result.error) {
  console.log(result.error);
}
```