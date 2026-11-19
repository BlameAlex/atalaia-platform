# Product

## Platform

web

## Users

Primary audience right now: people evaluating a live demo (reviewers, teachers, judges) who watch the dispatcher screen for the first time, often over the presenter's shoulder or on a projector. The screen must read instantly to them.

Secondary: a county dispatcher during a flood event, triaging SOS calls and deploying rescue vehicles to refuges. The demo plays this role with simulated calls; dispatcher realism matters, but second to first-time legibility.

## Product Purpose

AtalaIA joins three parts into one rescue system: a mobile SOS app, a server that scores each call's risk with a county flood-risk model plus personal vulnerability, and a dispatcher dashboard that proposes vehicle routes to refuges and tracks every pickup live. Success for the dashboard: someone watching sees a call arrive, understands its risk, sees which vehicle will collect it and when, and sees the dispatcher act on it.

## Positioning

Risk is computed per person, not only per area: the county flood class from the model, raised by age, critical conditions and mobility needs. Routes are planned highest-risk first, with walkers collected on foot at a nearby stop and refuges visited before the next passenger when risk on board is high.

## Operating Context

- Demo area: Katy–Brookshire, TX (crosses Harris, Fort Bend, Waller counties so risk varies). HQ, three refuges (`Refugio 1–3`) and four vehicles (`Vehículo 1–4`, capacity 2–6) are seeded fixtures.
- Calls come from the phone app or from `tools/simulate-sos.mjs`.
- Status flow: Pendiente → En ruta (route deployed) → Recogido → Entregado en [refugio]; No encontrado returns a call to Pendiente; Descartar is terminal. Terminal rows leave after 3 s.
- Route kinds: active, deployable proposal, forecast.

## Capabilities and Constraints

- Spanish-only UI; the S14 vocabulary in `docs/plans/00-master.md` is fixed (status chips, button labels, mobility labels). Code, API paths and JSON keys stay English.
- Local use only, one shared dispatch key stored in the browser.
- No build step: static HTML plus an ES module (`dashboard/logic.mjs`), served by the NestJS server at `/dashboard/`.
- Leaflet 1.9.4 with OpenStreetMap tiles.
- A visible `SIMULACIÓN` label stays on the map.
- State is server-driven over SSE; the UI changes only from the server echo (no optimistic updates).

## Evidence on Hand

Everything shown is simulated: people, phones and calls are synthetic. No real incidents, partners, or deployment claims exist and none may be implied.

## Product Principles

1. Readable at a glance by someone who has never seen it: risk, assignment and next action are obvious without explanation.
2. Show what changed: live updates are visible, never silent swaps.
3. The map and the panels are one view: anything pointed at in one is found in the other.
4. Honest simulation: synthetic data is always labelled as such.
