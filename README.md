# Master Dashboard

An admin-configurable dashboard platform over Google Sheets.

Connect **any number of spreadsheets**, build **any number of dashboard
pages**, and decide **per user** which pages and which individual widgets
they can see. Widgets can **blend two tabs together** on a key column, so a
table built on MASTER can show a value that actually lives in Quotations —
even when the two live in different spreadsheets.

Nothing here requires a code change. An admin does all of it from the panel.

---

## Quick start

```bash
npm install
cp .env.example .env     # fill in your values (see "Environment" below)
npm run dev              # runs the API + the frontend together
```

Open http://localhost:5173.

> Use `npm run dev`, **not** `npm run dev:frontend-only`. The dashboard reads
> data through `/api/sheets`, which needs the local API server running. If you
> only run Vite, the app will tell you so explicitly rather than failing with a
> cryptic JSON parse error.

Run `npm test` for the pure-logic tests (filtering, blending, ref handling).

---

## Concepts

Four things, and everything else follows from them.

| | What it is |
|---|---|
| **Data source** | One connected spreadsheet, plus the list of its tabs this workspace may read. Connected **once**, usable by every page. |
| **Page** | One dashboard canvas — an entry in the sidebar. Declares which data sources it may draw on, and holds its own widgets, filters and buttons. |
| **Widget** | A KPI, table, chart, pipeline… pinned to one tab of one source. Optionally **blended** with a second tab. |
| **Access** | Per user, per page: can they view it, which widgets are hidden from them, which columns they may edit or download. |

### Tab refs

Because two spreadsheets very often both have a tab called `MASTER`, a bare
tab name is no longer an address. Internally every tab is referred to as:

```
<sourceId>::<tabName>          e.g.  src_k3f9a2::MASTER
```

You never see this. The dashboard resolves refs to the shortest unambiguous
label before anything is rendered — `MASTER` when only one source has one,
`MASTER · Premia Sales` when two do.

---

## First-time setup

### 1. Google service account

Sheet data is read server-side by a service account — no individual user needs
Google Sheets access, and the browser never talks to Google directly.

1. Google Cloud Console → create a project (or reuse one) → enable the
   **Google Sheets API**.
2. IAM & Admin → Service Accounts → Create service account → Keys → **Add key
   → JSON**.
3. From that JSON, copy `client_email` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
   `private_key` into `GOOGLE_PRIVATE_KEY`.
4. **Share every spreadsheet with that `client_email`**, exactly as you'd
   share with a person. Viewer is enough for read-only; Editor is required if
   you want inline editing to write back.

Never make a sheet "anyone with the link" — the service account should be the
only thing with access.

### 2. Firebase

1. Firebase console → create a project → add a **Web app** → copy the config
   values into the `VITE_FIREBASE_*` variables.
2. Authentication → Sign-in method → enable **Google**.
3. Firestore → create database.
4. Project settings → Service accounts → **Generate new private key**. Minify
   that JSON to one line and put it in `FIREBASE_SERVICE_ACCOUNT_KEY`.
5. Deploy the security rules in `firestore.rules`.

### 3. Make yourself an admin

Sign in once. That creates your user document with `status: "pending"`. In the
Firestore console, open `users/{your-uid}` and set:

```
role:   admin
status: active
```

Reload — the ⚙️ admin panel appears in the sidebar.

### 4. Build a workspace

1. **🗄️ Data Sources** — *Connect a spreadsheet*, paste the link, *Load tabs*,
   tick the tabs this workspace may use, **Save**, then **Sync data**. Repeat
   for each spreadsheet.

   *Sync data* reads the selected tabs and stores their column lists, which is
   what lets the widget, filter and blend pickers offer real columns. Without
   it there's a circle: a new sheet has no known columns until a page uses it,
   and you can't build that page without the columns. The button reports rows
   and columns per tab, and flags any single tab that failed rather than
   failing the whole sync. **Sync all** appears once you have more than one
   spreadsheet, and runs them one at a time to stay clear of Google's rate
   limits.

   Sync reads what is **saved**, not what's on screen, so it's disabled while
   you have unsaved changes and says why.
2. **📄 Pages** — *New dashboard page*. Name it, give it an icon and a sidebar
   group, and tick the spreadsheets it may draw on. Click **Build**.
3. **🧱 Widgets** — add a table from MASTER, a KPI from Quotations, a chart
   from a completely different sheet, then *Publish to dashboard*.
   **Width** is set one of two ways, chosen explicitly per widget:

   | Mode | What it means |
   |---|---|
   | **Standard width** | A fraction of the canvas — a slider across all 12 columns, reading back as `1/6`, `1/4`, `5/12`, `Full width`. Adapts to the screen. |
   | **Exact pixels** | A fixed number, for when a widget must match a specific size. |

   The mode is explicit rather than inferred, because the two answer different
   questions and guessing would make one behave surprisingly. A **standard**
   width is relative to whatever room there is, so it survives a phone, a
   laptop with the sidebar open and a 4K monitor. A **pixel** width can't
   adapt: on a narrow window it's capped to the space available rather than
   overflowing and pushing a horizontal scrollbar onto the page. Narrow
   standard widths still go full width on a phone, where a 1/6 card would be
   an unreadable sliver.
   Widget cards stay collapsed to one row until you open them, and there's a
   search box once a page has more than three — a page with a dozen widgets
   stays scannable instead of running to thousands of pixels.
