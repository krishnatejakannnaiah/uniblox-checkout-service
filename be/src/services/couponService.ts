
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import {
  coupons,
  orders,
  rewardConfig,
  type Coupon
} from "../store.js";

export function generateRewardCoupon(): Coupon {
  const eligibleMilestones = Math.floor(
    orders.size / rewardConfig.everyNthOrder
  );

  const generatedMilestones = new Set(
    Array.from(coupons.values(), (coupon) => coupon.milestone)
  );

  let milestone = 1;

  while (
    milestone <= eligibleMilestones &&
    generatedMilestones.has(milestone)
  ) {
    milestone++;
  }

  if (milestone > eligibleMilestones) {
    throw new AppError(
      409,
      "NO_REWARD_AVAILABLE",
      `A reward becomes available after every ${rewardConfig.everyNthOrder} successful orders.`
    );
  }

  const coupon: Coupon = {
    code: `REWARD-${milestone}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`,
    milestone,
    discountPercent: rewardConfig.discountPercent,
    status: "available",
    redeemedByOrderId: null
  };

  coupons.set(coupon.code, coupon);

  return { ...coupon };
}

export function listCoupons(): Coupon[] {
  return Array.from(coupons.values()).map((coupon) => ({
    ...coupon
  }));
}
