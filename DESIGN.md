---
name: AtalaIA Despacho
description: Flood-rescue dispatch console drawn as a Gulf hurricane tracking chart, every trip a time-stamped track.
colors:
  chart-aqua: "#e9eef4"
  ground-mist: "#e9f1f2"
  paper: "#fbfcfc"
  navy-ink: "#0b2545"
  slate-ink: "#3a5269"
  frame-bar: "#0b2545"
  bar-ink: "#ffffff"
  bar-ink-muted: "#c4d3e0"
  offline-rose: "#ffb4b4"
  rule: "#9fbac3"
  rule-soft: "#d3e2e6"
  graticule: "#6f97a3"
  risk-yellow: "#ffe066"
  risk-amber: "#ff9f43"
  risk-red: "#c92a2a"
  alert-red: "#b0102a"
  changed-cream: "#fff1c2"
  selected-wash: "#cfe3ea"
  hover-wash: "#e4eff2"
  now: "#0f7c8c"
  hq: "#1f2a44"
  track-navy: "#1c7ed6"
  track-teal: "#7048e8"
  track-plum: "#0ca678"
  track-rust: "#d6336c"
  track-olive: "#495057"
  track-graphite: "#f59f00"
typography:
  numeral-display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 70"
    fontFeature: "'tnum' 1"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.05
    fontVariation: "'wdth' 78"
  headline-sm:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.05
    fontVariation: "'wdth' 78"
  headline-xs:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1.05
    fontVariation: "'wdth' 78"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1.1
    fontVariation: "'wdth' 78"
  time-numeral:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.1
    fontVariation: "'wdth' 70"
    fontFeature: "'tnum' 1"
  scale-numeral:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 70"
    fontFeature: "'tnum' 1"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "'tnum' 1"
  control:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1
    fontVariation: "'wdth' 85"
  mark:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 72"
  small:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
    fontVariation: "'wdth' 80"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 75"
rounded:
  none: "0px"
  symbol: "12px"
  refuge-pill: "13px"
  full: "9999px"
spacing:
  hair: "4px"
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "16px"
  gutter: "20px"
  xl: "24px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "7px 12px 6px"
    height: "32px"
  button-primary:
    backgroundColor: "{colors.navy-ink}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.none}"
    padding: "7px 12px 6px"
    height: "32px"
  button-icon:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.none}"
    padding: "4px"
    size: "30px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "7px 10px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy-ink}"
    rounded: "{rounded.none}"
    padding: "3px 6px 2px"
  chip-committed:
    backgroundColor: "{colors.navy-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "3px 6px 2px"
  risk-mark-1:
    backgroundColor: "{colors.risk-yellow}"
    textColor: "{colors.navy-ink}"
    typography: "{typography.mark}"
    rounded: "{rounded.none}"
    height: "22px"
  risk-mark-2:
    backgroundColor: "{colors.risk-amber}"
    textColor: "{colors.navy-ink}"
    typography: "{typography.mark}"
    rounded: "{rounded.none}"
    height: "22px"
  risk-mark-3:
    backgroundColor: "{colors.risk-red}"
    textColor: "{colors.paper}"
    typography: "{typography.mark}"
    rounded: "{rounded.none}"
    height: "22px"
  frame-bar:
    backgroundColor: "{colors.frame-bar}"
    textColor: "{colors.bar-ink}"
    padding: "8px 20px"
    height: "52px"
---

# Design System: AtalaIA Despacho

## Overview

**Creative North Star: "The Gulf Hurricane Tracking Chart"**

The console is a tracking chart, not a command-centre dashboard. An aqua chart ground carries the map inside a graticule collar with lat/long ticks; a paper-white work column and a paper log strip sit beside and below it. Every trip is plotted the way a storm track is: positions along a line, each labelled with a stop number and HH:MM, filled when committed and hollow when only forecast. The dispatcher reads what each vehicle does next and when, and acts in one click.

Regions are divided by a change of ground (aqua chart, white paper, navy frame bar) and a 2px navy rule, never by cards. Everything that is UI chrome has square corners and a 2px navy stroke; roundness is reserved for chart symbols. Type is a single variable family, Archivo, used across its width axis: condensed for numerals, marks and labels, normal width for prose. Density is high but ruled, like a printed advisory table.