4. **🎛️ Controls** — optional. Dropdowns, chips, sliders and condition
   buttons for the whole page, plus one-click saved views. See below.
5. **👥 Users & Access** — activate users, grant pages, hide individual widgets.

> **Upgrading from the two-page version?** The Data Sources tab offers a
> one-click **Import previous setup** while the workspace is still empty. It
> converts each old page into a data source plus a dashboard page, rewrites
> every widget to the new ref form, and carries per-user grants across. Your
> old `sheetConfigs/` and `layouts/` documents are left untouched, so you can
> simply delete the new pages if you don't like the result.

---

## How the pieces work

### The sidebar, and what goes in it

Every page you can see, in one collapsible list. Pages sharing a **group**
name nest under one heading. The sidebar collapses to a 64px icon rail on
desktop and becomes a drawer below `lg`; both the collapsed state and which
groups are open are remembered per browser, so one person tidying their
sidebar doesn't rearrange anyone else's.

**Opening a page collapses the sidebar to its rail**, handing the width back
to the canvas — you clicked through to read the dashboard, not the navigation.
The chevron re-opens it whenever you want to browse, and because the collapsed
state is remembered, it stays how you last left it.

A page carries **two names**, edited separately under **Pages → Settings**:

| Field | Where it shows |
|---|---|
| **Page title** | The heading above the widgets, and the mobile top bar. |
| **Sidebar label** | The sidebar entry and any canvas tab strip. |

A page's **icon** can be an emoji or an image, and it replaces the emoji in
the sidebar, the tab strip, the page heading and the admin list.

### Images, and Google Drive links

Anywhere the panel asks for an image — page icons, KPI icons, the canvas
background, the entrance logo — you can paste a **Google Drive share link**
exactly as Drive gives it to you:

```
https://drive.google.com/file/d/1DwTJ.../view?usp=drive_link
```

That link points at a *viewer page*, not at the image, so putting it straight
into an `<img>` loads HTML and shows nothing. It's rewritten automatically to
a direct-serving URL. `open?id=`, `uc?id=`, `lh3.googleusercontent.com/d/…`
and a bare file id all work too.

Because **no single Drive endpoint serves every file**, each link produces
three candidate URLs — Google's image CDN first, then `thumbnail`, then the
legacy `uc?export=view` — and the image walks them on error rather than giving
up on the first refusal. Requests are also sent with `referrerPolicy="no-referrer"`,
without which Google rejects perfectly public files coming from an origin it
doesn't recognise.

> **The file must be shared "Anyone with the link."** A restricted file
> returns a sign-in page to an image tag no matter how the URL is written —
> nothing on this side can fix that. The panel says so next to any Drive link
> it recognises.

Images are presented to look deliberate rather than merely present: a fixed
square box with `object-cover` so a wide logo and a tall one sit on the same
grid, a hairline ring and soft shadow so a white-background logo doesn't
dissolve into a white card, and a **2× fetch** for retina — a 20px icon
fetched at 20px is visibly soft on any modern screen. A KPI image sits in a
tile tinted with that card's own colour. Backgrounds are fetched at 1280px
rather than icon size.

A failed load falls back to the emoji, so a dead link never leaves a
broken-image glyph in your navigation. Fixing a typo retries immediately.

**KPI image placement.** A KPI with an image can show it two ways: *small,
top-right corner* (the default), or **large, beside the number** — the mark on
the left, then a hairline rule, then the value and label right-aligned. The
large placement shows the logo *whole* rather than cropping it, and is the one
to use when the image **is** what the number is about.

They're separate because navigation and a heading want different lengths: a
sidebar has room for "Sales", the heading above the widgets can afford "Sales
Performance — FY25". Leave the sidebar label blank and it simply uses the page
title, so creating a page never means filling in two name boxes. Where the two
differ, the sidebar tooltip carries the full title, and the sidebar search
matches both.

The admin also decides where each page appears, using two independent
switches:

| Setting | Effect |
|---|---|
| **Show in the sidebar** | Off, and the page has no sidebar entry — reachable only by direct link, or as a tab of its parent. Useful for a page still being built. |
| **Part of which canvas?** | Makes this page a **sub-canvas** of another. It's then reached from a tab strip inside the parent page rather than from the sidebar. |

They're separate because a sub-canvas that *also* deserves a sidebar shortcut
is a real case, and so is a page that's in neither.

Tab strips are one level deep — a page with sub-canvases can't itself become
a tab of a third page, and the picker enforces that. A sub-canvas whose parent
is deleted returns to the sidebar rather than becoming unreachable.

A page that's part of a canvas gets one more checkbox: **"In the canvas tab,
show the full page title instead of the sidebar label"**. A tab strip runs the
width of the content area and can usually afford the longer name where a
sidebar entry can't, so the two are allowed to disagree. The setting shows you
exactly what the tab will read as you toggle it.

### Canvas background

Each page can replace the app's backdrop, under **Pages → Settings**:

| Control | What it does |
|---|---|
| **Style** | App default, solid colour, gradient (two colours, any angle), or an image from a URL. |
| **Fit / position** | For images: fill and crop, fit inside, or tile — and where to anchor it. |
| **Visibility** | How strongly the backdrop shows through, 0–100%. |
| **Blur** | Softens a busy photo so it doesn't compete with the data. |
| **Dim / tint** | A colour wash between the backdrop and the widgets — the thing that makes a photographic background readable at all. |
| **Page text colour** | Automatic, light, or dark — see below. |
| **Hold still while scrolling** | Fixed backdrop vs one that scrolls with the page. |

