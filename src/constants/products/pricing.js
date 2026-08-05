export const PF_TIERS = [
  { id:"base",    label:"Base",    amount:2000,  desc:"Core API access, standard support" },
  { id:"plus",    label:"Plus",    amount:5000,  desc:"Priority support, expanded rate limits" },
  { id:"premium", label:"Premium", amount:15000, desc:"Dedicated CSM, SLA guarantees, unlimited seats" },
];

export const PRICING_PRODUCTS_DEFAULT = [
  { id:"pp1", name:"Core Verify",      rack:1.500, type:"S", included:false, discountGroup:"Standard" },
  { id:"pp2", name:"Core Verify Plus", rack:2.750, type:"S", included:true,  discountGroup:"Standard" },
  { id:"pp3", name:"Balance Insights", rack:0.100, type:"T", included:true,  discountGroup:"Moderate" },
];