Light and dark are both first-class. Dark mode is a complete remap of the same tokens on `:root` (auto via `prefers-color-scheme`, forced via `data-theme`), and the OSM basemap is recoloured into the chart ground in both themes with a CSS tile filter rather than shown in its stock colours.

**Key Characteristics:**
- Aqua chart ground, paper work surfaces, navy ink and a navy chart-frame bar.
- Graticule collar (22px) with tick marks around the map; faint graticule lines on the map itself.
- One state-mark vocabulary everywhere: solid = active/committed, dashed = deployable proposal, dotted/faint = forecast, double rule = terminal.
- Risk is a yellow/amber/red ramp, always paired with text (R1/R2/R3).
- Archivo width axis as the main typographic lever; tabular numerals globally.
- Square, 2px-stroked chrome; no cards, no radius on controls.

## Colors

A cool, low-chroma chart palette (aqua, mist, navy) against which a hot yellow-amber-red risk ramp and six vehicle track colours do all the signalling.

### Primary
- **Navy Ink** (navy-ink): text, every 2px rule and control stroke, primary button fill, committed chips, the HQ marker, and active stop labels. It is the chart's printing ink; almost everything structural is drawn in it.
- **Frame Bar Navy** (frame-bar): the top chart-frame bar. Same as ink in light mode; lifts to `#173556` in dark mode so the bar stays a distinct band.

### Secondary
- **Risk Yellow / Risk Amber / Risk Red** (risk-yellow, risk-amber, risk-red): the three-step call risk ramp on SOS markers and rank marks. Yellow and amber carry black text, red carries white. Amber also marks "requires review" chips.
- **Alert Red** (alert-red): the error banner only, with white text.

### Tertiary
- **Track colours** (track-navy, track-teal, track-plum, track-rust, track-olive, track-graphite): one per vehicle, cycled by vehicle index, used for route polylines on the map and track segments in the log strip. The "now" line and AHORA tag use the separate `now` token (`#0f7c8c` light, `#4fd1c5` dark).

### Neutral
- **Chart Aqua** (chart-aqua): map ground and the colour the basemap is filtered toward.
- **Ground Mist** (ground-mist): page background behind everything.
- **Paper** (paper): work column, log strip, collar, inputs, buttons, popups, inactive stop labels.
- **Slate Ink** (slate-ink): secondary text, column heads, metadata, disabled control text.
- **Bar Ink** (bar-ink): primary text inside the frame bar (brand, SIMULACIÓN plate and its currentColor border, counts); `#f2f7fa` in dark mode.
- **Bar Ink Muted** (bar-ink-muted): secondary text inside the frame bar (count labels, "· Despacho").
- **Offline Rose** (offline-rose): the "Reconectando…" live state in the frame bar, with a hollow square; it stays the same in both themes because it always sits on the navy bar.
- **Rule** (rule) / **Rule Soft** (rule-soft): scrollbar thumbs and button dividers / 1px row rules in tables, call list and log rows.
- **Graticule** (graticule): map graticule lines (1px, 0.7 opacity).
- **Changed Cream** (changed-cream): background a row holds after it changed, until seen.
- **Selected Wash** / **Hover Wash** (selected-wash, hover-wash): selected and hovered rows and log segments.

### Named Rules
**The Ink-and-Ground Rule.** Structure is drawn in navy ink on a change of ground. If a region needs separating, change its background and draw a 2px ink rule; do not add a card, a shadow or a radius.

**The Paired Signal Rule.** Colour is never the only carrier. Risk colour always sits with its R1/R2/R3 text; route kind always also changes stroke style (solid/dashed/dotted); markers carry type through shape and text first.

**The Full Remap Rule.** Dark mode redefines every token on `:root`; components only ever reference tokens, so they need no dark-specific rules. Focus becomes `#f2d04b`.