**Text follows the background.** On *Automatic*, the page works out whether
its headings, tab strip and control bars need light or dark text — measuring
the colour a reader *actually ends up looking at*, which means the backdrop
blended with the tint over it and faded by its own Visibility. A black
background at 10% visibility is really a pale grey, and asking for white text
on it would be unreadable. It uses proper WCAG luminance rather than averaging
the channels, because the eye is far more sensitive to green than to blue.

An **image** can't be measured from CSS, so *Automatic* leaves it alone and
the admin picks — guessing wrong on a photo is worse than not guessing. Widget
cards keep their own light surface either way and are unaffected; only the
chrome sitting directly on the backdrop inverts.

There are one-click presets and a live preview that uses the same resolver the
page does, so the swatch can't drift out of step with what actually gets
painted.

The backdrop is painted on its **own layer behind the widgets**, never as a
background on the content container. That's the whole reason *Visibility* and
*Blur* are usable: applied to a container they'd fade and smear the widgets
sitting inside it; on a separate layer they touch only the backdrop, and the
dashboard stays sharp and readable.

Image URLs must be `https://` or `data:image/` and can't contain quotes,
brackets or whitespace — a background URL ends up inside a CSS `url(...)`
value, so anything that isn't plainly an image location is dropped rather than
escaped. A rejected URL falls back to the app default rather than painting a
blank slab.

### Widget order — three levels

Widgets are ordered by the most specific instruction available:

| Priority | Set where | Applies to |
|---|---|---|
| 1 | Dashboard **⇅ arrange** button | Just that user, set by themselves |
| 2 | **Users & Access → set order for this user** | Just that user, set by an admin |
| 3 | The number box on each widget in the Widgets panel | Everyone |
| 4 | The order widgets were added in | Everyone |

The precedence is deliberate. An admin deciding a salesperson should see the
pipeline first is a legitimate instruction, so it beats the page default — but
a person rearranging their own screen isn't overriding policy, it's a
preference about their own eyes, so it still comes first. Nothing here decides
what a user may *see*; that's `hiddenWidgets`, enforced separately and not
reachable from the dashboard.

Lower numbers come first; blank means "leave it where it is", so numbering one
table moves just that table and doesn't reshuffle everything else. A user's
own order is stored per user, per page, so it follows them between devices.

### Widget appearance

Every widget has an **Appearance** section: a named theme (plain, soft,
outlined, elevated, flat, dark) as a starting point, then individual overrides
for background, border colour, border thickness, corner radius, inner padding
and shadow. There's a live preview beside the controls.

Every field starts at *system default* and stays there until touched, so a
widget nobody has restyled stores no styling at all and looks exactly as the
stock theme does. Clearing a field returns it to the theme, never to a
hard-coded value.

### The entrance

A short branded animation on the way in. It plays on **every page load** —
refresh and you see it again — but not when moving between pages inside the
app, where it would be an obstacle rather than a flourish. Dismissed by a
click, any key, or a timer, and skipped entirely for anyone whose system asks
for reduced motion.

Everything on it is editable under **Admin → ✨ Entrance**, with no redeploy:

- **Brand name and tagline.** A value saved here beats `VITE_BRAND_NAME` from
  the build; blank falls back to it, so a fresh install still says something
  sensible.
- **Logo image**, which replaces the generic mark entirely. Previewed on the
  entrance's own near-black backdrop, because a logo that looks fine on white
  can vanish on dark.
- **Announcements** — campaigns, achievements, milestones and notices, each
  with an icon, headline, supporting line and colour. Up to four show at once,
  fading in under the wordmark.
- **Date ranges.** Give an announcement a start and/or end date and it appears
  and disappears on its own. This is the setting that stops the entrance
  becoming stale furniture — a campaign that ended last month stops greeting
  people whether or not anyone remembers to take it down. End dates are
  inclusive to the last moment of the day.
- **Duration**, clamped to 1.2–6 seconds plus a little reading time per
  announcement, so a mistyped value can't hold anyone hostage.
- **An off switch**, which keeps the announcements but skips the animation.

Each announcement has a live preview beside its fields, drawn exactly as the
entrance will draw it, and a badge saying whether it's showing right now — and
if not, why not.

### All of a page's tabs load at once

Every ref a page needs is fetched in one request. The server groups them by
spreadsheet and issues one Google `batchGet` per spreadsheet, then caches
briefly in the serverless function and at the CDN edge. A page drawing on
three sheets costs three round-trips, not one per tab.

### Filters are scoped to the tabs they name

Because a page shows tabs with completely different columns — now from
different spreadsheets — a filter that applied to everything would empty every
unrelated table.

So: **a filter narrows only the tab it names.** A `DSE Name` dropdown built on
MASTER filters the MASTER widgets and leaves the GOOGLE REVIEW table alone.
When two tabs genuinely share a field, use *"Also filter these tabs"* to link,
say, `MASTER."DSE Name"` to `Quotations."DSE Name"` so one control drives both.

Buttons work the same way. The **global search box** is the exception — it
matches any cell on any tab.

### Blending two tabs in one widget

A widget reads one tab. Turn on **🔗 Blend a second tab into this widget** and
it also pulls a second one, matched row by row on a key column — a VLOOKUP
that lives in the dashboard instead of the spreadsheet.

