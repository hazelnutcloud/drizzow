import { run, bench, summary, do_not_optimize } from "mitata";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { createUow } from "./src/bun-sqlite";
import { eq } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Test Schema
export const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
});

// Setup databases
const vanillaDb = drizzle(new Database(":memory:"), { schema: { users } });
const uowDb = drizzle(new Database(":memory:"), { schema: { users } });
const uow = createUow(uowDb);

// Initialize tables
await vanillaDb.run(
  `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL)`
);
await uowDb.run(
  `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL)`
);

// Seed data for read benchmarks
const seedData = Array.from({ length: 1000 }, (_, i) => ({
  username: `user${i}`,
}));
await vanillaDb.insert(users).values(seedData);
await uowDb.insert(users).values(seedData);

console.log("🚀 Starting Drizzle UoW vs Vanilla Drizzle Benchmarks\n");

// Write-Heavy Scenarios
summary(() => {
  console.log("📝 Write-Heavy Scenarios");

  bench("Vanilla Drizzle - Single Insert", async function* () {
    let counter = 0;
    yield async () => {
      const result = await vanillaDb
        .insert(users)
        .values({ username: `bench_user_${counter++}` });
      return do_not_optimize(result);
    };
  });

  bench("UoW - Single Insert", async function* () {
    let counter = 0;
    yield async () => {
      const user = uow.users.create({ username: `bench_user_${counter++}` });
      await uow.save();
      return do_not_optimize(user);
    };
  });

  bench("Vanilla Drizzle - Batch Insert (10)", async function* () {
    let counter = 0;
    yield async () => {
      const batch = Array.from({ length: 10 }, (_, i) => ({
        username: `batch_user_${counter++}_${i}`,
      }));
      const result = await vanillaDb.insert(users).values(batch);
      return do_not_optimize(result);
    };
  });

  bench("UoW - Batch Insert (10)", async function* () {
    let counter = 0;
    yield async () => {
      const batch = Array.from({ length: 10 }, (_, i) =>
        uow.users.create({ username: `batch_user_${counter++}_${i}` })
      );
      await uow.save();
      return do_not_optimize(batch);
    };
  });

  bench("Vanilla Drizzle - Update", async function* () {
    yield async () => {
      const result = await vanillaDb
        .update(users)
        .set({ username: `updated_${Date.now()}` })
        .where(eq(users.id, 1));
      return do_not_optimize(result);
    };
  });

  bench("UoW - Update (tracked entity)", async function* () {
    yield async () => {
      const user = await uow.users.findFirst({ where: eq(users.id, 2) });
      if (user) {
        user.username = `updated_${Date.now()}`;
        await uow.save();
      }
      return do_not_optimize(user);
    };
  });
});

// Read-Heavy Scenarios
summary(() => {
  console.log("📖 Read-Heavy Scenarios");

  bench("Vanilla Drizzle - Find First", async function* () {
    yield async () => {
      const result = await vanillaDb.select().from(users).limit(1);
      return do_not_optimize(result);
    };
  });

  bench("UoW - Find First", async function* () {
    yield async () => {
      const result = await uow.users.findFirst();
      return do_not_optimize(result);
    };
  });

  bench("Vanilla Drizzle - Find Many (100)", async function* () {
    yield async () => {
      const result = await vanillaDb.select().from(users).limit(100);
      return do_not_optimize(result);
    };
  });

  bench("UoW - Find Many (100)", async function* () {
    yield async () => {
      const result = await uow.users.findMany({ limit: 100 });
      return do_not_optimize(result);
    };
  });

  bench("Vanilla Drizzle - Find by ID", async function* () {
    let id = 1;
    yield async () => {
      const result = await vanillaDb
        .select()
        .from(users)
        .where(eq(users.id, (id++ % 1000) + 1));
      return do_not_optimize(result);
    };
  });

  bench("UoW - Find by ID (with identity map)", async function* () {
    let id = 1;
    yield async () => {
      const result = await uow.users.findFirst({
        where: eq(users.id, (id++ % 1000) + 1),
      });
      return do_not_optimize(result);
    };
  });
});

