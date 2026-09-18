# The evidence CareCircle rests on

This is the research base for the claim that CareCircle addresses a real, large and
worsening problem — and the economic case for why it matters beyond one family.

**We apply our own trust model to our own claims.** CareCircle refuses to state an
inference as a fact, and it would be incoherent to abandon that discipline when
arguing for itself. So every figure carries a provenance:

| Mark | Means |
|---|---|
| **PRIMARY** | Stated by the originating body (WHO, ILO, a peer-reviewed study). |
| **SECONDARY** | Widely reported, traced to a secondary source. Directionally sound; do not present as precise. |
| **CONTESTED** | Figures disagree across sources. Quoted with the disagreement intact. |

Nothing here is used in the product UI or the submission without its source.

---

## 1. The population

Global ageing is not a forecast; it is arithmetic that has already happened.

| Figure | Provenance |
|---|---|
| **1.4 billion** people aged 60+ by 2030, rising to **2.1 billion by 2050** — up from ~1 billion in 2020 | PRIMARY — [WHO, Ageing and health](https://www.who.int/health-topics/ageing) |
| **57 million** people living with dementia (2021), projected **152 million by 2050**, ~10 million new cases a year | PRIMARY — [WHO](https://www.who.int/health-topics/ageing) |

> **Note on a figure we are *not* using.** Some secondary summaries state "more than
> 2 billion people are already over 60, or 21.1% of the world". That conflicts with
> WHO's own 2030/2050 projections and appears to be a transcription error. We cite
> the 1.4bn/2.1bn series instead. Flagged here rather than quietly dropped.

## 2. The conditions — why one channel is never enough

This is the research behind CareCircle's multimodal design. These are not rare
edge cases; among people over 60 they are close to the norm.

| Figure | Provenance |
|---|---|
| **Over 1.5 billion** people live with some hearing loss; the majority of age-related hearing loss is in people over 60. Projected **2.5 billion by 2050** | PRIMARY — [WHO, Deafness and hearing loss](https://www.who.int/health-topics/ageing) |
| **At least 2.2 billion** people have near or distance vision impairment; at least 1 billion of those cases are preventable or unaddressed | PRIMARY — [WHO, Vision impairment in older people](https://www.who.int/data/gho/indicator-metadata-registry/imr-details/prevalence-of-vision-impairments-in-older-people) |
| Global burden of age-related hearing loss in the 60+ population, 1990–2021, with projections to 2050 | PRIMARY — [GBD 2021 analysis, PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12810803/) |

**What this means for the design, concretely.** A care system delivered only by
voice excludes a large share of the people it is for. A care system delivered only
by screen excludes a different large share. Both groups are counted in billions.

This is why CareCircle treats **modality independence as an architectural
invariant** rather than an accessibility feature bolted on late: the spoken answer
is complete without the board, and the board is complete without the spoken answer.
Neither is allowed to become load-bearing. There is a test enforcing each half.

## 3. The mechanism — coordination failure, not ignorance

CareCircle's specific claim is narrower than "care is hard". It is that **work is
known to be needed and nobody owns it**. Three independent literatures support that
this is where harm enters.

| Figure | Provenance |
|---|---|
| **~50%** of patients do not take long-term medication as prescribed | PRIMARY — [WHO, Adherence to Long-Term Therapies (2003)](https://iris.who.int/handle/10665/42682) |
| Medication non-adherence implicated in **~10% of hospitalisations**; some studies put non-compliance behind **10–25%** of hospital and nursing-home admissions | CONTESTED — range reported across sources |
| **$100–300 billion** in avoidable annual healthcare costs attributed to non-adherence (US-centric) | SECONDARY |
| **1 in 5** older adults skipped needed medical care for lack of transport | SECONDARY — [survey reporting](https://www.techtarget.com/patientengagement/news/366584540/1-in-5-Adults-Derailed-Care-Access-Amid-Transportation-Barriers) |
| Older adults facing transport barriers were **2.3× more likely** to miss physician appointments and **2.5×** more likely to miss procedures | SECONDARY |
| **53%** of US family caregivers say someone else also provides unpaid help to the same person; **58%** perform medical or nursing tasks including managing medications | PRIMARY — [AARP & NAC, Caregiving in the U.S. 2020](https://www.caregiving.org/research/caregiving-in-the-us/caregiving-in-the-us-2020/) |

**The join that matters.** A cardiology appointment nobody drives the patient to is
not a scheduling problem — it is a missed appointment, and missed appointments are
measurably common and measurably expensive. More than half of caregiving is already
shared between multiple people, and shared responsibility with no owner is exactly
the failure state CareCircle detects.

## 4. The economics

| Figure | Provenance |
|---|---|
| **16.4 billion hours** of unpaid care work performed daily worldwide — the equivalent of **2 billion people working full-time, unpaid** | PRIMARY — [ILO, Care work and care jobs for the future of decent work (2018)](https://www.ilo.org/media/416161/download) |
| Unpaid care and domestic work valued at up to **9% of global GDP — about US$11 trillion** | PRIMARY — ILO (2018) |
| Women perform **76.2%** of all unpaid care work | PRIMARY — ILO (2018) |

**The argument this supports.** The world's largest care workforce is unpaid,
uncoordinated, and has no shared system of record. An $11 trillion economy runs on
memory and text messages. CareCircle is infrastructure for the part of the care
economy that never had any — and the counterfactual is not "a worse app", it is
nothing at all.

## 5. Why this matters most where there is no formal care system

The Western framing of this product is a convenience layer over an existing care
system. **In Nigeria and much of Sub-Saharan Africa there is no such system to sit
on top of, and the family is not a supplement to formal care — it is the entirety
of it.**

| Figure | Provenance |
|---|---|
| ~**5%** of Nigeria's ~200 million people are 60+, projected to reach about **25.3 million by 2050**; Nigeria has the **largest older population in Africa** | PRIMARY — [The Gerontologist, *Aging in Nigeria*](https://dx.doi.org/10.1093/geront/gnac121) |
| Formal long-term care across Sub-Saharan Africa is **largely underdeveloped**; institutional care is scarce, financially inaccessible, and often culturally misaligned | PRIMARY — [World Bank, *Long-Term Care for Aging Populations*](https://documents1.worldbank.org/curated/en/099622103072411151/pdf/IDU15739796f1551214a3818a8119e5c778c5cb9.pdf) |
| **Cameroon: fewer than 50 nursing-home places nationally** for a population of 28 million, 6–7% of whom are 60+ | PRIMARY — [JAMDA, *Reimagining Long-Term Care in Sub-Saharan Africa*](https://www.jamda.com/article/S1525-8610(25)00371-8/abstract) |
| Urbanisation and women's labour-force participation have **reduced the availability of family caregivers**, leaving families unable or unavailable to provide long-term support | PRIMARY — [African Academy of Sciences](https://aasciences.africa/news/addressing-long-term-care-for-nigerias-aging-population) |
| Older parents commonly remain in rural hometowns while adult children are in cities or overseas; support arrives as **remittances rather than presence** | PRIMARY — [World Bank](https://documents1.worldbank.org/curated/en/099622103072411151/pdf/IDU15739796f1551214a3818a8119e5c778c5cb9.pdf) |
| Emotional, relational, technological and financial dimensions of **transnational elder caregiving among Nigerian immigrants** | PRIMARY — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12648802/) |
| Family caregivers in Enugu State, Nigeria: management and coping | PRIMARY — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC13495187/) |

**This is the strongest version of the argument.** Where a nation of 28 million has
fewer than 50 nursing-home places, the coordination layer is not competing with a
care system — it *is* the care system's only realistic form. And the distributed
family CareCircle is built for (one person in the village, one in Lagos, one
abroad, a paid aide on shift) is not a hypothetical persona. It is the documented,
default structure of African elder care.

A calendar assumes everyone can see it. A care-management platform assumes an
institution is paying for it. Neither assumption holds here. **Voice on a shared
device, with a screen anyone in the room can glance at, assumes only that a family
talks to each other.**

## 6. What CareCircle does about each of these

Evidence is only worth citing if the system answers it.

| Finding | What the system does |
|---|---|
| ~50% non-adherence | Missing doses surfaced as **"there is no record"** — never as an accusation. A trust benchmark measures this: a raw model asserts a false accusation in 6 of 12 cases; CareCircle, 0. |
| Transport barriers → missed appointments | A medical appointment **infers** a transport obligation, which appears as an unowned Care Gap until a person takes it. |
| >50% of care is shared between several people | EVENTS → OBLIGATIONS → **OWNERSHIP**. The unit of the system is who is responsible, not what is scheduled. |
| Distance and migration | Household state is shared, persistent, and reachable from any surface — a child abroad and an aide in the house see one record. |
| Hearing loss, vision loss | Modality independence as a tested invariant; Polly speech-rate control; a 10-foot board. |
| Dementia | The system records **who said what**, never "what is true". A recipient's confirmation is stored as their report, with attribution. |
| No formal care infrastructure | Runs on a shared device and a television. No institution, no per-seat licence, no one to sign a contract. |

---

## Honest limits

- Several cost figures are US-centric. We cite them as directional evidence that
  coordination failure is expensive, not as a claim about Nigeria.
- The medication-adherence and transport findings are **associations**; CareCircle
  has not been trialled and we make no clinical-outcome claim.
- The ILO figures value unpaid care in aggregate. They establish the size of the
  economy, not that software captures any share of it.
- WHO's headline ageing figures are quoted from WHO's own topic pages; where
  secondary summaries disagreed, the disagreement is recorded in §1 rather than
  resolved silently.