```
MASTER."Order #"   =   Quotations."Order No"
```

The two tabs may come from **different spreadsheets**; only the key has to
line up. Keys are matched ignoring case, surrounding spaces and number
formatting, so `SO-1001`, ` so-1001 ` and `1,001` vs `1001` all behave.

| Setting | What it does |
|---|---|
| **Unmatched rows** | *Keep every row* (left join), *Only matching rows* (inner join), or *One row per match* (expand — a row matching 3 rows becomes 3 rows). |
| **When several rows match** | First / last match, join distinct values with `, `, or sum them. |
| **Prefix** | Namespaces incoming columns so `Status` from the other tab can't overwrite your own `Status`. |
| **Columns** | Which columns come across. |
| **Roll-ups** | Summarise the matched rows — "sum of Amount across every quotation for this order". A match-count column is always added. |
| **If blank** | A backup column, from either tab, for when the blended cell comes back empty. |

**Backup columns are worth setting.** A blended cell ends up empty two ways —
the key matched nothing, or it matched a row whose cell is blank — and they
look identical on screen. Either way a chart grouped by that column **skips
blanks**, so those rows quietly disappear and the totals stop adding up. Five
vehicles in stock, four bars, no explanation.

Per blended column, pick one backup column and/or a literal:

```
if  Location  is blank, use  Stock · Default Yard  or  "Not allocated"
```

The backup can be **any column from either tab** — the widget's own, or
another column of the tab being blended in. The picker names the tab beside
each column, because both tabs having a `Status` is normal and the side is
what tells them apart.

Tried in order: the real value, then the backup column, then the text. A real
value is never overwritten, and the match-count column still tells the truth
— a backup fills the display, it doesn't pretend a match happened. When
several rows match, a backup from the blended tab is collapsed the same way
the value it replaces would have been, so *last match* means one thing.

Two cases where a backup appears not to work, both of them the row already
being past saving:

- A backup from the **blended tab** is empty for a row that matched nothing —
  there is no matched row to read any column from. That falls through to the
  text, which is where a caption like "Not allocated" earns its place.
- **"Only matching rows"** drops unmatched rows before any of this runs. A
  matched-but-blank cell still falls back; a row with no match at all is
  already gone.

Blended columns behave like any other column: sort them, chart them, put them
in a KPI, show them as coloured pills. The blend is scoped to **that one
widget** — nothing else on the page changes.

### Drilling on a blended column

Clicking a chart grouped by a **blended** column — say a horizontal bar of
stock by `Yard.Location`, where the location came from a second tab — filters
the **whole page**, not just that widget.

It has to work indirectly, because a blended column exists only on the widget
that blended it: filtering anything else by `Yard.Location` would match
nothing. So the click is resolved back to **the join key**. "Pune Yard"
becomes *the set of VINs whose location is Pune Yard*, and that set is what
travels across the page:

| Widget's tab | How it narrows |
|---|---|
| The blend's **left** tab (`STOCK`) | on `VIN` — the key the blend named |
| The blend's **right** tab (`YARD`) | on `Chassis No` — its own, differently-named key |
| Any **other** tab with a `VIN` column (`SERVICE`) | on `VIN`, by name |
| A tab with neither | untouched — silence, not an empty table |

The keys are collected from the **unfiltered** blend, so the set means "every
VIN in Pune Yard" rather than "the ones that happened to survive the filters
already applied". Other filters still stack on top, so removing one widens the
result instead of leaving it stuck.

The chip shows how many key values are behind the drill, and its tooltip names
the column they matched on — a filter that reached widgets you didn't click
should say so.

Two deliberate limits: blended columns are never inline-editable (the cell
lives in another spreadsheet, and one blended row can stand for several source
rows), and the pipeline widget can't blend, because each of its stages already
picks its own tab.

### Widget types

| Type | What it does |
|---|---|
| **KPI Card** | One number from a tab + column + calculation. Counts up on change; with filters active it shows the unfiltered total underneath. Can express a conversion between two tabs. Its mark can be an emoji **or an image URL**. |
| **Workflow Pipeline** | A funnel of stages, each a label + colour + its own condition set, with optional trend line and pop-up KPIs. Click a stage *or one of its KPIs* to drill in. |
| **Leaderboard** | Ranks any column by any metrics you define. Click a row to drill in. |
| **Data Table** | Sortable, reorderable, searchable grid with optional inline editing, row detail panel and per-row download actions. |
| **Chart** | One data shape, **17 styles** — bar, horizontal bar, lollipop, line, step, area, waterfall, pareto, histogram, pie, donut, rose, radar, radial, treemap, funnel, progress list. Plus colour rules, reference lines and axis scaling. Every style is clickable to drill in. |
| **Stacked / Grouped Bars** | Bars by one column, split by a second. Stacked or side-by-side. Overflow segments merge into "Other" so totals stay honest. |
| **Combo Chart** | Bars and a line on **two independent axes** — volume against rate, which one axis would flatten. |
| **Scatter / Bubble** | Two numeric columns plotted against each other, optionally sized by a third and coloured by a fourth. The one widget that shows individual rows, so outliers survive. |
| **Heat Map** | The pivot's cross-tabulation as colour intensity, with five ramps. Click a cell to filter to that row × column. |
| **Trend Over Time** | Buckets a date column by day / week / month / quarter / year, filling empty periods with zero. Click a period to filter to it. |
| **Pivot Table** | Cross-tabulates columns, with totals. Either axis can cross **several** columns. Renders as a full matrix, or as a grouped list with parent values merged down their children. |
| **Gauge / Target** | Progress toward a target, with zones and click-to-filter. |
| **Activity Feed** | A chronological feed of the newest rows. |
| **Scorecard** | Compares a metric between two condition sets, side by side. |

