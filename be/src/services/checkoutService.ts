
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import {
  carts,
  coupons,
  idempotencyRecords,
  orders,
  products,
  type Order,
  type OrderItem
} from "../store.js";

// Serialize checkout transactions within this Node.js process.
let checkoutQueue: Promise<void> = Promise.resolve();

async function withCheckoutLock<T>(
  operation: () => T
): Promise<T> {
  let release!: () => void;

  const previous = checkoutQueue;

  checkoutQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    // Keep this operation synchronous: no await inside the transaction.
    return operation();
  } finally {
    release();
  }
}

export async function checkout(
  cartId: string,
  idempotencyKey: string,
  couponCode?: string
): Promise<Order> {
  if (!idempotencyKey.trim()) {
    throw new AppError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Provide an Idempotency-Key header."
    );
  }

  return withCheckoutLock(() => {
    const fingerprint = JSON.stringify({
      cartId,
      couponCode: couponCode ?? null
    });

    // A retry must return the original order, not repeat the purchase.
    const previousRequest = idempotencyRecords.get(idempotencyKey);

    if (previousRequest) {
      if (previousRequest.fingerprint !== fingerprint) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "This idempotency key was already used for a different request."
        );
      }

      const previousOrder = orders.get(previousRequest.orderId);

      if (!previousOrder) {
        throw new AppError(
          500,
          "ORDER_RECORD_MISSING",
          "The previous order record could not be found."
        );
      }

      return previousOrder;
    }

    const cart = carts.get(cartId);

    if (!cart) {
      throw new AppError(404, "CART_NOT_FOUND", "Cart was not found.");
    }

    if (cart.status === "checked_out") {
      throw new AppError(
        409,
        "CART_ALREADY_CHECKED_OUT",
        "This cart has already been checked out."
      );
    }

    if (cart.items.length === 0) {
      throw new AppError(
        400,
        "EMPTY_CART",
        "Cannot check out an empty cart."
      );
    }

    // Validate every item before mutating any inventory.
    const orderItems: OrderItem[] = cart.items.map((item) => {
      const product = products.get(item.productId);

      if (!product) {
        throw new AppError(
          404,
          "PRODUCT_NOT_FOUND",
          `Product '${item.productId}' was not found.`
        );
      }

      if (item.quantity > product.inventory) {
        throw new AppError(
          409,
          "INSUFFICIENT_INVENTORY",
          `Insufficient stock for '${product.name}'. Available: ${product.inventory}.`
        );
      }

      return {
        productId: product.id,
        name: product.name,
        unitPricePaise: product.unitPricePaise,
        quantity: item.quantity,
        lineTotalPaise: product.unitPricePaise * item.quantity
      };
    });

    const subtotalPaise = orderItems.reduce(
      (total, item) => total + item.lineTotalPaise,
      0
    );

    let appliedCoupon = undefined;

    if (couponCode !== undefined) {
      appliedCoupon = coupons.get(couponCode);

      if (!appliedCoupon) {
        throw new AppError(
          404,
          "COUPON_NOT_FOUND",
          "Coupon was not found."
        );
      }

      if (appliedCoupon.status !== "available") {
        throw new AppError(
          409,
          "COUPON_UNAVAILABLE",
          "This coupon has already been redeemed or is unavailable."
        );
      }
    }

    const discountPaise = appliedCoupon
      ? Math.floor(
          (subtotalPaise * appliedCoupon.discountPercent) / 100
        )
      : 0;

    const orderId = randomUUID();

    const order: Order = {
      id: orderId,
      cartId,
      items: orderItems,
      subtotalPaise,
      discountPaise,
      totalPaise: subtotalPaise - discountPaise,
      couponCode: appliedCoupon?.code ?? null,
      createdAt: new Date().toISOString()
    };

    // Commit: no asynchronous work occurs between these mutations.
    for (const item of orderItems) {
      const product = products.get(item.productId)!;
      product.inventory -= item.quantity;
    }

    if (appliedCoupon) {
      appliedCoupon.status = "redeemed";
      appliedCoupon.redeemedByOrderId = orderId;
    }

    orders.set(orderId, order);
    cart.status = "checked_out";

    idempotencyRecords.set(idempotencyKey, {
      fingerprint,
      orderId
    });

    return order;
  });
}

export function getOrder(orderId: string): Order {
  const order = orders.get(orderId);

  if (!order) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found.");
  }

  return order;
}