### Dark Remap
Same token, dark value, applied under `prefers-color-scheme: dark` unless `data-theme="light"`, and under `data-theme="dark"`. Offline Rose is unchanged.
- **Ground Mist (dark)** (#06131f): ground-mist in dark mode; page ground.
- **Paper (dark)** (#0b1d2f): paper in dark mode; work surfaces and controls.
- **Chart Aqua (dark)** (#0d1520): chart-aqua in dark mode; map ground.
- **Frame Bar (dark)** (#173556): frame-bar in dark mode; top bar, lifted off the ground.
- **Navy Ink (dark)** (#e2edf3): navy-ink in dark mode; text, rules, strokes.
- **Slate Ink (dark)** (#9fb5c4): slate-ink in dark mode; secondary text; also bar-ink-muted.
- **Bar Ink (dark)** (#f2f7fa): bar-ink in dark mode; frame-bar text.
- **Rule (dark)** (#2f4d63): rule in dark mode; scrollbars, dividers.
- **Rule Soft (dark)** (#193246): rule-soft in dark mode; row rules.
- **Graticule (dark)** (#4f7a8c): graticule in dark mode; map graticule.
- **Changed Cream (dark)** (#3b3317): changed-cream in dark mode; changed-row hold.
- **Selected Wash (dark)** (#17405a): selected-wash in dark mode; selection.
- **Hover Wash (dark)** (#12304a): hover-wash in dark mode; hover.
- **Risk Yellow (dark)** (#ffe066): risk-yellow in dark mode; R1, and the focus ring.
- **Risk Amber (dark)** (#ff9f43): risk-amber in dark mode; R2, review.
- **Risk Red (dark)** (#c92a2a): risk-red in dark mode; R3.
- **Alert Red (dark)** (#c4213a): alert-red in dark mode; error banner.
- **Track Navy (dark)** (#1c7ed6): track-navy in dark mode; vehicle 1.
- **Track Teal (dark)** (#7048e8): track-teal in dark mode; vehicle 2.
- **Track Plum (dark)** (#0ca678): track-plum in dark mode; vehicle 3.
- **Track Rust (dark)** (#d6336c): track-rust in dark mode; vehicle 4.
- **Track Olive (dark)** (#495057): track-olive in dark mode; vehicle 5.
- **Track Graphite (dark)** (#f59f00): track-graphite in dark mode; vehicle 6.

## Typography

**Display Font:** Archivo (variable, wdth 62–125, wght 400–800, Google Fonts) with system-ui, sans-serif
**Body Font:** Archivo at normal width
**Label/Mono Font:** Archivo condensed (no separate mono; `font-variant-numeric: tabular-nums` is set on body)

**Character:** One grotesque stretched across its width axis, like the condensed numerals and labels on a printed tracking chart. Heavy condensed figures carry counts, times and marks; normal-width regular carries prose.

### Hierarchy
- **Numeral Display** (800, 26px, lh 1, wdth 70): the frame-bar counts (pendientes, en ruta, recogidos, vehículos libres).
- **Headline** (800, 26px, lh 1.05, wdth 78): the selected trip heading.
- **Headline Small** (800, 22px, wdth 78–80): "Llamadas", the brand in the frame bar, and the key-form label.
- **Headline XS** (800, 18px, wdth 78): "Registro de viajes" on the log scale row.
- **Time Numeral** (800, 20px, lh 1.1, wdth 70): HH:MM in the position log.
- **Scale Numeral** (800, 16px, wdth 70): hour labels on the log strip's minute scale.
- **Title** (800, 17px, lh 1.1, wdth 78): vehicle names in the log strip.
- **Body** (400, 14px, lh 1.4): prose, call names, trip sub-lines; metadata at 13px in slate ink. Empty-state text caps at 42ch.
- **Control** (650, 14px, lh 1, wdth 85): buttons; 13px for in-row actions.
- **Mark** (800, 13px, wdth 72–75): risk marks, map markers, stop labels, numbered stops.
- **Small** (700–800, 12px, wdth 72–80): chips, the AHORA tag, log segment end labels, and the vehicle state line in log row heads.
- **Label** (700, 11px, letter-spacing 0.06em, wdth 75): table column heads and graticule collar figures.

### Named Rules
**The Width-Axis Rule.** Hierarchy comes from width and weight, not from new families. Numerals and marks go condensed (wdth 70–80) and heavy; prose stays at normal width and regular weight.

**The Tabular Figures Rule.** Every number on the page is tabular, so times and counts line up in columns and on the log scale.

## Layout

A full-viewport CSS grid with no page scroll on desktop: frame bar across the top, an optional alert banner under it, the map chart filling the left (flexible) and the work column on the right (360–420px), and the trip log strip across the bottom (max 36vh, its own scroll). The work column stacks the selected trip (position log and actions) over the call list, divided by a 2px ink rule.

The log strip is a Gantt on one minute scale: a sticky scale row with major and minor ticks, a 210px row head (vehicle, capacity, state, Desplegar), and tracks whose segment length equals trip duration. A 3px "now" line crosses every row.

The map sits inside a 22px graticule collar on its top and left edges, with tick marks and degree labels.

Spacing is tight and practical: 4/6/8/10px inside rows and between controls, 16px around sections, a 20px side gutter on desktop and 16px on phones. Rows are ruled with 1px soft rules; section heads with 2px ink rules.

At 820px and below the grid becomes one column in the order bar, banner, map (56dvh, min 320px), selected trip, log, calls; the page scrolls, the counts wrap to their own line, the log row head narrows to 150px and buttons grow to 38px tall.

## Elevation & Depth

Flat by default. Depth is conveyed by ground change and ink rules, not shadows. The one exception is things that float over the map: popups, trip tooltips, the legend and the key form get a soft ambient drop shadow so they read as lifted off the chart.

### Shadow Vocabulary
- **Float over chart** (`box-shadow: 0 6px 18px rgb(0 0 0 / .2)`; `.25` on popups): legend panel, trip tooltip, map popup.
- **Modal float** (`box-shadow: 0 10px 30px rgb(0 0 0 / .18)`): the dispatch-key form over the dimmed chart.
- **Highlight halo** (`box-shadow: 0 0 0 3px paper, 0 0 0 6px ink` plus `scale(1.3)`): a map marker linked to the hovered or selected list row.

### Named Rules
**The Flat Chrome Rule.** Bars, columns, tables, rows, buttons and chips never carry a shadow. Only overlays that sit on the map may.

## Shapes

Square UI, round symbols. All chrome (buttons, inputs, chips, rank marks, panels, Leaflet zoom controls, popups) has 0 radius and a solid ink stroke: 2px on controls and panels, 1.5px on chips. Roundness belongs to chart symbols only: the refuge marker is a 26px-tall pill (13px radius), the SOS marker is a rounded tag with one square corner pointing at its position (12px 12px 12px 0), stop numbers and log positions are circles, and clustered markers fan out on straight 2px leaders from a dot.

Stroke style is semantic, not decorative: solid, dashed, dotted and double borders mean active, proposal/disabled, forecast and terminal respectively, on lines, chips, buttons and stop labels alike.

## Components

### Buttons
Blunt, square, stroked; they look like boxes on a printed form.
- **Shape:** square (0 radius), 2px ink border, min height 32px (38px on phones).
- **Default:** paper fill, ink text, control type, padding 7px 12px 6px.
- **Primary:** ink fill, paper text (Desplegar, Recogido, Guardar).
- **Hover / Active / Focus:** hover mixes 12% ink into the fill (primary lightens to 82% ink); active inverts to ink fill; focus is a 3px outline in the focus token, offset 2px (navy in light, risk yellow in dark and inside the frame bar, white on the banner). Transitions 0.15s on colour only.
- **Disabled:** dashed border, slate text, transparent fill.
- **Busy (in flight):** solid border, soft-rule fill with a 3px ink bar sliding along the bottom edge (0.8s alternate).
- **Icon:** 30px square, 16px inline SVG.

### Chips
- **Style:** 12px condensed bold text, 1.5px ink border, square, padding 3px 6px 2px.
- **State:** committed states (En ruta, Recogido, Activa) are ink-filled; proposals are dashed; forecast is dotted in slate; terminal states (Entregado, Descartado) use a 3px double border and uppercase; "requires review" is amber-filled.

### Risk Mark
A square 22px-tall, min 30px-wide box with R1/R2/R3 in the mark style, filled with the risk colour and a 2px ink border (the red one takes a red border). Leads every call row and position-log row.

### Inputs / Fields
- **Style:** paper fill, 2px ink border, square, padding 7px 10px, body type; placeholder in slate ink.
- **Focus:** the global 3px focus outline.

### Navigation (Chart-Frame Bar)
A 52px navy band: brand in condensed 800 with a muted "· Despacho", the SIMULACIÓN plate (2px currentColor box, 800 condensed, letter-spacing 0.12em), the counts as big condensed numerals with small muted labels after them, and the live state pushed right with a 10px square (filled when live, hollow outline when reconnecting).

### Position Log (signature)
The selected trip as a ruled table: 11px column heads over a 2px ink rule, rows on 1px soft rules. Each row has a 24px circled stop number (dashed and slate when skipped, name struck through), the HH:MM time numeral with a small relative time under it, the risk mark, name and status chip, and the row's actions. The arrival row loses its rule and goes bold.

### Stop Labels and Tracks (signature)
On the map each stop carries a label box ("1 · 14:12"): paper with a hollow dot for proposed or forecast, ink-filled with a filled dot for active, a double border for the refuge arrival. Leader lines (2px ink) tie offset labels to their stop. Route polylines use the vehicle colour: active solid 5px at 0.9, deployable dashed `10 8` 5px, forecast dotted `3 8` 3px at 0.4; hover or selection thickens to 8px at full opacity and fades the rest to 0.25.

In the log strip each trip is a segment button whose 4px line uses the same solid/dashed/dotted language, with 14px position dots (filled for active, hollow otherwise, dashed with a slash for skipped) and a condensed "Ref. N · HH:MM" end label.

### Call Row
A two-column grid (34px risk mark, content) on a 1px soft rule: name, age and phone link, slate metadata, status chips, then actions. Hover and selection take the wash tokens; a changed row holds changed-cream until seen; a terminal row fades to 0.25 over 3s before it leaves.

## Do's and Don'ts

### Do:
- **Do** separate regions by changing ground (chart aqua, paper, navy bar) plus a 2px navy-ink rule.
- **Do** keep every control, chip and panel square with a 2px ink stroke (1.5px for chips).
- **Do** use one stroke vocabulary for state everywhere: solid = active, dashed = deployable proposal, dotted/faint = forecast, double = terminal.
- **Do** label every plotted stop with its number and HH:MM, filled when committed, hollow when forecast.
- **Do** set numerals, marks and labels in condensed heavy Archivo (wdth 70–80, weight 700–800) and keep prose at normal width.
- **Do** pair every risk colour with R1/R2/R3 text and every route colour with a stroke style.
- **Do** recolour basemap tiles into the chart ground with the theme's tile filter.
- **Do** reference tokens only, so the dark remap covers each new component with no extra rules.

### Don't:
- **Don't** use cards, rounded panels or radius on controls; roundness is for chart symbols (refuge pill, SOS tag, stop circles) only.
- **Don't** put shadows on bars, columns, rows, buttons or chips; only overlays floating on the map get the ambient float shadow.
- **Don't** add a second type family; hierarchy comes from Archivo's width and weight axes.
- **Don't** let colour carry meaning alone.
- **Don't** show the OSM basemap in its stock colours.
- **Don't** drop the SIMULACIÓN plate from the frame bar.

## Recolor addendum (shipped in `dashboard/index.html`)

- Route lines (same in both themes): `#1c7ed6 #7048e8 #0ca678 #d6336c #495057 #f59f00`. They no longer lift to tints in dark mode.
- Risk ramp `#ffe066 #ff9f43 #c92a2a`; R1/R2 text is black, R3 text white.
- Map ground `#e9eef4` light, `#0d1520` dark. Tile filters: light `saturate(.55) contrast(.96)`; dark `invert(1) hue-rotate(180deg) saturate(.35) brightness(.82) contrast(.92)`. These CSS filters replace the earlier `feColorMatrix` recolour.
- HQ marker `#1f2a44` with white text; refuge pill white with `#c92a2a` text.
- `--now` (now line, AHORA tag): `#0f7c8c` light, `#4fd1c5` dark.
