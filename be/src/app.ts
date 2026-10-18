
import express from "express";
import { AppError } from "./errors.js";
import {
  addCartItem,
  createCart,
  getCartView,
  listProducts,
  removeCartItem,
  updateCartItem
} from "./services/cartService.js";
import {
  checkout,
  getOrder
} from "./services/checkoutService.js";
import {
  generateRewardCoupon,
  listCoupons
} from "./services/couponService.js";
import { getAdminReport } from "./services/reportService.js";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "uniblox-checkout-service"
  });
});

app.get("/products", (_req, res) => {
  res.json({ products: listProducts() });
});

app.post("/carts", (_req, res) => {
  res.status(201).json({ cart: createCart() });
});

app.get("/carts/:cartId", (req, res) => {
  res.json({ cart: getCartView(req.params.cartId) });
});

app.post("/carts/:cartId/items", (req, res) => {
  const { productId, quantity } = req.body ?? {};

  if (typeof productId !== "string" || productId.trim() === "") {
    throw new AppError(
      400,
      "INVALID_PRODUCT_ID",
      "productId must be a non-empty string."
    );
  }

  const cart = addCartItem(req.params.cartId, productId, quantity);
  res.status(200).json({ cart });
});

app.patch("/carts/:cartId/items/:productId", (req, res) => {
  const { quantity } = req.body ?? {};

  const cart = updateCartItem(
    req.params.cartId,
    req.params.productId,
    quantity
  );

  res.json({ cart });
});

app.delete("/carts/:cartId/items/:productId", (req, res) => {
  const cart = removeCartItem(req.params.cartId, req.params.productId);
  res.json({ cart });
});

// Checkout routes must be registered before the error handler.
app.post("/carts/:cartId/checkout", async (req, res) => {
  const idempotencyKey = req.header("Idempotency-Key");

  if (!idempotencyKey) {
    throw new AppError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Provide an Idempotency-Key header."
    );
  }

  const { couponCode } = req.body ?? {};

  if (
    couponCode !== undefined &&
    (typeof couponCode !== "string" || couponCode.trim() === "")
  ) {
    throw new AppError(
      400,
      "INVALID_COUPON_CODE",
      "couponCode must be a non-empty string when provided."
    );
  }

  const order = await checkout(
    req.params.cartId,
    idempotencyKey,
    couponCode
  );

  res.status(201).json({ order });
});

app.get("/orders/:orderId", (req, res) => {
  res.json({ order: getOrder(req.params.orderId) });
});

app.post("/admin/coupons/generate", (_req, res) => {
  const coupon = generateRewardCoupon();
  res.status(201).json({ coupon });
});

app.get("/admin/coupons", (_req, res) => {
  res.json({ coupons: listCoupons() });
});

app.get("/admin/report", (_req, res) => {
  res.json({ report: getAdminReport() });
});

// Unknown routes.
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: "The requested endpoint does not exist."
    }
  });
});

// Error handler must be last.
app.use((
  err: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message
      }
    });
    return;
  }

  console.error(err);

  res.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred."
    }
  });
});