### Controls

Everything that narrows the page lives in **one** admin section, **🎛️
Controls**, and renders as one bar in the order you list it.

| Group | Kinds |
|---|---|
| **Pick a value** | Dropdown · Dropdown (multi-choice) · Chips |
| **Type or search** | Text search box |
| **Sliders** | Number range (two handles) · Single threshold (≥ / ≤) · Stepped bands · Last N days |
| **Dates & numbers** | Date range · Number range (min/max boxes) |
| **Actions** | Condition button |

This used to be two panels writing two arrays — "Filters" and "Buttons" —
which forced a split that meant nothing to the person using the dashboard. A
`Status` dropdown and a `Pending invoices` button both just narrow what you're
looking at, and they could never sit next to each other because of which array
they happened to live in. Now order in the list is order on screen.

Each control also has:

- **Width (px)** — an exact pixel width, typed. A control bar is a layout the
  admin is composing, and "medium" is not an answer to "will these four
  controls fit on one row above the chart" — a number is. Quick presets
  (120 / 160 / 200 / 260 / 320 / 420) sit beside the box; blank fits the
  contents. A pinned width overrides the control kind's own minimum, so the
  number you type is the width you get. The same box appears on per-widget
  controls.
- **Tuck behind "More"** — keeps the bar short. The *More* button carries a
  badge counting how many hidden controls are currently active, so nothing can
  narrow the page invisibly.
- **Visible** — switch a control off without deleting it.
- **Default value** (or *On by default* for a button) — the page opens with it
  applied. **Reset** returns to *these* defaults, not to blank: a control the
  admin meant to be on shouldn't be switched off by a reset.
- **Also narrow these tabs** — one control driving the same field on several
  tabs.

Sliders read their bounds from the column's real values unless you pin them,
so they stay correct as the sheet grows. Each reuses a value shape the engine
already understood (`{from,to}` for ranges, a bare number for thresholds and
day counts), and the page bar and the per-widget bar share one set of slider
components — two implementations would drift apart the first time one got a
fix.

### Saved views

A **view** is a named one-click preset of every control: "This month's pending
invoices" instead of setting six things every morning. Admins define them in
the Controls panel; users see them as buttons at the top of the bar, and the
one matching the current state lights up.

Views store control **values**, not raw conditions, so a view keeps working
when an admin later re-tunes what a control does. Applying one *replaces* the
whole control state rather than merging into it, so clicking a view always
lands you somewhere predictable instead of somewhere that depends on what you
had set before.

> **Upgrading:** a page saved before the merge is read as one list
> automatically — filters first, then buttons, exactly the order they rendered
> in before. The stored document isn't rewritten until you publish the
> Controls panel, so simply opening a page never modifies it.

### Controls on a single widget

The page filter bar spans every widget reading a tab. **Widget controls**
narrow **one widget only**, and every widget type can have them — a chart can
carry a "top 10" slider, a KPI an amount threshold, a table its own status
dropdown, all without disturbing anything beside them.

Ten kinds, added under each widget in the admin panel:

| Control | What it does |
|---|---|
| **Dropdown** | One value from the column. |
| **Chips** | Multi-choice, all options visible. |
| **Search box** | Free text across one column. |
| **Condition button** | A saved condition set, toggled on and off. |
| **Slider — number range** | Two handles. Bounds read from the data unless pinned. |
| **Slider — single threshold** | One handle: at least (≥) or at most (≤). |
| **Slider — stepped** | Snaps to your own bands (`0, 1L, 5L, 10L`) with tick labels. |
| **Slider — last N days** | Drag back through time on a date column. |
| **Slider — top N** | Keeps the first N rows. |
| **Date range** | Two date boxes. |

Sliders read their bounds from the column's real values, so they stay correct
as the sheet grows — a hard-coded maximum silently becomes a filter the day
someone books a bigger order. **Top N is always applied last**, whatever order
the controls are in: "top 10" has to mean the top 10 of what survived the
other controls, not the top 10 of the raw tab which the others then whittle
down to three.

Controls render in the canvas wrapper above each widget, which is why all
fourteen widget types get them without any widget knowing controls exist.

### Chart styles

Seventeen, all sharing one "group by a column and aggregate" config, so
switching style never means rebuilding the widget:

| | |
|---|---|
| **Comparing** | Bar · Horizontal bar · Lollipop · Treemap · Radial bars |
| **Over a sequence** | Line · Step line · Area |
| **Composition** | Pie · Donut · Rose (polar area) · Funnel · Progress list |
| **Analysis** | **Waterfall** (running total, rises and falls coloured apart) · **Pareto** (bars + cumulative %, with the 80% line marked) · **Histogram** (distribution of one numeric column) · Radar |

A **rose** varies petal *length* rather than angle, which is far easier to
compare than a pie once there are more than a handful of slices. A
**lollipop** is a hairline stem plus a dot — much less ink than bars, which is
what keeps twenty categories readable. A **histogram** is the one style that
bins a numeric column instead of grouping by a category, so it gets its own
fields (column, bin count, optional fixed range).

