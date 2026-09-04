# doof design system

## Product context

doof is an independent disclosure channel for AI agents. An agent can `hesitate` before a consequential action or `confess` after learning it was wrong. doof reports the disclosure directly to the person the agent acts for. It does not approve, block, reverse, or judge the action.

The public site must make a strange technical idea feel credible and immediately understandable. The product name and tool names already supply the wit. The interface should be the straight man.

## Aesthetic direction

**Quiet product realism.** A near-black, low-noise system inspired by the restraint of Linear's marketing site, without copying its brand. The reference points are excellent developer tools, precise operating systems, and real product interfaces shown at their best.

The mood is serious, calm, and unusually candid. Never cute, theatrical, cyberpunk, ominous, or generic enterprise software.

## Visual principles

1. Use typography, grid, and whitespace before decoration.
2. Use the real disclosure record as the visual proof. Avoid invented machines and abstract hero illustration.
3. Use colour to mark uncertainty or status, never merely to make a section lively.
4. Keep `hesitate` and `confess` visually prominent and monospaced.
5. High-stakes examples should remain concrete: money movement, confidential information, deletion, and external communication.
6. Do not imply that doof controls the agent.
7. Let the name carry the personality: use a plain lowercase wordmark without an emblem.

## Typography

- Display and body: Instrument Sans, weights 400 to 700.
- Tools, labels, records, and technical details: IBM Plex Mono, weights 400 to 600.
- Hero scale: 58 to 80px desktop, 48 to 64px mobile.
- Body copy: 16 to 20px with a maximum readable measure of roughly 65 characters.
- Headings use tight tracking; body copy does not.

## Colour

- Canvas: `#08090A`
- Primary surface: `#101112`
- Raised surface: `#151617`
- Strong surface: `#1B1C1E`
- Primary text: `#F4F4F5`
- Body text: `#C4C5C7`
- Muted text: `#81838A`
- Hairline: `#25272A`
- Uncertainty signal: `#F2C94C`

The yellow signal is rare and meaningful. It identifies unresolved uncertainty. Delivery, danger, and failure keep their own semantic colours. The site does not use decorative gradients or a rainbow palette.

## Layout and spacing

- Eight-pixel base spacing unit.
- Spacious marketing pages with large quiet intervals; compact functional surfaces.
- Maximum content width: 1280px.
- Marketing layout: a strong editorial headline above credible product UI.
- Functional layout: sidebar, record, and delivery context with one obvious hierarchy.
- Corners are small and disciplined. Pills are reserved for statuses and actions.
- Borders are one pixel. Use changes in surface value and soft fades for depth, not decorative shadows.
- Primary buttons are compact rectangles with 8px corners. Keep labels and arrows on one plane, without divided compartments.

## Product imagery

Use product interface compositions as the primary imagery. Every visible field should teach something true: when the agent disclosed, what it intended to do, why it was uncertain, and whether the owner received the message.

Technical diagrams may support later sections, but they should be faint, monochrome, and explanatory. Do not use faces, mascots, cartoon machines, fantasy worlds, inflated 3D forms, or decorative blobs.

## Motion

Motion is minimal and explanatory. Product surfaces may reveal gently and interactive elements may shift by one or two pixels. Do not bounce, wobble, float, or animate layout dimensions. Respect `prefers-reduced-motion`.

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-09-03 | Adopt calm, humane infrastructure | The earlier pastel mechanical world made a high-stakes disclosure product feel childish. The product names carry enough personality; the design should establish trust. |
| 2026-09-03 | Move to quiet product realism | The user chose a Linear-like direction: near-black restraint, generous space, and the actual disclosure interface as proof rather than an illustrated metaphor. |
| 2026-09-03 | Simplify the identity and actions | The final playful remnants were the striped emblem and capsule buttons. doof now uses a plain wordmark and compact rectangular actions. |
| 2026-09-04 | Lowercase the brand everywhere | Customer-facing copy always writes `doof` with a lowercase d, including at the beginning of sentences. Technical environment variables remain uppercase. |
| 2026-09-04 | Use independent disclosure infrastructure in the eyebrow | Independence from the agent maker is the product promise. Out-of-band describes the technical mechanism and belongs in technical documentation. |
