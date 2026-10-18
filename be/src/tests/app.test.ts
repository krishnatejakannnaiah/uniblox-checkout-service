
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app.js";
import { resetStore, products, coupons } from "../store.js";

let keyCounter = 0;

function nextKey() {
  keyCounter++;
  return `automated-test-${keyCounter}`;
}

async function createCartWithItem(
  productId = "p-100",
  quantity = 1
): Promise<string> {
  const cartResponse = await request(app)
    .post("/carts")
    .expect(201);

  const cartId = cartResponse.body.cart.id;

  await request(app)
    .post(`/carts/${cartId}/items`)
    .send({ productId, quantity })
    .expect(200);

  return cartId;
}

async function checkoutCart(
  cartId: string,
  key = nextKey(),
  couponCode?: string
) {
  const body = couponCode ? { couponCode } : {};

  return request(app)
    .post(`/carts/${cartId}/checkout`)
    .set("Idempotency-Key", key)
    .send(body);
}

async function placeOrder(
  productId = "p-100",
  quantity = 1
) {
  const cartId = await createCartWithItem(productId, quantity);
  const response = await checkoutCart(cartId);

  expect(response.status).toBe(201);
  return response.body.order;
}

async function earnCoupon() {
  await placeOrder();
  await placeOrder();
  await placeOrder();

  const response = await request(app)
    .post("/admin/coupons/generate")
    .expect(201);

  return response.body.coupon;
}

beforeEach(() => {
  resetStore();
  keyCounter = 0;
});