// Mixed Workload Scenarios
summary(() => {
  console.log("🔄 Mixed Workload Scenarios");

  bench("Vanilla Drizzle - Read-Modify-Write", async function* () {
    let counter = 0;
    yield async () => {
      const user = await vanillaDb
        .select()
        .from(users)
        .where(eq(users.id, (counter++ % 100) + 1))
        .limit(1);
      if (user[0]) {
        const result = await vanillaDb
          .update(users)
          .set({ username: `modified_${user[0].username}_${Date.now()}` })
          .where(eq(users.id, user[0].id));
        return do_not_optimize(result);
      }
    };
  });

  bench("UoW - Read-Modify-Write (tracked)", async function* () {
    let counter = 0;
    yield async () => {
      const user = await uow.users.findFirst({
        where: eq(users.id, (counter++ % 100) + 1),
      });
      if (user) {
        user.username = `modified_${user.username}_${Date.now()}`;
        await uow.save();
      }
      return do_not_optimize(user);
    };
  });

  bench("Vanilla Drizzle - Multiple Operations", async function* () {
    let counter = 0;
    yield async () => {
      // Insert
      const insertResult = await vanillaDb
        .insert(users)
        .values({ username: `multi_${counter++}` });
      // Read
      const readResult = await vanillaDb.select().from(users).limit(5);
      // Update
      const updateResult = await vanillaDb
        .update(users)
        .set({ username: `updated_multi_${Date.now()}` })
        .where(eq(users.id, (counter % 50) + 1));

      return do_not_optimize([insertResult, readResult, updateResult]);
    };
  });

  bench("UoW - Multiple Operations (batched)", async function* () {
    let counter = 0;
    yield async () => {
      // Insert
      const newUser = uow.users.create({ username: `multi_${counter++}` });
      // Read
      const readResult = await uow.users.findMany({ limit: 5 });
      // Update
      const userToUpdate = await uow.users.findFirst({
        where: eq(users.id, (counter % 50) + 1),
      });
      if (userToUpdate) {
        userToUpdate.username = `updated_multi_${Date.now()}`;
      }

      // All operations committed in single transaction
      await uow.save();

      return do_not_optimize([newUser, readResult, userToUpdate]);
    };
  });
});

// Transaction Scenarios
summary(() => {
  console.log("💾 Transaction Scenarios");

  bench("Vanilla Drizzle - Transaction (5 inserts)", async function* () {
    let counter = 0;
    yield async () => {
      const result = await vanillaDb.transaction(async (tx) => {
        const results = [];
        for (let i = 0; i < 5; i++) {
          results.push(
            await tx
              .insert(users)
              .values({ username: `tx_user_${counter++}_${i}` })
          );
        }
        return results;
      });
      return do_not_optimize(result);
    };
  });

  bench("UoW - Transaction (5 inserts)", async function* () {
    let counter = 0;
    yield async () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        results.push(
          uow.users.create({ username: `tx_user_${counter++}_${i}` })
        );
      }
      await uow.save(); // Single transaction for all operations
      return do_not_optimize(results);
    };
  });
});

// Memory and Change Tracking Overhead
summary(() => {
  console.log("🧠 Memory & Change Tracking Overhead");

  bench("Vanilla Drizzle - Large Read (1000 records)", async function* () {
    yield async () => {
      const result = await vanillaDb.select().from(users);
      return do_not_optimize(result);
    };
  }).gc("inner");

  bench("UoW - Large Read (1000 records, proxied)", async function* () {
    yield async () => {
      const result = await uow.users.findMany();
      return do_not_optimize(result);
    };
  }).gc("inner");

  bench("UoW - Property Access (tracked entity)", async function* () {
    yield async () => {
      const user = await uow.users.findFirst();
      if (user) {
        // Access properties multiple times to test proxy overhead
        const accesses = [user.id, user.username, user.id, user.username];
        return do_not_optimize(accesses);
      }
    };
  });

  bench("Vanilla Object - Property Access (baseline)", async function* () {
    yield async () => {
      const user = await vanillaDb.select().from(users).limit(1);
      if (user[0]) {
        // Same property accesses on vanilla object
        const accesses = [
          user[0].id,
          user[0].username,
          user[0].id,
          user[0].username,
        ];
        return do_not_optimize(accesses);
      }
    };
  });
});

await run();