### Clicking a chart

**Every** style drills, and on the cartesian ones a click anywhere in a
category's column counts — you no longer have to hit a 6px bar. Radar, line
and area are clickable too, which they previously weren't at all.

Two styles drill to a **range** rather than a label, because their captions
aren't values any row holds:

- a **histogram** bin filters to `between from and to`
- a **trend** bucket filters to that period's real start and end dates

Pivot tables and heat maps drill from their **row and column headers** as well
as their cells — "all of March" and "everything for West" are the two
questions those charts invite most, and neither should need a trip to the
filter bar.

### Advanced charts

Under every chart's **Advanced** section. Options that a given style can't
honour are **disabled and explained** rather than silently ignored — a pie has
no axis for a reference line, and a setting that quietly does nothing is
indistinguishable from a bug:

**Colour by** — one colour; a colour per category; *shade by value* (darker
where the number is bigger); *highlight best & worst*; or **conditional
rules** — your own thresholds, e.g. red under 50, amber under 80, green above.
Rules match top-down and the first hit wins, so you can order them from most
to least specific and read them like an `if/else`.

**Reference lines** — at a fixed value, or at the **average, median, highest
or lowest** bar, computed live from whatever is currently plotted. A line at
the average is what turns "here are the numbers" into "here's who's behind".
Each gets its own colour, label and dashed/solid style.

**Axis steps** — force ticks every 50, every 100, whatever the chart is read
in, instead of letting the library pick. The domain rounds *outward* to the
next multiple so the tallest bar keeps headroom, and reference lines are
counted in that domain — a target line above every bar would otherwise be
clipped off the top, precisely when you most need to see it. An absurd step
(which would draw thousands of gridlines) is ignored rather than obeyed.

**Data labels**, **grid lines** and a **legend** toggle independently, and all
three now reach every style that can show them — pie labels, radial labels,
funnel labels, radar's polar grid, treemap tile values.

**Colour rules apply everywhere too.** Treemap, funnel, radial and pie used to
hard-code the palette and ignore the colour mode entirely; they now honour it,
while still *defaulting* to the palette, since a single-colour pie is not a
chart.

### Pivot tables

Either axis can cross **several columns**: rows by Region *and* DSE gives one
row per real combination — "West › Ravi" — rather than two pivots side by
side. Column order is explicit, with move controls, because "Region then DSE"
and "DSE then Region" produce the same counts but read as different reports.

**Show as** switches between two shapes.

**Full matrix** is the classic contingency table — rows × columns, heat-shaded
cells, with row, column and grand totals.

**Grouped list** drops the column axis and renders the row levels as a
hierarchy, one column per level, with repeated parent values **merged into a
single spanning cell**:

```
Model        SKU               Color   Stock
SPLENDOR +   HSPLMDRSCFIBHG    BHG       159
             HSPUNIRSCFIBLA    BLA        63
             HSPLMDRSCFISBK    SBK        37
HF DELUXE    HDLHADRSCFISBK    SBK        85
             HDLHADRSCFIBKG    BKG        42
```

That's a real `rowSpan`, not blanked-out repeats: the merged cell stays put
when the table scrolls, copies as one value, and reads correctly to a screen
reader. Sorting applies at **every** level, so the biggest group comes first
and so does the biggest row inside it. Options: a faint proportional bar
behind each number, a subtotal under each merged cell, and a cap on top-level
groups.

Clicking a row drills into that exact combination; each level becomes its own
condition, so a "West › Ravi" drill filters on both columns rather than on a
value no single column holds.

### Cross-filtering (drill-down)

Clicking a **pipeline stage**, a **stage KPI**, a **chart bar/slice/tile**, a
**stacked or combo bar**, a **heat-map cell**, a **leaderboard row**, a **KPI**
or a **gauge** filters the whole page to those rows. Active drill-downs appear
as removable chips, so it's always visible *why* the numbers changed. Clicking
the same thing again clears it. Drill-downs obey the same tab scoping as
everything else.

A **stage KPI** drill combines the stage's conditions with the KPI's own —
"delivered vehicles that were financed", not just "financed" — so the number
on the card and the rows the dashboard then shows agree. A stage KPI with no
conditions of its own stays inert, since filtering by it would be identical to
clicking the stage.

### Column filters (Excel / Sheets style)

Every column header has a **funnel**. It opens a searchable list of the values
actually in that column, each with a count, everything ticked until you untick
something — plus A→Z / Z→A sorting and a *contains* box.

Two details that make it behave the way a spreadsheet does:

- **A column's options respect the *other* columns' filters.** Filter Model to
  `SPLENDOR +` and the SKU menu offers Splendor SKUs only. Otherwise you'd be
  choosing between options that return nothing. A column never narrows its
  *own* option list, or you could untick a value and have no way to tick it
  back.
- **Filters store what's excluded, not what's included.** A value added to the
  sheet tomorrow shows up rather than being silently hidden — which is what
  someone who left "select all" ticked actually meant.

The *contains* box doubles as a numeric test: type `>100`, `<=5`, `=85`.
Matching that as literal text would never find anything, so it's taken as the
comparison it obviously is.

The funnel stays lit on any filtered column, the caption reads
*"filtered from 1,240"*, and a red **Clear** button with a count appears in the
toolbar — a narrowed table can never quietly look like a short one.

### The data table

