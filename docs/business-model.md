# Seedling — Business Model

**Status:** Working hypothesis. Written 2026-08-02.
**Context:** Thesis project now, potential company after. No clinic access yet.

---

## 1. One-line model

Seedling is sold to the people who prescribe physical therapy, not to the people who perform it. Clinics and independent physical therapists pay a monthly fee per active patient; patients use the app free.

This is a **B2B2C** model. The patient is the user. The therapist is the customer.

---

## 2. Honest starting position

Before describing where the business goes, this is where the product actually is. This section exists so the roadmap is grounded in the codebase rather than in intent.

**What is built and working:**

- Patient authentication and profiles (Supabase Auth, RLS enforced)
- Camera-based posture detection during exercise sessions
- Per-session and per-rep capture: duration, reps completed, form quality score
- Star awards with server-side integrity (session-bound, deduplicated, never client-written)
- Garden and level progression tied to accumulated stars
- Patient-facing progress dashboard with weekly trend charts
- An exercise catalog and exercise groups, editable through an admin area

**What does not exist yet, and matters for selling to a business:**

| Gap | Current state | Why it blocks a B2B sale |
|---|---|---|
| Multi-tenancy | No `org_id` column on any table | Two clinics cannot share the deployment; clinic A's queries would reach clinic B's patients |
| Roles | Single `is_admin` boolean on `profiles` | One global super-admin. No concept of "therapist", so no scoped permissions |
| Therapist ↔ patient link | None | A therapist has no caseload; the system cannot answer "who are my patients" |
| Per-patient prescription | `exercises` and `exercise_groups` are global | Every patient sees the same catalog. A therapist cannot prescribe sets, reps, or frequency to one person |
| Therapist dashboard | Only `/admin/users`, a platform-wide view | Nothing a clinician would open on a Monday morning |
| Tenant-scoped RLS | Policies are own-row plus admin-sees-all | Security model does not survive a second customer |
| Billing | None | No way to charge |

**Conclusion:** the product today is a single-tenant patient app with a back office. It is not yet a B2B product. That is fine — the gaps are known, ordered, and mostly small. What is genuinely missing is not code. It is a customer.

---

## 3. Who pays, and in what order

Four possible payers, ordered by how reachable they are for a student team with no existing relationships.

**Tier 1 — Independent and home-visit physical therapists.** Reachable directly through Facebook and LINE groups. They decide alone: no procurement, no committee, no IT review. They personally feel the pain of patients not doing home exercises, because it directly extends their treatment timeline and it is their reputation on the line. Willingness to pay is modest but the sales cycle is days, not quarters. **This is the wedge.**

**Tier 2 — Small private clinics (2–10 therapists).** One owner-decider, still no procurement process. Buys once a Tier 1 therapist inside the clinic has already advocated for it. Higher revenue per account and the first point where seat-based pricing makes sense.

**Tier 3 — Hospitals and hospital rehab departments.** Real budget, real logistics: procurement cycles, IT security review, PDPA documentation, possibly integration with a hospital information system. Twelve months or more from first contact to signature. Not reachable without a track record from Tiers 1 and 2.

**Tier 4 — Payers (Social Security Office, private insurers).** Highest ceiling by a wide margin, because a payer buys for an entire covered population rather than one clinic. Also the slowest: requires clinical outcome evidence, not adherence statistics. This is a three-to-five-year destination, and it is only reachable if the data collected in Tiers 1–3 is structured well enough to support an outcomes study later. Worth designing the data model with this in mind; not worth building toward it now.

---

## 4. What the customer is actually buying

Not exercise videos. Those are free on YouTube.

The therapist buys **visibility into what happens between appointments.** Today, when a therapist asks a patient whether they did their home exercises, the answer is self-reported and unreliable. The therapist adjusts treatment based on information they cannot verify.

Seedling replaces that with an adherence record: which days the patient practiced, how many reps, and a form quality score. When a patient stops, the therapist sees it within days rather than at the next appointment three weeks later.

