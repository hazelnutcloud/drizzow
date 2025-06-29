import { run, bench, summary, boxplot } from "mitata";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import { eq, sql } from "drizzle-orm";
import { createUow } from "../src/bun-sqlite";

// Define schema for accounts
const accounts = sqliteTable("accounts", {
  address: text("address").primaryKey(),
  balance: real("balance").notNull().default(0),
});

// Generate random ERC20 transfer events
interface TransferEvent {
  from: string;
  to: string;
  value: number;
}

function generateAddress(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function generateTransferEvents(
  count: number,
  uniqueAddresses: number,
): TransferEvent[] {
  const events: TransferEvent[] = [];

  for (let i = 0; i < count; i++) {
    const from = generateAddress(Math.floor(Math.random() * uniqueAddresses));
    const to = generateAddress(Math.floor(Math.random() * uniqueAddresses));
    const value = Math.floor(Math.random() * 1000) + 1;

    events.push({ from, to, value });
  }

  return events;
}

// Setup database
function setupDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { accounts } });

  // Create table
  db.run(`
    CREATE TABLE accounts (
      address TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0
    )
  `);

  return { sqlite, db };
}

// UoW implementation
async function uowIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof accounts }>,
  events: TransferEvent[],
) {
  const uow = createUow(db);

  for (const event of events) {
    // Handle sender (from)
    if (event.from !== "0x0000000000000000000000000000000000000000") {
      let sender = await uow.accounts.find({
        address: event.from,
      });

      if (!sender) {
        sender = uow.accounts.create({
          address: event.from,
          balance: 0,
        });
      }

      sender.balance -= event.value;
    }

    // Handle receiver (to)
    if (event.to !== "0x0000000000000000000000000000000000000000") {
      let receiver = await uow.accounts.find({
        address: event.to,
      });

      if (!receiver) {
        receiver = uow.accounts.create({
          address: event.to,
          balance: 0,
        });
      }

      receiver.balance += event.value;
    }
  }

  await uow.save();
}

// Vanilla implementation (similar to their ERC20 indexer)
async function vanillaIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof accounts }>,
  events: TransferEvent[],
) {
  // Process each event individually like Ponder does
  for (const event of events) {
    await db.transaction(async (tx) => {
      // Handle sender (from)
      if (event.from !== "0x0000000000000000000000000000000000000000") {
        await tx
          .insert(accounts)
          .values({ address: event.from, balance: 0 })
          .onConflictDoUpdate({
            target: accounts.address,
            set: {
              balance: sql`${accounts.balance} - ${event.value}`,
            },
          });
      }

      // Handle receiver (to)
      if (event.to !== "0x0000000000000000000000000000000000000000") {
        await tx
          .insert(accounts)
          .values({ address: event.to, balance: event.value })
          .onConflictDoUpdate({
            target: accounts.address,
            set: {
              balance: sql`${accounts.balance} + ${event.value}`,
            },
          });
      }
    });
  }
}

// Run benchmarks
console.log("🚀 ERC20 Transfer Events Indexing Benchmark\n");

boxplot(() => {
  summary(() => {
    bench(
      "UoW - $events events ($addresses addresses)",
      async function* (state: any) {
        const eventCount = state.get("events");
        const addressCount = state.get("addresses");
        const events = generateTransferEvents(eventCount, addressCount);

        yield async () => {
          const { db } = setupDatabase();
          await uowIndexing(db, events);
        };
      },
    ).args({ events: [100, 500, 1000], addresses: [200, 500, 1000] });

    bench(
      "Vanilla - $events events ($addresses addresses)",
      async function* (state: any) {
        const eventCount = state.get("events");
        const addressCount = state.get("addresses");
        const events = generateTransferEvents(eventCount, addressCount);

        yield async () => {
          const { db } = setupDatabase();
          await vanillaIndexing(db, events);
        };
      },
    ).args({ events: [100, 500, 1000], addresses: [200, 500, 1000] });
  });
});

// Additional focused benchmarks
console.log("\n📊 Focused Performance Tests\n");

summary(() => {
  bench("High Reuse - UoW", async function* () {
    const events = generateTransferEvents(1000, 100); // 100 events, only 10 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await uowIndexing(db, events);
    };
  });

  bench("High Reuse - Vanilla", async function* () {
    const events = generateTransferEvents(1000, 100); // 100 events, only 10 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await vanillaIndexing(db, events);
    };
  });

  bench("Low Reuse - UoW", async function* () {
    const events = generateTransferEvents(1000, 1000); // 1000 events, 1000 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await uowIndexing(db, events);
    };
  });

  bench("Low Reuse - Vanilla", async function* () {
    const events = generateTransferEvents(1000, 1000); // 1000 events, 1000 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await vanillaIndexing(db, events);
    };
  });
});

// Memory usage test
console.log("\n💾 Memory Usage Analysis\n");

summary(() => {
  bench("Memory - UoW (1000 events)", async function* () {
    const events = generateTransferEvents(10000, 2000);

    yield async () => {
      const { db } = setupDatabase();
      await uowIndexing(db, events);
    };
  }).gc();

  bench("Memory - Vanilla (1000 events)", async function* () {
    const events = generateTransferEvents(10000, 2000);

    yield async () => {
      const { db } = setupDatabase();
      await vanillaIndexing(db, events);
    };
  }).gc();
});

await run();