- **Card height** is the admin's choice: *Fixed* (a set pixel height, grid
  scrolls inside), *Fit the table* (the card grows to the rows — no inner
  scrollbar at all), or *Full screen height*.
- **Drag a column header** to reorder columns; **click** to sort,
  **Shift-click** to add a tie-breaker.
- **Click a row** for a slide-in detail panel — if the admin enabled it. The
  panel can show more fields than the grid.
- **Coloured pills**: nominate columns like Status and each distinct value
  gets its own stable colour automatically.
- Per-table search, compact-density toggle, CSV export of the filtered rows.

### Buttons

A button is a saved set of conditions; pressing it filters the page, pressing
again clears it. 22 operators (text, numeric, date, empty/not-empty, ranges,
"within last N days", "this month"…), combined with AND or OR. Give two
buttons the same **group** name and they behave like radio buttons.

### Editing back to the sheet

A table widget has an *Allow inline editing* switch, which only makes the
table editable **in principle** — a user also needs the specific columns
granted in **Users & Access**, per tab. Admins can edit anything. Every write
is re-checked server-side against the page, the ref and the column, so the
browser can't grant itself permission.

### Permissions

In **👥 Users & Access**, expand a user to get a card per page:

- **Can view** the page at all
- **Widgets visible** — a per-widget deny list, so a widget added next week is
  visible by default rather than silently hidden until everyone is re-granted
- **Columns they may edit** and **Downloads they may use**, per tab

Plus *Grant all pages*, *Revoke all*, and **Copy permissions from…** another
user — the fast path for onboarding someone into an existing role.

---

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `VITE_FIREBASE_*` | client | Firebase web app config |
| `VITE_BRAND_NAME` | client | Name on the sign-in screen and entrance animation (default `Chavan Udyog Samuh`) |
| `VITE_BRAND_TAGLINE` | client | Line under it |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | server | Service account that reads the sheets |
| `GOOGLE_PRIVATE_KEY` | server | Its private key (escaped `\n` is handled) |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | server | Firebase Admin JSON, one line |

`VITE_PAGE_A_LABEL` / `VITE_PAGE_B_LABEL` are only still read by the legacy
importer, to know what the old pages were called. Pages are created in the
admin panel now.

Anything prefixed `VITE_` is bundled into the browser. Never prefix a secret.

---

## Firestore data model

| Collection | Document | Contents |
|---|---|---|
| `users` | `{uid}` | `email`, `name`, `status` (`pending`/`active`/`removed`), `role` (`user`/`admin`) |
| `dataSources` | `{sourceId}` | `name`, `sheetId`, `tabs[]`, `tabHeaders{tab: columns[]}`, `dateOrder`, `lastSyncedAt` |
| `dashboards` | `{pageId}` | `name`, `navLabel`, `icon`, `iconUrl`, `group`, `order`, `showInSidebar`, `parentId`, `tabUsesPageName`, `background`, `hideSearch`, `sourceIds[]`, `widgets[]`, `controls[]`, `views[]` |
| `access` | `{uid}_{pageId}` | `canView`, `hiddenWidgets[]`, `widgetOrder{}`, `editable{ref: columns[]}`, `downloadable{ref: columns[]}` |
| `userPrefs` | `{uid}_{pageId}` | `widgetOrder{widgetId: number}` — one user's own widget arrangement |
| `settings` | `entrance` | `brandName`, `tagline`, `logoUrl`, `enabled`, `durationMs`, `items[]` — the entrance animation |

`settings/entrance` is **publicly readable** — the one deliberate exception in
the rules. The entrance plays while authentication is still resolving, so
gating it on sign-in would mean it silently never showed its content. Nothing
in it is sensitive: it's a greeting screen, and every word was written to be
shown to people. Writing it is still admins only.

`controls[]` replaces the older `filters[]` + `buttons[]` pair. Both are still
read for pages that predate the merge, and are emptied the first time the
Controls panel is published so the document has one source of truth.

`userPrefs` is the only collection ordinary users may write to, and
deliberately the most boring one: display order and nothing else. It grants no
access and hides no widget, so the worst anyone can do by writing there is
rearrange their own screen.

`tabHeaders` is written automatically by the server every time a dashboard
loads, so renaming or adding a column in Google shows up in the admin pickers
without anyone retyping anything.

`access` documents are read **one at a time by exact id**, never as a
collection query — the security rule permits `get` for your own grants but
rejects a `list` that could return someone else's. Don't "optimise" that into
a query.

The v2 `sheetConfigs` and `layouts` collections are still readable so an
unmigrated workspace keeps working. Delete them once the importer has run and
your pages look right.

---

## API

Single route, `api/sheets.js`. Every request carries a Firebase ID token; the
server verifies it and applies that user's permissions.

| Request | Does |
|---|---|
| `GET /api/sheets?page=<pageId>` | Reads every ref the page is allowed |
| `GET /api/sheets?page=<pageId>&refs=src_a::MASTER,src_b::Quotations` | Reads a subset |
| `GET /api/sheets?action=listTabs&sheetId=…` | Admin only — lists a spreadsheet's real tab names |
| `GET /api/sheets?action=syncSource&sourceId=…` | Admin only — reads a source's tabs and refreshes its stored column lists |
| `POST /api/sheets` | Writes one cell (`{page, ref, row, column, value, headers}`) |