The secondary purchase is **the patient actually doing it.** The garden mechanic exists to reduce dropout, and reduced dropout is the therapist's outcome as much as the patient's.

> **Citation needed before thesis submission.** Non-adherence to home exercise programs is widely reported in rehabilitation literature at roughly 50–70%, but this document should not carry that figure without a verified source. Find a primary source, preferably one with a Thai or Southeast Asian cohort. If none exists, that absence is itself worth stating — and worth measuring yourself during a pilot.

---

## 5. Pricing

**Structure:** per active patient, per month. An "active patient" is one assigned to a therapist and having completed at least one session in the billing month. Patients assigned but dormant are not billed.

This structure is chosen deliberately over flat per-seat pricing because it aligns cost with value: a therapist pays more only when more of their patients are genuinely using the tool. It also removes the main objection from a small practice — paying for capacity they are not using.

**Indicative price points, all requiring validation:**

| Segment | Shape | Estimate |
|---|---|---|
| Independent therapist | Flat, up to ~15 active patients | ฿500–1,500 / month |
| Small clinic | Per active patient | ฿100–300 / patient / month |
| Hospital department | Annual license + per-patient tier | Not estimable without a pilot |

These numbers are guesses. They are placed here so interviews can test them, not because they are known. The first five customer conversations should each end with a direct price question.

---

## 6. Alternatives considered and rejected

**Direct-to-consumer subscription (patient pays).** Rejected. The recovery lifecycle is roughly 6–12 weeks, after which the patient is well and churns by design. Lifetime value is structurally capped and almost certainly below the cost of acquiring the patient, since there is no organic referral loop between strangers recovering from unrelated injuries. Worse, self-pay removes the therapist from the loop entirely — and therapist visibility is the differentiator. A consumer version of Seedling competes with every free exercise video, on ground where the product has no advantage.

**Payer or insurer reimbursement as the entry model.** Rejected as a starting point, retained as a long-term ceiling. Requires clinical outcome evidence the project does not have and cannot generate without first running through Tiers 1–3.

**White-label licensing to an existing rehab software vendor.** Not pursued now. It trades away the customer relationship and most of the margin in exchange for distribution, which is the wrong trade before the product has proven it retains users.

**Corporate CSR sponsorship as core revenue.** Rejected as revenue; retained as funding. Thai corporate CSR budgets are real and the tree-planting narrative is genuinely well suited to them. A sponsor can fund a pilot, fund the trees, and generate press. But CSR budgets are annual, discretionary, and relationship-dependent — they are not a recurring revenue line and should not appear in a revenue projection. Treat sponsorship as non-dilutive pilot funding and as marketing.

---

## 7. Go-to-market

**Wedge:** independent and home-visit physical therapists in Thailand.

**Motion:**

1. Reach individual therapists directly (Facebook groups, LINE, PT faculty alumni networks).
2. Free during pilot. The pilot's purpose is evidence, not revenue.
3. Instrument everything: adherence rates, dropout timing, therapist login frequency. Therapist login frequency is the honest measure of whether the dashboard is useful — if they stop opening it, the value proposition is wrong regardless of what they say in interviews.
4. Convert pilot therapists to paid only after the dashboard has been reshaped by their feedback.
5. Expand from an individual therapist into the clinic they work at.

**Distribution advantage available now:** the team is inside a university. Physical therapy faculties (Mahidol, Chulalongkorn, Chiang Mai and others) have teaching staff who practice, clinical placement partnerships, and students on rotation. An advisor introduction is faster than any cold outreach and carries institutional credibility a student email does not.

---

## 8. Validation plan — before building the dashboard

The single largest risk to this document is that no one on the team has spoken to a practicing physical therapist. Every claim above is inference.

**Target: five therapist interviews before the therapist dashboard is designed.**

Questions to ask, in this order:

1. When you send a patient home with exercises, how do you find out whether they did them?
2. What happens when they did not?
3. Roughly what fraction of your patients stop doing their home program before you discharge them?
4. Have you tried any app or tool for this? What happened to it?
5. If you could see a daily record of which patients practiced and which stopped, what would you do differently?
6. What would you pay per month for that?

