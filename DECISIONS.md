# Engineering Decisions

## System Invariants

The implementation is organized around these invariants:

- Inventory must never become negative.
- A successful checkout creates one order and deducts inventory exactly once.
- A repeated checkout request with the same idempotency key and request parameters returns the original order.
- An idempotency key cannot be reused for a different request.
- A cart can be checked out only once.
- Orders retain product names, unit prices, quantities, line totals, subtotal, discount, and final total as historical snapshots.
- A coupon can be redeemed successfully at most once.
- A failed checkout must not consume a coupon or partially deduct inventory.
- Monetary calculations must be deterministic.
- Administrative reports must reconcile with completed orders and must not mutate application state.

## Decision: Use Integer Paise for Money

**Context:** Monetary calculations must avoid floating-point rounding errors.

**Options considered:** Store rupee amounts as floating-point numbers, use decimal arithmetic, or store money as integer paise.

**Choice:** Store all monetary values as integer paise.

**Why:** Integer arithmetic avoids common floating-point representation errors and makes totals straightforward to verify.

Coupon discounts are calculated as a percentage of the order subtotal and rounded down to the nearest paise using `Math.floor`. The final total is the subtotal minus the discount.

**Consequences:** API consumers must interpret monetary fields ending in `Paise` as paise. A production system handling larger monetary ranges should also validate safe integer bounds or use an appropriate decimal or integer representation.

## Decision: Use Current Catalogue Prices at Checkout

**Context:** Product prices and availability may change after a customer adds an item to a cart.

**Options considered:** Lock the price when the item is added, reserve inventory when the item is added, or use the current catalogue price and revalidate inventory at checkout.

**Choice:** Carts store product IDs and quantities. Cart views display current catalogue prices, and checkout uses the current price and inventory when creating the order.

**Why:** This avoids treating a cart as a price guarantee or reserving stock for abandoned carts.

**Consequences:** A cart's displayed total may change before checkout. Inventory is checked when adding or updating items and again during checkout. Adding an item does not reserve stock. A successful order stores its own product name and price snapshots so later catalogue changes do not alter its historical totals.

## Decision: Serialize Checkout Within One Process

**Context:** Two customers may attempt to purchase the final unit of a product, or two checkouts may compete for the same coupon.

**Options considered:** Perform unprotected in-memory mutations, serialize checkout operations within the process, or use database transactions and atomic inventory updates.

**Choice:** Use a promise-based queue to serialize checkout operations within one Node.js process. The state-changing portion of checkout is synchronous and contains no `await`.

**Why:** This prevents competing checkout operations handled by the same process from interleaving inventory deductions, coupon redemption, order creation, cart state changes, and idempotency record creation.

**Consequences:** This is a process-local solution, not a distributed lock. It does not coordinate multiple application instances, and in-memory state is lost on restart. Production deployment requires a persistent transactional database, atomic stock updates or suitable locking, and transactional updates to orders, coupons, and idempotency records.

## Decision: Require Checkout Idempotency Keys

**Context:** A client may time out after the server has successfully completed a checkout and retry without knowing whether the first request succeeded.

**Options considered:** Allow every request to create a new order, rely only on the cart's checked-out state, or record idempotency keys with request fingerprints and resulting order IDs.

**Choice:** Require an `Idempotency-Key` header for checkout. Store the request fingerprint and resulting order ID. A repeated key with the same cart and coupon returns the original order; reuse for a different request returns a conflict.

**Why:** This protects against duplicate orders and repeated inventory deductions when clients retry requests.

**Consequences:** Idempotency records are stored in memory and are not durable across restarts. A production implementation should persist the idempotency record transactionally with the order. The current request fingerprint includes the cart ID and coupon code.

## Decision: Separate Reward Eligibility From Coupon Generation

**Context:** The requirement makes a coupon eligible after every configured number of successfully placed orders, while coupon generation is an administrative operation.

**Options considered:** Generate coupons automatically during checkout, or record eligible milestones and allow an administrator to generate each coupon explicitly.

**Choice:** Use a configurable order threshold and discount percentage. A milestone becomes eligible after the corresponding number of successful orders. An administrator explicitly generates a coupon, and only one coupon may be generated for each eligible milestone.

**Why:** This keeps reward eligibility separate from issuance and makes administrative coupon generation observable and deliberate.

**Consequences:** A milestone does not itself create a coupon. The administrator must request generation. A generated coupon is available for one successful redemption. Coupon generation and redemption are currently in-memory operations protected only by the process-local execution model; a multi-instance production implementation would require durable storage and transaction protection.

## Decision: Validate Before Mutating Checkout State

**Context:** A checkout can fail because a cart is invalid, inventory is insufficient, a coupon does not exist, or a coupon has already been redeemed. Partial changes would leave the system inconsistent.

**Options considered:** Deduct stock and then validate the coupon, attempt compensating mutations after failure, or validate all relevant conditions before applying state changes.

**Choice:** Validate the idempotency key, cart state, cart contents, inventory, and optional coupon before mutating checkout state. Then create the order, deduct inventory, redeem the coupon if applicable, mark the cart checked out, and record idempotency information in the synchronous critical section.

**Why:** This avoids expected validation failures consuming inventory or coupons.