describe("Cart and checkout", () => {
  it("lists at least five products", async () => {
    const response = await request(app)
      .get("/products")
      .expect(200);

    expect(response.body.products.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects a zero quantity", async () => {
    const cart = await request(app)
      .post("/carts")
      .expect(201);

    await request(app)
      .post(`/carts/${cart.body.cart.id}/items`)
      .send({ productId: "p-100", quantity: 0 })
      .expect(400);
  });

  it("updates and removes cart items correctly", async () => {
    const cartResponse = await request(app)
      .post("/carts")
      .expect(201);

    const cartId = cartResponse.body.cart.id;

    await request(app)
      .post(`/carts/${cartId}/items`)
      .send({ productId: "p-100", quantity: 2 })
      .expect(200);

    const updated = await request(app)
      .patch(`/carts/${cartId}/items/p-100`)
      .send({ quantity: 3 })
      .expect(200);

    expect(updated.body.cart.items).toHaveLength(1);
    expect(updated.body.cart.items[0].quantity).toBe(3);
    expect(updated.body.cart.subtotalPaise).toBe(239700);

    const removed = await request(app)
      .delete(`/carts/${cartId}/items/p-100`)
      .expect(200);

    expect(removed.body.cart.items).toHaveLength(0);
    expect(removed.body.cart.subtotalPaise).toBe(0);
  });

  it("rejects checkout for an empty cart", async () => {
    const cart = await request(app)
      .post("/carts")
      .expect(201);

    const response = await checkoutCart(cart.body.cart.id);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("EMPTY_CART");
  });

  it("rejects checkout when the idempotency key is missing", async () => {
    const cartId = await createCartWithItem();

    const response = await request(app)
      .post(`/carts/${cartId}/checkout`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("creates an order and replays the same order for the same key", async () => {
    const cartId = await createCartWithItem();
    const key = "idempotency-replay-test";

    const first = await checkoutCart(cartId, key);
    expect(first.status).toBe(201);

    const retry = await checkoutCart(cartId, key);
    expect(retry.status).toBe(201);

    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(first.body.order.totalPaise).toBe(79900);

    const product = (await request(app).get("/products"))
      .body.products.find((p: { id: string }) => p.id === "p-100");

    expect(product.inventory).toBe(19);
  });

  it("rejects reusing an idempotency key for another cart", async () => {
    const firstCart = await createCartWithItem();
    const secondCart = await createCartWithItem();
    const key = "reused-key-test";

    const firstCheckout = await checkoutCart(firstCart, key);
    expect(firstCheckout.status).toBe(201);

    const response = await checkoutCart(secondCart, key);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("does not allow a completed cart to create another order", async () => {
    const cartId = await createCartWithItem();

    const original = await checkoutCart(
      cartId,
      "completed-cart-first"
    );

    expect(original.status).toBe(201);

    const retryWithDifferentKey = await checkoutCart(
      cartId,
      "completed-cart-second"
    );

    expect(retryWithDifferentKey.status).toBe(409);
    expect(retryWithDifferentKey.body.error.code)
      .toBe("CART_ALREADY_CHECKED_OUT");

    expect(products.get("p-100")?.inventory).toBe(19);

    const report = await request(app)
      .get("/admin/report")
      .expect(200);

    expect(report.body.report.successfulOrders).toBe(1);
  });

  it("preserves order prices and names if the catalogue changes", async () => {
    const cartId = await createCartWithItem("p-100", 1);
    const checkoutResponse = await checkoutCart(cartId);

    expect(checkoutResponse.status).toBe(201);

    const orderId = checkoutResponse.body.order.id;

    // Simulate a later catalogue update.
    products.get("p-100")!.name = "Renamed Mouse";
    products.get("p-100")!.unitPricePaise = 999999;

    const orderResponse = await request(app)
      .get(`/orders/${orderId}`)
      .expect(200);

    const order = orderResponse.body.order;

    expect(order.items[0].name).toBe("Wireless Mouse");
    expect(order.items[0].unitPricePaise).toBe(79900);
    expect(order.items[0].lineTotalPaise).toBe(79900);
    expect(order.subtotalPaise).toBe(79900);
    expect(order.totalPaise).toBe(79900);
  });

  it("allows only one checkout when two carts compete for the last unit", async () => {
    const firstCart = await createCartWithItem("p-104", 1);
    const secondCart = await createCartWithItem("p-104", 1);

    const results = await Promise.all([
      checkoutCart(firstCart, "competing-checkout-a"),
      checkoutCart(secondCart, "competing-checkout-b")
    ]);

    expect(results.map((result) => result.status).sort())
      .toEqual([201, 409]);

    const monitor = (await request(app).get("/products"))
      .body.products.find((p: { id: string }) => p.id === "p-104");

    expect(monitor.inventory).toBe(0);
  });
});

describe("Coupons and rewards", () => {
  it("generates one coupon per eligible milestone", async () => {
    await placeOrder();
    await placeOrder();
    await placeOrder();

    const first = await request(app)
      .post("/admin/coupons/generate")
      .expect(201);

    expect(first.body.coupon.milestone).toBe(1);
    expect(first.body.coupon.discountPercent).toBe(10);

    const duplicate = await request(app)
      .post("/admin/coupons/generate");

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("NO_REWARD_AVAILABLE");
  });

  it("applies a coupon discount and prevents a second redemption", async () => {
    const coupon = await earnCoupon();

    const cartId = await createCartWithItem();
    const orderResponse = await checkoutCart(
      cartId,
      nextKey(),
      coupon.code
    );

    expect(orderResponse.status).toBe(201);
    expect(orderResponse.body.order.discountPaise).toBe(7990);
    expect(orderResponse.body.order.totalPaise).toBe(71910);

    const secondCart = await createCartWithItem();
    const secondRedemption = await checkoutCart(
      secondCart,
      nextKey(),
      coupon.code
    );

    expect(secondRedemption.status).toBe(409);
    expect(secondRedemption.body.error.code).toBe("COUPON_UNAVAILABLE");
  });

  it("allows only one of two competing checkouts to redeem a coupon", async () => {
    const coupon = await earnCoupon();

    const firstCart = await createCartWithItem("p-100", 1);
    const secondCart = await createCartWithItem("p-100", 1);

    const results = await Promise.all([
      checkoutCart(firstCart, "coupon-race-first", coupon.code),
      checkoutCart(secondCart, "coupon-race-second", coupon.code)
    ]);

    expect(results.map((result) => result.status).sort())
      .toEqual([201, 409]);

    const successfulResponse = results.find(
      (result) => result.status === 201
    )!;

    const failedResponse = results.find(
      (result) => result.status === 409
    )!;

    expect(failedResponse.body.error.code).toBe("COUPON_UNAVAILABLE");

    const storedCoupon = coupons.get(coupon.code);

    expect(storedCoupon?.status).toBe("redeemed");
    expect(storedCoupon?.redeemedByOrderId)
      .toBe(successfulResponse.body.order.id);

    expect(products.get("p-100")?.inventory).toBe(16);

    const report = await request(app)
      .get("/admin/report")
      .expect(200);

    expect(report.body.report.successfulOrders).toBe(4);
    expect(report.body.report.coupons.redeemed).toBe(1);
  });

  it("does not consume a coupon when checkout fails", async () => {
    const coupon = await earnCoupon();
    const cartId = await createCartWithItem("p-104", 1);

    // Simulate stock becoming unavailable after the item was added.
    products.get("p-104")!.inventory = 0;

    const failedCheckout = await checkoutCart(
      cartId,
      nextKey(),
      coupon.code
    );

    expect(failedCheckout.status).toBe(409);
    expect(coupons.get(coupon.code)?.status).toBe("available");
  });
});

describe("Admin report", () => {
  it("reconciles revenue and product quantities without mutating state", async () => {
    await placeOrder("p-100", 2);
    await placeOrder("p-101", 1);

    const first = await request(app)
      .get("/admin/report")
      .expect(200);

    const second = await request(app)
      .get("/admin/report")
      .expect(200);

    const report = first.body.report;

    expect(report.successfulOrders).toBe(2);
    expect(report.revenue.grossRevenuePaise).toBe(409700);
    expect(report.revenue.discountsPaise).toBe(0);
    expect(report.revenue.netRevenuePaise).toBe(409700);

    expect(report.purchasedQuantityByProduct).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: "p-100",
          quantitySold: 2
        }),
        expect.objectContaining({
          productId: "p-101",
          quantitySold: 1
        })
      ])
    );

    expect(second.body.report).toEqual(report);
    expect(products.get("p-100")?.inventory).toBe(18);
  });
});
