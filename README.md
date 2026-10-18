# Assignment

You are designing an ecommerce store. Clients can add items to their cart and checkout to successfully place an order.  The store has a discount system that rewards customers.

We would like you to design and implement APIs for adding items to cart and checkout functionality. The checkout API would validate if the discount code is valid before giving the discount. 

Discount System works in the following ways - Every Every *n*th order gets a coupon code for x% discount. Discount codes can be applied at checkout. 

The store also has two admin API's:
1. Generate a discount code if the condition above is satisfied.
2. Lists count of items purchased, revenue, discount codes and total discounts given. 

You can build this with a technology stack that you are comfortable with. You would push the code to your github repo and share the link once its complete. We would like to see your commits that show progression and thought process as to how you are completing the exercise. 

## What We're Looking For

We want to see **how you think**, not just that you can produce working code. You are encouraged to use AI tools to help you code faster, but you must demonstrate understanding of your choices.

### Required Deliverables

#### 1. Working Code
- Functional APIs (backend required, frontend is a plus)
- Code quality
- In-memory store is fine (no database needed)
- Unit tests for core business logic
- Code comments, readme docs

#### 2. DECISIONS.md (Required)
Create a `DECISIONS.md` file documenting **at least 5 design decisions** you made. For each decision:

```markdown
## Decision: [Title]

**Context:** What problem were you solving?

**Options Considered:**
- Option A: [description]
- Option B: [description]

**Choice:** [What you chose]

**Why:** [Your reasoning - trade-offs, constraints, future considerations]
```
## Submission

1. Push to your GitHub repo
2. Ensure repo contains:
   - Source code
   - `README.md` with setup instructions
   - `DECISIONS.md` with your design decisions
   - Tests
3. Share the repo link


## FAQ:
**Q: Can I use AI tools like GitHub Copilot or ChatGPT?**  
A: Yes! But you must understand and be able to explain every line of code. We will ask about your implementation in the follow-up interview.

**Q: Do I need a database?**  
A: No, in-memory storage is fine.

**Q: Frontend required?**  
A: Backend is required. Frontend is a plus but not required. If no frontend, provide Postman collection or similar.

**Q: What tech stack should I use?**  
A: Whatever you're most comfortable with. We primarily work with TypeScript/Node.js, but use what lets you demonstrate your skills best.

All the best!

---

# Implementation: Checkout and Rewards Service

## Technology

- Node.js and TypeScript
- Express 5
- Vitest and Supertest for automated API tests
- In-memory storage for products, carts, orders, and coupons

## Prerequisites

Install a supported Node.js version. This project was developed and tested with Node.js 22.

## Setup

From the repository root, run:

```powershell
cd be
npm install
```

## Run the service

```powershell
npm run dev
```

The default address is `http://localhost:3000`.

Check service health:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## Run checks

From the `be` directory:

```powershell
npx tsc --noEmit
npm test
```

## API reference

All request and response bodies use JSON unless otherwise noted.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Service health |
| GET | `/products` | List products and current inventory |
| POST | `/carts` | Create a cart |
| GET | `/carts/:cartId` | Retrieve a cart and totals |
| POST | `/carts/:cartId/items` | Add a product to a cart |
| PATCH | `/carts/:cartId/items/:productId` | Change an item's quantity |
| DELETE | `/carts/:cartId/items/:productId` | Remove an item |
| POST | `/carts/:cartId/checkout` | Check out a cart |
| GET | `/orders/:orderId` | Retrieve an order |
| POST | `/admin/coupons/generate` | Generate an eligible reward coupon |
| GET | `/admin/coupons` | List generated coupons |
| GET | `/admin/report` | Retrieve aggregate sales and coupon statistics |

The `/admin/*` endpoints are administrative operations. Authentication is intentionally omitted for this assignment.

### Create a cart

```http
POST /carts
```

Returns `201 Created` with the new cart.

### Add an item

```http
POST /carts/:cartId/items
Content-Type: application/json
```

Example body:

```json
{
  "productId": "p-100",
  "quantity": 1
}
```

Returns the updated cart and totals. Quantity must be a positive integer.

### Update or remove an item

Update:

```http
PATCH /carts/:cartId/items/p-100
Content-Type: application/json
```

```json
{
  "quantity": 2
}
```

Remove:

```http
DELETE /carts/:cartId/items/p-100
```

### Checkout

```http
POST /carts/:cartId/checkout
Idempotency-Key: unique-client-generated-key
Content-Type: application/json
```

Without a coupon:

```json
{}
```

With a coupon:

```json
{
  "couponCode": "YOUR_GENERATED_COUPON_CODE"
}
```

A successful checkout returns the order, including item snapshots and monetary totals in paise. Repeating the same request with the same idempotency key returns the existing order. Reusing the key for a different request returns a conflict.

### Retrieve an order

```http
GET /orders/:orderId
```

Returns the stored order or `404` if it does not exist.

### Generate a reward coupon

```http
POST /admin/coupons/generate
```

Returns `201 Created` when an eligible milestone has an ungenerated coupon. Returns `409 Conflict` when no eligible milestone remains.

### List coupons

```http
GET /admin/coupons
```

Returns generated coupons and their redemption status.

### Retrieve the admin report

```http
GET /admin/report
```

Returns successful order count, gross revenue, discounts, net revenue, purchased quantities by product, and coupon counts.

## Error responses

Errors use a consistent JSON structure:

```json
{
  "error": {
    "code": "INSUFFICIENT_INVENTORY",
    "message": "A human-readable explanation"
  }
}
```

Expected status codes include:

- `400 Bad Request`: invalid input, missing idempotency key, or empty cart.
- `404 Not Found`: missing cart, product, order, coupon, or route.
- `409 Conflict`: insufficient stock, already checked-out cart, reused idempotency key, unavailable coupon, or ineligible reward generation.
- `500 Internal Server Error`: unexpected server failure.

## Important implementation limitations

The service uses in-memory maps. Restarting the process clears its data. Checkout serialization and idempotency records are local to the running process, so this implementation does not provide cross-instance coordination or durable retries.

A production version would require persistent storage, transactional inventory updates, durable idempotency records, and atomic coupon redemption.

See `DECISIONS.md` for design rationale, trade-offs, testing scope, and deferred improvements.