**Consequences:** The approach works within the current single-process in-memory design because no asynchronous operation occurs during the mutation sequence. It is not a substitute for a database transaction if persistence, process crashes, or multiple instances are introduced.

## Decision: Use Structured API Errors

**Context:** API clients need to distinguish invalid input, missing resources, conflicts, and unexpected server failures.

**Options considered:** Return generic error messages, encode failures only in message text, or return consistent error objects with machine-readable codes.

**Choice:** Return structured errors containing a code and human-readable message, with appropriate HTTP status codes for expected failures.

**Why:** Clients can respond to stable error codes without parsing message text.

**Consequences:** The API exposes useful error information for validation failures, missing resources, and state conflicts. The current implementation does not include a comprehensive request-schema validation framework or a centralized list of every possible error response; these would be reasonable follow-up improvements.

## Decision: Derive Reports From Completed Orders

**Context:** Administrative reports must summarize purchased quantities, gross revenue, discounts, net revenue, coupon counts, and successful orders without changing system state.

**Options considered:** Maintain separate mutable reporting counters during checkout, calculate reports from completed orders, or use a dedicated analytics store.

**Choice:** Calculate the report from completed orders and current coupon states.

**Why:** Deriving revenue and purchased quantities from order records reduces the risk of counters drifting away from the underlying transactions. Repeated report requests should return the same result when the underlying state has not changed.

Gross revenue is the sum of order subtotals. Discounts are summed separately, and net revenue is the sum of order totals. Purchased quantities are aggregated from order item snapshots.

**Consequences:** Report generation is simple and read-only, but its cost grows with the number of orders. A production system with larger data volumes could use indexed database queries or asynchronously maintained reporting projections, with reconciliation against authoritative order records.

## Decision: Use In-Memory Storage for the Assignment

**Context:** The assignment permits in-memory storage and imposes a limited timebox. The primary objective is to demonstrate correctness and reasoning around checkout behavior.

**Options considered:** Introduce a database and migrations, use an embedded database, or implement the domain using in-memory maps.

**Choice:** Use in-memory maps for products, carts, orders, coupons, and idempotency records.

**Why:** This keeps the implementation focused and makes business rules straightforward to exercise through automated tests without private services or credentials.

**Consequences:** All data is lost when the process restarts. State is not shared across instances. Process-local checkout serialization does not provide distributed concurrency safety. For production, I would introduce persistent transactional storage, durable idempotency, atomic inventory updates, transactional coupon redemption, and appropriate operational monitoring.

## Payment Assumption

The assignment does not require a real payment integration. This implementation treats a validated, successfully committed checkout as a successful purchase. It does not charge a payment provider or claim that an external payment was processed.

A production payment integration would need an explicit payment lifecycle, idempotent provider requests, handling for asynchronous payment outcomes, and a transaction or orchestration strategy that prevents inventory, order, and payment states from becoming inconsistent.

## Implemented Versus Deferred

**Implemented:**

- Product seed data with at least five products and limited inventory.
- Cart creation, retrieval, item addition, quantity updates, and item removal.
- Checkout validation, order creation, and historical order snapshots.
- Process-local checkout serialization and checkout idempotency.
- Configurable reward threshold and discount percentage, administrative coupon generation, and one-time coupon redemption.
- Structured API errors and administrative reporting.
- Automated tests covering important success, failure, repeated-request, and competing-request scenarios.
- Setup instructions and API documentation.

**Intentionally deferred:**

- Persistent database storage and migrations.
- Distributed concurrency control across multiple application instances.
- Durable idempotency records and recovery after process crashes.
- Real payment processing.
- Authentication and authorization for administrative routes, which the assignment explicitly says are not required.
- Production observability, rate limiting, and deployment infrastructure.

## Testing Strategy

The automated tests exercise the HTTP API and cover product listing, invalid quantities, cart updates and removal, empty checkout, missing idempotency keys, idempotency replay, conflicting key reuse, completed-cart protection, historical order snapshots, competing purchases for the final unit, reward generation, coupon redemption, competing coupon redemption, failed checkout, and report reconciliation.

TypeScript compilation and the automated test suite are run before submission. The concurrency tests validate behavior within a single Node.js process; they do not establish correctness across multiple processes or application instances.

## AI-Assisted Development

AI tools were used to assist with implementation, test design, and review. The code was checked against the actual TypeScript compiler and automated test results rather than accepted solely because an AI tool suggested it.

One example involved a test helper that returned a promise. Chaining Supertest's `.expect(201)` onto the helper call produced a TypeScript error. The test was corrected to await the response and assert the status explicitly.

This reinforced the need to validate generated code against the actual types and runtime behavior. The checkout and concurrency assumptions also need to be understood and defended independently of the AI-generated suggestions.

## If Another Two Hours Were Available

I would prioritize the following:

1. Add persistent transactional storage and test atomic inventory and coupon updates.
2. Make idempotency durable and safe across multiple application instances.
3. Expand report reconciliation tests to include discounted orders and multiple reward milestones.
4. Strengthen request validation and document every endpoint's success and error responses.
5. Add operational logging and configuration appropriate for deployment, then repeat the full test suite against the production-oriented implementation.
