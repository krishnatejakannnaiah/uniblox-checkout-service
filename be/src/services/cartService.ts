
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import {
  carts,
  products,
  type Cart,
  type CartItem
} from "../store.js";

function getOpenCart(cartId: string): Cart {
  const cart = carts.get(cartId);

  if (!cart) {
    throw new AppError(404, "CART_NOT_FOUND", "Cart was not found.");
  }

  if (cart.status !== "open") {
    throw new AppError(
      409,
      "CART_ALREADY_CHECKED_OUT",
      "This cart has already been checked out."
    );
  }

  return cart;
}

function validateQuantity(quantity: unknown): asserts quantity is number {
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    throw new AppError(
      400,
      "INVALID_QUANTITY",
      "Quantity must be a positive integer."
    );
  }
}

function getProduct(productId: string) {
  const product = products.get(productId);

  if (!product) {
    throw new AppError(
      404,
      "PRODUCT_NOT_FOUND",
      `Product '${productId}' was not found.`
    );
  }

  return product;
}

export function listProducts() {
  return Array.from(products.values()).map((product) => ({
    ...product
  }));
}

export function createCart() {
  const cart: Cart = {
    id: randomUUID(),
    items: [],
    status: "open"
  };

  carts.set(cart.id, cart);
  return getCartView(cart.id);
}

export function getCartView(cartId: string) {
  const cart = carts.get(cartId);

  if (!cart) {
    throw new AppError(404, "CART_NOT_FOUND", "Cart was not found.");
  }

  const items = cart.items.map((item) => {
    const product = getProduct(item.productId);

    return {
      productId: product.id,
      name: product.name,
      unitPricePaise: product.unitPricePaise,
      quantity: item.quantity,
      lineTotalPaise: product.unitPricePaise * item.quantity
    };
  });

  const subtotalPaise = items.reduce(
    (total, item) => total + item.lineTotalPaise,
    0
  );

  return {
    id: cart.id,
    status: cart.status,
    items,
    subtotalPaise
  };
}

export function addCartItem(
  cartId: string,
  productId: string,
  quantity: unknown
) {
  const cart = getOpenCart(cartId);
  validateQuantity(quantity);

  const product = getProduct(productId);
  const existingItem = cart.items.find(
    (item) => item.productId === productId
  );

  const newQuantity = (existingItem?.quantity ?? 0) + quantity;

  if (newQuantity > product.inventory) {
    throw new AppError(
      409,
      "INSUFFICIENT_INVENTORY",
      `Only ${product.inventory} unit(s) of '${product.name}' are currently in stock.`
    );
  }

  if (existingItem) {
    existingItem.quantity = newQuantity;
  } else {
    const item: CartItem = { productId, quantity };
    cart.items.push(item);
  }

  return getCartView(cartId);
}

export function updateCartItem(
  cartId: string,
  productId: string,
  quantity: unknown
) {
  const cart = getOpenCart(cartId);
  validateQuantity(quantity);

  const product = getProduct(productId);
  const existingItem = cart.items.find(
    (item) => item.productId === productId
  );

  if (!existingItem) {
    throw new AppError(
      404,
      "CART_ITEM_NOT_FOUND",
      "That product is not in the cart."
    );
  }

  if (quantity > product.inventory) {
    throw new AppError(
      409,
      "INSUFFICIENT_INVENTORY",
      `Only ${product.inventory} unit(s) of '${product.name}' are currently in stock.`
    );
  }

  existingItem.quantity = quantity;
  return getCartView(cartId);
}

export function removeCartItem(cartId: string, productId: string) {
  const cart = getOpenCart(cartId);
  const itemIndex = cart.items.findIndex(
    (item) => item.productId === productId
  );

  if (itemIndex === -1) {
    throw new AppError(
      404,
      "CART_ITEM_NOT_FOUND",
      "That product is not in the cart."
    );
  }

  cart.items.splice(itemIndex, 1);
  return getCartView(cartId);
}
