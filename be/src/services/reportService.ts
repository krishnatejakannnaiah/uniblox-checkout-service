
import { coupons, orders } from "../store.js";

export function getAdminReport() {
  let grossRevenuePaise = 0;
  let discountsPaise = 0;
  let netRevenuePaise = 0;

  const productSales = new Map<
    string,
    { productId: string; name: string; quantitySold: number }
  >();

  for (const order of orders.values()) {
    grossRevenuePaise += order.subtotalPaise;
    discountsPaise += order.discountPaise;
    netRevenuePaise += order.totalPaise;

    for (const item of order.items) {
      const existing = productSales.get(item.productId);

      if (existing) {
        existing.quantitySold += item.quantity;
      } else {
        productSales.set(item.productId, {
          productId: item.productId,
          name: item.name,
          quantitySold: item.quantity
        });
      }
    }
  }

  const allCoupons = Array.from(coupons.values());

  return {
    successfulOrders: orders.size,
    revenue: {
      grossRevenuePaise,
      discountsPaise,
      netRevenuePaise
    },
    purchasedQuantityByProduct: Array.from(productSales.values()).sort(
      (a, b) => a.productId.localeCompare(b.productId)
    ),
    coupons: {
      generated: allCoupons.length,
      available: allCoupons.filter(
        (coupon) => coupon.status === "available"
      ).length,
      redeemed: allCoupons.filter(
        (coupon) => coupon.status === "redeemed"
      ).length
    }
  };
}