Question 1 is the one that matters. If therapists answer that they already have a reliable way to know, the core premise is wrong and the model needs rethinking. If they answer some version of "I ask them, and they say yes," the premise holds and that sentence becomes the opening slide of both the thesis and any future pitch.

Record the answers verbatim. Verbatim quotes from practitioners are the strongest evidence a thesis of this kind can carry.

---

## 9. Roadmap

### Phase 1 — Thesis (now)

**Build:**

- Therapist view: assigned patient list, adherence percentage per patient, last-session date, visible flag on patients who have stopped, and the ability to assign an exercise group to a specific patient.
- Schema insurance (see below).

**Do not build:** payment processing, seat counting, clinic self-signup, therapist invitation flows, audit logging, data export. None of these add thesis value and none of them respond to validated demand.

**Schema insurance — one migration, done now rather than later:**

- `organizations` table
- `profiles.org_id`, nullable
- `profiles.role` replacing `is_admin`: `patient | therapist | clinic_admin | platform_admin`
- `care_assignments` linking therapist to patient
- Per-patient prescription: sets, reps, frequency, assigned exercise group
- RLS policies written org-scoped from the first day, even while only one organization exists

The reason to do this now rather than when a customer appears: RLS policies are written against table shape, and the project already has fourteen migrations with policies referencing `profiles`. Introducing a tenant column later means rewriting every one of those policies and migrating live patient data behind them. Done now, at effectively zero real data, it is a few hours of work. Done later it is weeks, with a window during which patient records are exposed to a migration bug.

### Phase 2 — Pilot (after thesis)

Five to ten therapists using it free with real patients. Success is measured on two numbers: patient adherence compared to the therapist's baseline estimate, and how often the therapist opens the dashboard unprompted. Add billing only once therapists ask to keep using it.

### Phase 3 — Company

Convert pilot to paid. Expand into the clinics the pilot therapists work in. Build the operational layer — billing, org self-service, audit logging, PDPA documentation — in response to what actual customers require, not in anticipation.

---

## 10. Risks and open questions

**The tree promise is currently unfunded.** `PRODUCT.md` states that a partner NGO plants a real tree when a patient reaches a milestone. There is no signed partner. As stated thesis intent this is fine. As a live product claim to patients it is a promise the project cannot keep, attached to a health application, where trust is the entire asset. Resolve one of two ways: sign a partner and fund the trees, or change the copy so the reward is the garden itself until a partner exists.

**Clinical claims must stay narrow.** Describe Seedling as an exercise adherence and form feedback tool. Do not claim it diagnoses, treats, or improves clinical outcomes. Outcome claims invite medical device classification, and the posture detection has no clinical validation behind it. This constraint is not a limitation of ambition — it is what keeps the project shippable.

**Posture detection accuracy is unmeasured.** The form quality score is presented to patients and would be presented to therapists as fact. Its actual accuracy against a trained observer is unknown. Before a therapist makes any treatment decision from that number, it needs a validation study, even a small one. Until then, present it as a relative trend rather than an absolute measure.

**PDPA obligations arrive with the first real patient.** Health-adjacent personal data under Thai law requires explicit consent, a stated retention period, and a deletion path. Not urgent for a thesis with synthetic data. Mandatory before one real patient's records exist.

**Both founders are technical.** No one currently owns customer conversations. Given that the largest risk in this document is the absence of customer contact, one of the two should explicitly own it.

---

## 11. What would prove this wrong

Stated plainly so it can be tested rather than defended:

- Therapists report they already know reliably who is doing their home exercises → core value proposition fails.
- Therapists find the dashboard interesting but will not pay → wrong buyer; reconsider clinic owner or hospital as the payer.
- Patients use it for two weeks then stop despite the garden → the retention mechanic does not work, and nothing downstream matters until it does.
- Pilot therapists stop opening the dashboard after week three → the product is a patient app with a reporting feature, not a clinical tool, and pricing must change accordingly.

Each of these is cheaper to discover in an interview than in a build.
