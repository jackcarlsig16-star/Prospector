export const SEED_INTEL_DOCS = [

  // ═══════════════════════════════════════════════════════════════
  // PRODUCTS (placeholder — replace with your own product intel docs)
  // ═══════════════════════════════════════════════════════════════

  {id:"p_core_verify", name:"Product: Core Verify", active:true, createdAt:"2026-01-01T00:00:00.000Z", content:`WHAT IT DOES
Core Verify instantly verifies bank account and routing numbers before a payment is submitted — confirming the account exists, is in good standing, and is owned by the person initiating the transaction.

IDEAL CUSTOMER PROFILE
Any company that collects ACH payment details from customers. Most relevant for: payment platforms, lenders, landlords/property managers, SaaS billing, marketplaces.

KEY SIGNALS TO LOOK FOR ON WEBSITE
- "Pay by bank", "bank transfer", "ACH payment", "direct debit" in product copy
- "Add bank account" in onboarding flow screenshots
- Job postings for "payments engineer", "ACH integration", "bank connectivity"

VERTICALS WHERE MOST COMMON
Payments, Lending, Proptech/Rentals, Insurance, Platforms & Marketplaces, SaaS billing

COMMON COMBINATIONS
Core Verify + Balance Insights: add real-time fund check before high-dollar ACH.
Core Verify + Core Verify Plus: layer identity to confirm account holder name matches submitted KYC data.`},

  {id:"p_core_verify_plus", name:"Product: Core Verify Plus", active:true, createdAt:"2026-01-01T00:00:00.000Z", content:`WHAT IT DOES
Core Verify Plus confirms account ownership through name, email, phone number, and physical address — an identity layer on top of core account connectivity.

IDEAL CUSTOMER PROFILE
Regulated financial products that must verify identity at signup: neobanks, lenders, crypto exchanges, broker-dealers.

KEY SIGNALS TO LOOK FOR ON WEBSITE
- "KYC" or "identity verification" in compliance page
- Regulated product: lending, crypto, broker, money transmission
- Job: compliance engineer, KYC analyst, fraud and risk

VERTICALS WHERE MOST COMMON
Crypto, Consumer Lending, Neobanking, Insurance

COMMON COMBINATIONS
Core Verify Plus + Core Verify: almost always paired for regulated onboarding.`},

  {id:"p_balance_insights", name:"Product: Balance Insights", active:true, createdAt:"2026-01-01T00:00:00.000Z", content:`WHAT IT DOES
Balance Insights provides real-time available and current bank account balances at the moment of the API call — lets businesses confirm funds exist before processing a payment or approving an advance.

IDEAL CUSTOMER PROFILE
EWA platforms, short-term lenders, landlords, marketplaces. Anyone where insufficient funds is the primary failure mode.

KEY SIGNALS TO LOOK FOR ON WEBSITE
- "Instant advance" or "on-demand pay" in product copy
- EWA or earned wage access product
- Pre-payment balance check mentioned in docs

VERTICALS WHERE MOST COMMON
EWA, Consumer Lending, Proptech, Payments, Platforms & Marketplaces

COMMON COMBINATIONS
Balance Insights + Core Verify: verify account ownership then confirm funds.`},
];
