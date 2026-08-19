# Pricing

A proposal, not a decision. The reasoning matters more than the numbers, because the numbers should move once real districts react to them.

## The constraint

The stated goal for SentryAI is to help districts manage money and time so they can serve students better — not to extract maximum revenue from a captive market. Special education budgets are already the most strained line in most districts, and IDEA has never been funded at the 40% of excess cost Congress authorized. Every dollar SentryAI takes is a dollar not spent on a service provider.

That constraint is compatible with a real business. It is not compatible with how this market usually prices.

## How incumbents price, and why it is a problem

Special education case management systems are generally sold as multi-year district contracts, negotiated per district, with terms that are not public. Effective rates land somewhere in the range of **$10–30 per IEP student per year**, plus implementation and data-migration fees that can rival the first year's license cost.

Three consequences:

1. **Districts cannot benchmark.** A director has no idea whether their price is good, because no one publishes one. Small districts systematically pay more per student than large ones with procurement staff.
2. **Implementation fees punish switching.** They are not primarily cost recovery; they are a switching tax that keeps districts on systems they dislike.
3. **Export is often a negotiation.** A district that wants to leave discovers its data is easy to put in and hard to get out.

## The proposal

**Published, per-IEP-student, marginal-tier pricing. No implementation fee. No migration fee. No export fee.**

Billed on students with an active IEP, not total enrollment — districts should not pay for children who do not use the system.

| Students with an IEP | Rate per student per year |
| --- | --- |
| First 500 | $14 |
| 501 – 2,000 | $11 |
| 2,001 – 10,000 | $8 |
| Above 10,000 | $6 |

Tiers are marginal, like income tax brackets, so crossing a threshold never raises the total bill. Annual minimum of **$1,000**. Districts with **fewer than 50 students with IEPs are free** — there are a lot of them, they have no dedicated SpEd administrator, they are the districts least able to absorb a finding, and the marginal cost of serving them is near zero.

Worked examples:

| District | IEP students | Annual cost | Per student |
| --- | --- | --- | --- |
| Small rural | 40 | $0 | — |
| Small | 180 | $2,520 | $14.00 |
| Mid-size | 1,200 | $14,700 | $12.25 |
| Large | 6,500 | $44,500 | $6.85 |
| Very large | 25,000 | $146,500 | $5.86 |

### What is included rather than sold separately

Unlimited users. Related service providers, psychologists, paraprofessionals, and administrators all need access; charging per seat means districts ration access to the compliance system, which defeats it. The parent portal is included for the same reason.

Data export in a documented, machine-readable format, at any time, without asking. A district that can leave easily is a district that stays because the product is good.

Implementation and migration. These cost real money to deliver, and pricing them separately turns a fixed cost into a barrier that keeps districts on worse software. Amortize them into the rate.

State reporting extracts. This is the whole job, not an upsell.

### The Medicaid question

School districts leave substantial Medicaid reimbursement unclaimed because service documentation fails audit — missing signatures, missing credentials, missing narratives. Vendors in this space typically take a **contingency fee of 8–12% of recovered funds**.

The recommendation is to **include Medicaid documentation support in the base price and take no percentage.**

The contingency model is lucrative and the wrong side of the stated goal. That money is federal reimbursement the district already earned by serving students it already served; skimming it converts a public benefit into vendor revenue. Including it instead produces a cleaner argument than any time-savings claim:

> For a district recovering an additional $60,000 in properly documented Medicaid claims, a $14,700 license is not a cost. It is a net gain of $45,000, and the compliance engine comes with it.

That is an ROI story a business official can verify from their own claims data, which is worth more than a time-saved number a vendor supplies.

## What this is not

**Not a loss leader, and not free software.** The rates above are real and should sustain the business. The difference from the incumbent model is transparency and the absence of extraction points, not the absence of price.

**Not usage-based or per-document.** Pricing that scales with documents created punishes the districts doing the most careful work. Pricing that scales with AI usage makes a case manager think about cost while writing an IEP, which is precisely the wrong moment.

**Not free for the first year.** Districts budget annually; a price that jumps at renewal creates exactly the mid-year crisis this product exists to prevent.

## Open questions

- Whether to price the first pilot districts at zero in exchange for a measurement partnership — a real efficacy study is worth more than the revenue, and the resulting number is one the README can actually publish.
- Whether SELPAs (California) and regional service centers (Texas) should be sold as a unit. It shortens the sales cycle considerably, but consortium pricing tends to erode the per-student transparency this model depends on.
- Whether a state-level contract is desirable at any price. It is a large check and a large dependency.
- What renewal looks like. The intention is no annual escalator beyond a published inflation adjustment, but that needs testing against actual cost growth.
