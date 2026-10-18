
export interface Product {
  id: string;
  name: string;
  unitPricePaise: number;
  inventory: number;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
  status: "open" | "checked_out";
}

export interface OrderItem {
  productId: string;
  name: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface Order {
  id: string;
  cartId: string;
  items: OrderItem[];
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  couponCode: string | null;
  createdAt: string;
}

export interface Coupon {
  code: string;
  milestone: number;
  discountPercent: number;
  status: "available" | "redeemed";
  redeemedByOrderId: string | null;
}

export interface IdempotencyRecord {
  fingerprint: string;
  orderId: string;
}

export const products = new Map<string, Product>([
  ["p-100", {
    id: "p-100",
    name: "Wireless Mouse",
    unitPricePaise: 79900,
    inventory: 20
  }],
  ["p-101", {
    id: "p-101",
    name: "Mechanical Keyboard",
    unitPricePaise: 249900,
    inventory: 10
  }],
  ["p-102", {
    id: "p-102",
    name: "USB-C Hub",
    unitPricePaise: 189900,
    inventory: 8
  }],
  ["p-103", {
    id: "p-103",
    name: "Laptop Stand",
    unitPricePaise: 129900,
    inventory: 5
  }],
  ["p-104", {
    id: "p-104",
    name: "4K Monitor",
    unitPricePaise: 2499900,
    inventory: 1
  }]
]);

export const carts = new Map<string, Cart>();
export const orders = new Map<string, Order>();
export const coupons = new Map<string, Coupon>();
export const idempotencyRecords = new Map<string, IdempotencyRecord>();

export const rewardConfig = {
  everyNthOrder: 3,
  discountPercent: 10
};

export function resetStore(): void {
  products.clear();
  carts.clear();
  orders.clear();
  coupons.clear();
  idempotencyRecords.clear();

  const seededProducts: Product[] = [
    {
      id: "p-100",
      name: "Wireless Mouse",
      unitPricePaise: 79900,
      inventory: 20
    },
    {
      id: "p-101",
      name: "Mechanical Keyboard",
      unitPricePaise: 249900,
      inventory: 10
    },
    {
      id: "p-102",
      name: "USB-C Hub",
      unitPricePaise: 189900,
      inventory: 8
    },
    {
      id: "p-103",
      name: "Laptop Stand",
      unitPricePaise: 129900,
      inventory: 5
    },
    {
      id: "p-104",
      name: "4K Monitor",
      unitPricePaise: 2499900,
      inventory: 1
    }
  ];

  for (const product of seededProducts) {
    products.set(product.id, product);
  }
}
