export const UCS_DATA = [
  {id:"onboarding",lb:"Onboarding",c:"#3EE088",bg:"#041408",b:"#0A2E18",
    outcome:"Increase conversion, fight fraud, onboard in seconds.",
    desc:"KYC, fraud prevention, account linking",
    prods:["Core Verify","Core Verify Plus"],
    optional:["Balance Insights"],
    notes:"Core Verify is the foundational connectivity product used across almost all use cases. Core Verify Plus adds identity verification on top."},
  {id:"credit",lb:"Credit Underwriting",c:"#60A8F0",bg:"#0A1220",b:"#162038",
    outcome:"Say yes to more qualified borrowers while controlling losses.",
    desc:"Cash flow underwriting, income & employment verification",
    prods:["Balance Insights"],
    optional:["Core Verify"],
    notes:"Balance Insights is the flagship underwriting product — real-time balance and cash flow signal for lending decisions."},
];

export const PRODUCTS_DATA = [
  {cat:"Account Connectivity",c:"#F5C842",items:[
    {name:"Core Verify",
     desc:"Instantly verify bank account and routing numbers before a payment moves — confirming the account exists, is in good standing, and belongs to the right person.",
     icp:"Any company collecting ACH payments: lenders, landlords, SaaS billing, marketplaces, insurance.",
     signals:["\"Pay by bank\" or \"ACH payment\" in product copy","\"Add bank account\" in onboarding flow","Job: payments engineer, ACH integration"],
     verticals:["Payments","Lending","Proptech","Insurance","Platforms & Marketplaces","SaaS Billing"],
     combos:["Core Verify + Balance Insights — add real-time fund check for high-dollar payments","Core Verify + Core Verify Plus — confirm account holder identity matches submitted KYC"]},
    {name:"Core Verify Plus",
     desc:"Confirm account ownership through name, email, phone number, and physical address — an identity layer on top of core account connectivity.",
     icp:"Regulated financial products that must verify identity at signup: neobanks, lenders, crypto exchanges.",
     signals:["\"KYC\" or \"identity verification\" in compliance page","Regulated product: lending, crypto, broker, money transmission","Job: compliance engineer, KYC analyst"],
     verticals:["Crypto","Consumer Lending","Neobanking","Insurance"],
     combos:["Core Verify Plus + Core Verify — always paired for regulated onboarding"]},
  ]},
  {cat:"Financial Insights",c:"#A878F0",items:[
    {name:"Balance Insights",
     desc:"Real-time available balance pulled directly from the bank at the moment of the API call — lets businesses confirm funds exist before processing a payment or approving an advance.",
     icp:"EWA platforms, short-term lenders, landlords, marketplaces. Anyone where insufficient funds is the primary failure mode.",
     signals:["\"Instant advance\" or \"on-demand pay\" in product copy","EWA or earned wage access product","Pre-payment balance check mentioned in docs"],
     verticals:["EWA","Consumer Lending","Proptech","Payments","Platforms & Marketplaces"],
     combos:["Balance Insights + Core Verify — verify account ownership then confirm funds"]},
  ]},
];

export const ALL_PRODUCTS = [...new Set(UCS_DATA.flatMap(u=>[...u.prods,...(u.optional||[])]))];

export const PROD_COLOR = Object.fromEntries([
  ...UCS_DATA.flatMap(u=>[...u.prods,...(u.optional||[])].map(p=>[p,u.c])),
  ...PRODUCTS_DATA.flatMap(cat=>cat.items.map(p=>[p.name,cat.c])),
]);