A page may only read a ref whose source is on its own `sourceIds` list **and**
whose tab is on that source's own `tabs` list. Both are checked server-side
from stored config, so a crafted request naming another page's spreadsheet is
dropped.

---

## Deploying to Vercel from GitHub

### 1. Push to GitHub

```bash
git init                       # if the repo isn't one yet
git add .
git commit -m "Master dashboard"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env` is git-ignored, so your credentials stay local. Everything the server
needs is supplied as a Vercel environment variable instead.

### 2. Import into Vercel

1. **New Project → Import** the GitHub repo.
2. Framework preset: **Vite** (detected automatically).
3. **Root Directory** must be the folder containing `package.json` and
   `/api`. If the repo has the project inside a sub-folder, set it here —
   getting this wrong is the single most common cause of `/api` returning
   raw source instead of running.
4. Build command `npm run build`, output directory `dist`. Both are already
   in `vercel.json`, so leave the defaults.

### 3. Environment variables

Add every variable from the table above under **Settings → Environment
Variables**, for *Production*, *Preview* and *Development*.

Two that catch people out:

- **`GOOGLE_PRIVATE_KEY`** — paste it complete, including the
  `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. Escaped
  `\n` is handled either way.
- **`FIREBASE_SERVICE_ACCOUNT_KEY`** — the whole JSON minified to **one line**.

### 4. Firebase authorised domains

Firebase → Authentication → Settings → **Authorized domains** → add your
`*.vercel.app` domain and any custom domain. Without this Google sign-in is
rejected with no useful error.

### 5. Deploy the Firestore rules

`firestore.rules` is not deployed by Vercel. Push it from the Firebase console
or with `firebase deploy --only firestore:rules`. Until you do, the new
collections (`dataSources`, `dashboards`, `userPrefs`, `settings`) are
unreadable and the app will look empty.

### Notes

- `server/local-api.js` is local-dev only. Vercel runs `api/sheets.js`
  directly as a serverless function.
- The build splits React, Recharts and Firebase into their own chunks, so a
  routine deploy only invalidates the small app bundle rather than making
  returning users re-download everything.
- The `vercel` CLI is deliberately **not** a dependency — it's ~100 MB and
  would be installed on every build. `npm run dev:vercel` fetches it on
  demand via `npx`.

---

## Project layout

```
api/
  sheets.js               Single API route: read refs, list tabs, write a cell
  _lib/googleSheets.js    Sheets client — batch reads, tab discovery, caching
  _lib/firebaseAdmin.js   Token verification + server-side permission checks
src/
  lib/refs.js             Tab refs: encode, parse, label, rewrite a layout
  lib/blend.js            Per-widget joins between two tabs
  lib/workspace.js        Sources, pages, canvases, access, legacy migration
  lib/widgetOrder.js      Personal + admin widget ordering (pure)
  lib/widgetStyle.js      Per-widget appearance -> CSS custom properties
  lib/pageBackground.js   Per-page canvas backdrop + automatic text contrast
  lib/widgetControls.js   Per-widget dropdowns, buttons and sliders
  lib/imageUrl.js         Drive-link rewriting + the image URL allow-list
  lib/pageControls.js     The unified page control list + saved views
  lib/chartOptions.js     Colour rules, reference lines, axis scaling
  lib/branding.js         Entrance brand + dated announcements
  lib/config.js           Widget types, chart styles, aggregations, operators
  lib/dataUtils.js        Parsing, aggregation, grouping, pivots, scatter
  lib/filterEngine.js     Filter + button + drill-down evaluation, per tab
  lib/sheetsApi.js        Browser-side API client
  hooks/useWorkspace.js   Live sources, pages and this user's access
  hooks/usePageData.js    Loads all of a page's refs at once
  hooks/useUserPrefs.js   One user's personal settings for one page
  components/AppShell.jsx     Sidebar + content frame
  components/Sidebar.jsx      Collapsible, groupable page navigation
  components/SplashScreen.jsx Branded entrance
  components/ControlBar.jsx   The page control bar + saved views
  components/WidgetControls.jsx  Per-widget control bar
  components/Sliders.jsx      Slider primitives, shared by both bars
  components/PageIcon.jsx     Page mark: image, falling back to emoji
  components/widgets/*        The fourteen widget types
  pages/Dashboard.jsx     One canvas; resolves refs to labels and blends
  pages/Admin.jsx         Admin shell + admin/*Panel.jsx
```

---

## Troubleshooting

**"The /api backend isn't running"** — you started `dev:frontend-only`. Use
`npm run dev`.

**403 from Google when loading tabs** — the spreadsheet isn't shared with
`GOOGLE_SERVICE_ACCOUNT_EMAIL`. Share it like you'd share with a person.

**A widget says "Tab X could not be read"** — that tab was renamed or deleted
in Google, or its spreadsheet was removed from the page under **Pages**. Other
tabs still render; the Pages panel warns you when widgets are left orphaned.

**"No columns known for this tab yet"** — that tab has never been read. Open
**Data Sources** and hit **Sync data** on its spreadsheet. (Loading a page
that uses the tab also syncs it, but sync is the direct route and works
before any page exists.)

**A blend returns no matches** — check the two key columns really hold the
same identifier. Case, padding and comma-grouping are handled for you;
`SO-1001` vs `1001` is not.

**Dates filtering oddly** — set each spreadsheet's date format under Data
Sources. It only matters for genuinely ambiguous values like `05/06/2024`;
`25/06/2024` is detected automatically either way.
