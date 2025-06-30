import { describe, it, expect, beforeEach } from "bun:test";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { drizzow, type CreateUowReturnType } from "../src/bun-sqlite";
import { integer, sqliteTable, text, real } from "drizzle-orm/sqlite-core";

// Define test schema with more complex relationships
const users = sqliteTable("users", {
  id: integer().primaryKey({ autoIncrement: true }),
  username: text().notNull(),
  email: text(),
  balance: real().default(0),
  status: text().default("active"),
});

const orders = sqliteTable("orders", {
  id: integer().primaryKey({ autoIncrement: true }),
  userId: integer().references(() => users.id),
  total: real().notNull(),
  status: text().default("pending"),
  createdAt: integer({ mode: "timestamp" }).default(new Date()),
});

const orderItems = sqliteTable("order_items", {
  id: integer().primaryKey({ autoIncrement: true }),
  orderId: integer().references(() => orders.id),
  productName: text().notNull(),
  quantity: integer().notNull(),
  price: real().notNull(),
});

const schema = { users, orders, orderItems };

describe("Advanced Checkpoint Scenarios", () => {
  let db: BunSQLiteDatabase<typeof schema>;
  let uow: CreateUowReturnType<BunSQLiteDatabase<typeof schema>>;

  beforeEach(async () => {
    // Create in-memory database
    const sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT,
        balance REAL DEFAULT 0,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER REFERENCES users(id),
        total REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        orderId INTEGER REFERENCES orders(id),
        productName TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL
      );
    `);

    // Insert test data
    await db.insert(schema.users).values([
      { username: "alice", email: "alice@example.com", balance: 1000 },
      { username: "bob", email: "bob@example.com", balance: 500 },
      { username: "charlie", email: "charlie@example.com", balance: 750 },
    ]);

    await db.insert(schema.orders).values([
      { userId: 1, total: 150, status: "completed" },
      { userId: 2, total: 200, status: "pending" },
      { userId: 1, total: 300, status: "pending" },
    ]);

    await db.insert(schema.orderItems).values([
      { orderId: 1, productName: "Widget A", quantity: 2, price: 50 },
      { orderId: 1, productName: "Widget B", quantity: 1, price: 50 },
      { orderId: 2, productName: "Gadget X", quantity: 1, price: 200 },
      { orderId: 3, productName: "Widget A", quantity: 3, price: 50 },
      { orderId: 3, productName: "Gadget Y", quantity: 1, price: 150 },
    ]);

    // Create UoW instance
    uow = drizzow(db);
  });

  describe("Business Transaction Scenarios", () => {
    it("should handle order processing with checkpoints", async () => {
      // Load user and their pending order
      const user = await uow.users.find({ id: 1 });
      const order = await uow.orders.find({ id: 3 }); // Pending order
      const orderItems = await uow.orderItems.find({ id: [4, 5] });

      expect(user!.balance).toBe(1000);
      expect(order!.status).toBe("pending");

      // Checkpoint before processing
      const beforeProcessing = uow.setCheckpoint();

      // Process order: deduct balance
      user!.balance! -= order!.total;

      // Checkpoint after balance deduction
      const afterBalanceDeduction = uow.setCheckpoint();

      // Update order status
      order!.status = "processing";

      // Checkpoint after status update
      const afterStatusUpdate = uow.setCheckpoint();

      // Simulate shipping calculation that might fail
      let shippingCost = 50;
      user!.balance! -= shippingCost;

      // Oops, shipping calculation was wrong, rollback to after status update
      uow.rollback(afterStatusUpdate);

      // User balance should be restored to after order deduction only
      expect(user!.balance).toBe(700); // 1000 - 300
      expect(order!.status).toBe("processing");

      // Complete the order
      order!.status = "completed";

      // Save everything
      await uow.save();

      // Verify in database
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      const dbOrder = await db.query.orders.findFirst({
        where: (orders, { eq }) => eq(orders.id, 3),
      });

      expect(dbUser?.balance).toBe(700);
      expect(dbOrder?.status).toBe("completed");
    });

    it("should handle multi-user transaction with rollback", async () => {
      // Scenario: Transfer money between users
      const alice = await uow.users.find({ id: 1 });
      const bob = await uow.users.find({ id: 2 });

      const aliceInitialBalance = alice!.balance;
      const bobInitialBalance = bob!.balance;
      const transferAmount = 250;

      // Checkpoint before transfer
      const beforeTransfer = uow.setCheckpoint();

      // Deduct from Alice
      alice!.balance -= transferAmount;

      // Checkpoint after deduction
      const afterDeduction = uow.setCheckpoint();

      // Add to Bob
      bob!.balance += transferAmount;

      // Checkpoint after addition
      const afterAddition = uow.setCheckpoint();

      // Create transfer record (order)
      const transferRecord = uow.orders.create({
        id: 100,
        userId: 1,
        total: -transferAmount, // Negative for transfer out
        status: "transfer",
      });

      // Simulate validation failure - Alice doesn't have enough after fees
      const fees = 10;
      if (alice!.balance - fees < 0) {
        // Rollback entire transfer
        uow.rollback(beforeTransfer);

        expect(alice!.balance).toBe(aliceInitialBalance);
        expect(bob!.balance).toBe(bobInitialBalance);
        expect(await uow.orders.find({ id: 100 })).toBeUndefined();
      }
    });

    it("should handle inventory management with checkpoints", async () => {
      // Complex scenario: Process multiple orders with inventory tracking
      const orders = await uow.orders.find({ id: [2, 3] }); // Pending orders
      const processedOrders: number[] = [];

      // Checkpoint before batch processing
      const batchStart = uow.setCheckpoint();

      for (const order of orders) {
        const orderCheckpoint = uow.setCheckpoint();

        try {
          // Get order items
          const items = await uow.orderItems.find({
            id: order.id === 2 ? [3] : [4, 5],
          });

          // Process order
          order.status = "processing";

          // Simulate inventory check - might fail
          const hasInventory = Math.random() > 0.3; // 70% success rate

          if (!hasInventory) {
            // Rollback this order only
            uow.rollback(orderCheckpoint);
            continue;
          }

          // Complete order
          order.status = "completed";
          processedOrders.push(order.id);
        } catch (error) {
          // Rollback this order
          uow.rollback(orderCheckpoint);
        }
      }

      // Save all successfully processed orders
      await uow.save();

      // Verify only processed orders were updated
      for (const orderId of [2, 3]) {
        const dbOrder = await db.query.orders.findFirst({
          where: (orders, { eq }) => eq(orders.id, orderId),
        });

        if (processedOrders.includes(orderId)) {
          expect(dbOrder?.status).toBe("completed");
        } else {
          expect(dbOrder?.status).toBe("pending");
        }
      }
    });
  });

  describe("Checkpoint Chain Management", () => {
    it("should handle long checkpoint chains", async () => {
      const user = await uow.users.find({ id: 1 });
      const checkpoints: number[] = [];
      const values: number[] = [];

      // Create a long chain of checkpoints with different values
      for (let i = 0; i < 20; i++) {
        user!.balance = i * 100;
        values.push(i * 100);
        checkpoints.push(uow.setCheckpoint());
      }

      // Verify we can rollback to any checkpoint
      for (let i = checkpoints.length - 1; i >= 0; i--) {
        uow.rollback(checkpoints[i]!);
        expect(user!.balance).toBe(values[i]!);
      }
    });

    it("should handle checkpoint pruning correctly", () => {
      const checkpoints: number[] = [];

      // Create more than the limit
      for (let i = 0; i < 55; i++) {
        checkpoints.push(uow.setCheckpoint());
      }

      // Should keep most recent 50
      const available = uow.getStats().checkpointCount;
      expect(available).toBe(50);

      // Oldest checkpoints should be pruned
      for (let i = 0; i < 5; i++) {
        expect(uow.rollback(checkpoints[i]!).error).toBeDefined();
      }

      // Recent checkpoints should exist
      for (let i = 5; i < 55; i++) {
        expect(uow.rollback(checkpoints[i]!).error).toBe(null);
      }
    });

    it("should maintain checkpoint integrity after partial saves", async () => {
      const user = await uow.users.find({ id: 1 });

      user!.balance = 900;
      const cp1 = uow.setCheckpoint();

      user!.balance = 800;
      const cp2 = uow.setCheckpoint();

      user!.balance = 700;
      const cp3 = uow.setCheckpoint();

      user!.balance = 600;

      // Save up to cp2
      await uow.save(cp2);

      // After saving to a checkpoint, we can verify the database state
      const dbUser = await db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, 1),
      });
      expect(dbUser?.balance).toBe(800); // Value at cp2

      // Can still rollback to cp3
      uow.rollback(cp3);
      expect(user!.balance).toBe(700);
    });
  });

  describe("Performance and Stress Testing", () => {
    it("should handle large number of entities with checkpoints", async () => {
      const startTime = Date.now();

      // Create many entities
      const newUsers = [];
      for (let i = 0; i < 100; i++) {
        newUsers.push(
          uow.users.create({
            id: 1000 + i,
            username: `user_${i}`,
            email: `user${i}@example.com`,
            balance: i * 10,
            status: "active", // Explicitly set the status
          }),
        );
      }

      const createTime = Date.now() - startTime;
      expect(createTime).toBeLessThan(1000); // Should be fast

      // Set checkpoint
      const checkpoint = uow.setCheckpoint();

      // Modify all entities
      const modifyStart = Date.now();
      newUsers.forEach((user, i) => {
        user.balance = i * 20;
        user.status = "modified";
      });
      const modifyTime = Date.now() - modifyStart;
      expect(modifyTime).toBeLessThan(100); // Should be very fast

      // Rollback
      const rollbackStart = Date.now();
      uow.rollback(checkpoint);
      const rollbackTime = Date.now() - rollbackStart;
      expect(rollbackTime).toBeLessThan(100); // Should be fast

      // Verify all entities are restored
      newUsers.forEach((user, i) => {
        expect(user.balance).toBe(i * 10);
        // Status should be "active" (default value from schema)
        expect(user.status).toBe("active");
      });
    });

    it("should handle deep object modifications with checkpoints", async () => {
      // Load all data
      const users = await uow.users.find({ id: [1, 2, 3] });
      const orders = await uow.orders.find({ id: [1, 2, 3] });
      const orderItems = await uow.orderItems.find({ id: [1, 2, 3, 4, 5] });

      const checkpoint = uow.setCheckpoint();

      // Make many modifications
      users.forEach((user) => {
        user.balance *= 2;
        user.status = "premium";
        user.email = `new_${user.email}`;
      });

      orders.forEach((order) => {
        order.total *= 1.1; // 10% increase
        order.status = "updated";
      });

      orderItems.forEach((item) => {
        item.quantity += 1;
        item.price *= 0.9; // 10% discount
      });

      // Get memory info before rollback
      const memInfoBefore = uow.getStats().trackedEntities;
      expect(memInfoBefore).toBeGreaterThan(0);

      // Rollback everything
      uow.rollback(checkpoint);

      // Verify all entities are restored
      const dbUsers = await db.query.users.findMany();
      const dbOrders = await db.query.orders.findMany();

      users.forEach((user, i) => {
        expect(user.balance).toBe(dbUsers[i]!.balance);
        expect(user.status).toBe(dbUsers[i]!.status);
        expect(user.email).toBe(dbUsers[i]!.email);
      });
    });
  });

  describe("Checkpoint Interactions with Queries", () => {
    it("should handle checkpoints with complex find operations", async () => {
      // Find multiple entities
      const users = await uow.users.find({ id: [1, 2, 3] });

      const cp1 = uow.setCheckpoint();

      // Modify some users
      users[0].balance = 2000;
      users[1].status = "inactive";

      // Find more entities (should use identity map)
      const sameUsers = await uow.users.find({ id: [1, 2] });
      expect(sameUsers[0]).toBe(users[0]); // Same reference
      expect(sameUsers[0].balance).toBe(2000); // See modification

      const cp2 = uow.setCheckpoint();

      // Delete a user
      uow.users.delete(users[2]!);

      // Try to find deleted user
      const deletedUser = await uow.users.find({ id: 3 });
      expect(deletedUser).toBeUndefined();

      // Rollback to cp1
      uow.rollback(cp1);

      // All modifications should be undone
      expect(users[0]?.balance).toBe(1000);
      expect(users[1]?.status).toBe("active");

      // Deleted user should be findable again
      const restoredUser = await uow.users.find({ id: 3 });
      expect(restoredUser).toBeDefined();
      expect(restoredUser).toEqual(users[2]!); // Same reference
    });

    it("should handle checkpoint with batch operations", async () => {
      // Batch create
      const newOrders = [];
      for (let i = 0; i < 10; i++) {
        newOrders.push(
          uow.orders.create({
            id: 200 + i,
            userId: 1,
            total: 100 + i * 10,
            status: "new",
          }),
        );
      }

      const cp1 = uow.setCheckpoint();

      // Batch modify
      newOrders.forEach((order, i) => {
        order.status = "processed";
        order.total += 50;
      });

      const cp2 = uow.setCheckpoint();

      // Batch delete half
      for (let i = 0; i < 5; i++) {
        uow.orders.delete(newOrders[i]!);
      }

      // Save up to cp1 (only creates)
      await uow.save(cp1);

      // Verify only creates were saved
      for (let i = 0; i < 10; i++) {
        const dbOrder = await db.query.orders.findFirst({
          where: (orders, { eq }) => eq(orders.id, 200 + i),
        });
        expect(dbOrder).toBeDefined();
        expect(dbOrder?.status).toBe("new"); // Not "processed"
        expect(dbOrder?.total).toBe(100 + i * 10); // Original value
      }

      // In memory, rollback to cp2
      uow.rollback(cp2);

      // Should have all 10 orders in memory, modified but not deleted
      for (let i = 0; i < 10; i++) {
        const order = await uow.orders.find({ id: 200 + i });
        expect(order).toBeDefined();
        expect(order?.status).toBe("processed");
      }
    });
  });

  describe("Error Recovery Scenarios", () => {
    it("should recover from checkpoint corruption", async () => {
      const user = await uow.users.find({ id: 1 });

      user!.balance = 500;
      const cp1 = uow.setCheckpoint();

      user!.balance = 300;
      const cp2 = uow.setCheckpoint();

      // Simulate checkpoint data issue by clearing and recreating
      uow.checkpointManager.clearCheckpoints();

      // Should handle missing checkpoint gracefully
      const result = uow.rollback(cp1);
      expect(result.error).toBeDefined();

      // Entity should maintain current state
      expect(user!.balance).toBe(300);
    });

    it("should handle entity deletion during checkpoint operations", async () => {
      const user = await uow.users.find({ id: 1 });
      const order = await uow.orders.find({ id: 1 });

      const cp1 = uow.setCheckpoint();

      // Delete user
      uow.users.delete(user!);

      const cp2 = uow.setCheckpoint();

      // Rollback to before user deletion
      uow.rollback(cp1);

      // User should be restored
      const restoredUser = await uow.users.find({ id: 1 });
      expect(restoredUser).toBeDefined();
      expect(restoredUser).toEqual(user!);

      // Order modification should also be rolled back
      expect(order!.status).toBe("completed");
    });
  });
});
