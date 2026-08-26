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

### Designing a page, from the page

The admin panel is where a page is **built** — which tabs, which widgets,
which conditions. It's the wrong place to decide how a page **looks**,
because looking at it is the only way to tell, and a form on another screen
means changing a number, saving, navigating back, squinting, and going round
again.

So an admin gets a **palette button** in the page header, and everything
about the page's appearance is edited on the page itself, applied as you
drag the slider.

**There are no columns.** Every widget takes exactly the width you type into
its **W** box; they sit side by side in your order, each starting where the
one before it ended; and a row wraps when the next one will not fit. That is
the whole layout model, and it has the three properties a column grid could
not have at once: nothing is ever rounded up, so there is no dead strip
beside anything; nothing is ever moved past anything else to fill a hole, so
the order you arrange is the order that is read; and the row breaks wherever
the screen happens to end, so the same page reflows on a monitor, a laptop
and a phone with nobody configuring breakpoints.

#### Rows are a thing you can put a widget in

The **R** box on a widget's pill says which row it belongs to. In **Arrange**
mode the rows are outlined and labelled — *Row 1*, *Row 2* — so you can see
what you're assigning to.

The rule is the one anybody would guess:

- Rows are filled in order, left to right.
- A widget goes in the row it asked for **if there is room left in it**.
- If there isn't, it goes to the **next** row — ahead of whatever was already
  assigned there, because it came first in the sort.

So a widget pinned to row 2 stays on row 2 whatever happens above it, and a
row that runs out of width spills downward instead of squashing anything.
A row is as tall as its tallest widget, so rows line up.

**Blank means row 1**, and that isn't a special case: everything starts in
row 1, row 1 spills into row 2, row 2 into row 3. A page where nobody has set
a row behaves exactly as it did before rows existed — which is why turning
this on changed nothing about any existing page. An empty row isn't drawn
either: putting one widget in row 5 of a two-row page doesn't leave three
bands of white space above it.

| | |
|---|---|
| **Gap across / gap down** | Two separate numbers, 0–64px. The eye reads a row and a column differently, and a dashboard that needs air between its columns very often wants its rows tighter than that, not looser. |
| **Canvas width** | How wide the page may get on a large screen. 0 means all of it. |
| **Card look** | Any of the widget themes, page-wide — a default underneath every widget, not an override: a widget you restyled deliberately keeps its own look. |
| **Corner radius · padding · surface colour · border colour** | Page-wide, with **auto** on each to hand it back to the theme. |
| **Text size** | 75%–140%. Everything scales together — the same design at a different size, not a different design. |

Nothing is written until **Save for everyone**. A design being fiddled with
is not a design the other forty people looking at this page should be
watching change under them — but *this* screen updates on every keystroke,
because judging it any other way is impossible. Closing the panel discards
an unsaved draft rather than leaving the page looking wrong for no visible
reason.

#### One widget across several rows

The **↕R** box beside **R** is how many rows a widget covers. `R2` with
**↕R 3** means *rows 2 to 4* — and the pill says so: `R2-4`.

A span is a **vertical reservation**. The widget holds its width all the way
down through those rows, and it is drawn as tall as they are together —
bordered by the band of rows rather than floating in the middle of it. That's
the layout a single row could never express: a tall chart on the left with
three KPIs stacked beside it, each in its own row.

Everything else keeps working exactly as it did. The rows a span passes
through go on filling left to right, they just start **after** it rather than
underneath it, and a widget that no longer fits in what's left spills to the
next row as usual.

Two decisions worth knowing about, because both are places this could have
gone quietly wrong:

- **A span does not set the height of the row it starts in.** The rows are
  sized by everything *else* in them — the three KPIs — and the chart fills
  what that comes to. The alternative makes every row in the band as tall as
  the whole span, and the page grows by the height of the chart three times
  over.
- **A span taller than its band pushes only the *last* row down.** Spreading
  the slack through every row would move things that had no reason to move;
  the bottom of the band is where the extra height actually is.

While arranging, the stretch of a row a span is standing in is shaded, no
dotted "what fits here" box is ever drawn across it, and the `N free` figure
on that row counts it as taken. Room that is already occupied is not room.

**The H box works on a span**, and is exact. A span is *drawn* at the height
of its band, so measuring it just read that height straight back and the
number you typed was outvoted by the consequence of itself — the box did
nothing. Now a typed height is taken as read: type a smaller one and the
widget sits at it inside its rows; type a bigger one and the band grows to
hold it, so it is still bordered by the rows it covers. The box's tooltip
tells you what the band currently comes to.

**Blank means one row**, so this is invisible until it's used, and a page
that has never heard of spans lays out to the same pixel it always did.

#### The same page on a laptop, a tablet and a phone

Typing pixels is how you say what a widget's size is **relative to the
others**. It is not a promise that every screen is the one you typed them on
— so the numbers are a design at a width, and the page meets whatever width
it actually gets:

| | |
|---|---|
| **The room is there** | The typed numbers, exactly. Nothing changes on the screen you arranged on. |
| **Somewhat narrower** | Every typed width is scaled by the same ratio. Rows stay rows, the order stays the order, and the relative sizes you chose survive — the same page, smaller. |
| **A phone** | One widget per line, full width, in the order they were arranged. |

The width the page was **designed for is inferred, never typed**: it's the
widest row's worth of typed widths. Nobody has to record it, it can't go
stale, and it moves on its own as you edit. A page built entirely from named
widths (*half*, *third*) wants no particular width and was already fluid, so
nothing about it changes.

**A typed height comes down with the typed width it was chosen against.** A
chart typed as 600 × 360 stays that shape at every size. Honouring half the
decision is how a widget becomes a letterbox chart with a field of empty card
underneath it. A widget with no typed height is left to measure itself — its
content reflows at the new width, and a scaled guess would be a worse number
than the one the browser is about to produce.

Three details that decide whether this feels right or merely works:

- **The gaps are not scaled.** Twelve pixels of air is twelve pixels of air
  at any size. Taking the ratio over a total that included them leaves every
  row a few pixels too wide, and the last widget wraps off the end of it —
  losing the whole arrangement for the sake of half a pixel each.
- **The tightest row decides**, not the widest. A row of five has four gaps
  to pay for and a row of one has none.
- **Widths are floored, never rounded up**, when scaling. A row is a sum, and
  three widths each rounded up is a row two pixels too wide.

Below about 560px — or when scaling would take the page under 55% — it
stacks instead. Three widgets across 360 pixels is three widgets nobody can
read, which is worse than three screens of one widget each. Stacked, a widget
that is now *wider* than it was does **not** grow taller: its height was a
decision, not a ratio waiting to be scaled up.

While arranging, the pill shows **what is drawn**, not what was typed, with a
`78%` or `stacked` chip when this screen isn't the one the page was arranged
for. The **W** and **H** boxes still hold the design numbers, and the dotted
"what fits here" boxes report in those same design numbers — the point of
that label is that it tells you what to type, and a number you can't type is
worse than no number.

#### The empty space tells you what fits in it

Wherever there is room left over, **Arrange** mode draws a dotted box in it
labelled with its exact size — `428 × 94`. "There is room" was never the
question anybody had while arranging a page; *"there is room for 428 by 94"*
is, because it is the number you are about to type into a **W** box. A gap
too small for a widget isn't drawn, because a strip of nothing is not
somewhere to put something.

That's both kinds of room: the space **at the end of a row**, and the space
**under a widget shorter than the one beside it**.

#### A short widget doesn't waste the space below it

A row is as tall as its tallest widget, so a short one beside a tall one
leaves a rectangle underneath. If a later widget fits in that rectangle, it
goes there instead of starting a new row.

It's only tried **once the row is actually full**, so reading order still
runs left to right — nothing jumps into a hole ahead of its turn while there
is still room beside it. A widget too tall or too wide for the gap goes to
the next row as before, rather than being squashed into a space it doesn't
fit. Several can stack under the same short widget if they each fit.

#### Page controls are part of the design too

Every control on the filter bar gets its own small handle in Arrange mode,
with the same three numbers a widget has: **#** for its order, **W** for its
width in pixels, and one switch for whether it sits on the bar or behind
**More**. A control is part of a page's design in exactly the way a widget
is, and there was no reason for it to be the one thing an admin had to leave
the page to adjust.

#### Rename, duplicate, remove

Also on a widget's pill:

| | |
|---|---|
| **✏️ Rename** | The title, in place. |
| **⧉ Duplicate** | A copy, immediately after the original. The commonest thing anybody wants after building a chart is the same chart broken down another way, and rebuilding it from scratch in the admin panel is the slowest possible route to that. |
| **🗑 Remove** | Takes it off the page. Confirmed first — it is the one action here that loses work somebody did in the admin panel. |

All three are admin-only, all three write to the page, and all three go
through one function, so there is one place where "am I allowed to do this?"
is answered.

#### Restyle one widget, on the widget

The 🖌 on a widget's pill opens its own look: theme, surface, accent, border
and text colour, radius, padding, border width, shadow. Every field has an
**auto** that hands it back to the page, and one button puts the whole widget
back to the page's look.

Both panels — the size boxes and the paint panel — are drawn **above every
widget on the page**, wherever on the page they were opened. They used to be
children of the card they belonged to, which meant they were painted *under*
every widget that came after them: each card has its own entrance animation,
and a CSS transform creates a stacking context no z-index can climb out of.
They now escape to the top level and are anchored to the handle that opened
them, flipping above it when there is no room below and staying inside the
window sideways. Click away or press `Esc` to close.

Everything on this page — the design, the order, every widget's size and
look — is written to the **page** and saved by **admins only**, and the
Firestore rules say so independently of the missing button.

### Sizing a widget on the page

An admin on the dashboard itself gets **⇅ Arrange**, and every widget grows a
small pill in its corner reading its position and its real size — `3 412×583`.
That is the thing you want most while arranging, so it's readable without
opening anything, and it covers nothing: the old always-open toolbar sat
across the title of every short widget.

Click the pill to edit: **#** for position, **W** and **H** in pixels, and an
**×** to go back to automatic.

A number is **committed once, not as you type it**. It saves when you leave
the box, when you press Enter, or after a short pause; Escape puts back what
was saved. Typing `412` used to save `4`, then `41`, then `412` — three
writes, three full re-layouts, and a widget that really was four pixels wide
on the way there, which is what made resizing flash blank. A value below a
usable floor is raised to it rather than drawn.

The W and H boxes show **the size the widget currently is**, greyed, so you
adjust from a real number instead of typing into an empty box and guessing.
It's a placeholder rather than a value: the widget isn't pinned until you
type, and clearing the box still means *auto*. The number comes from the same
measurement the layout used, so it's what the widget actually is on screen
rather than a second opinion about it.

Size belongs to the **page**, not to the reader. A canvas where one widget is
640px for one person and 300px for another is not a canvas anybody designed,
so W and H save to the page document and everyone sees them. Order stays
personal — see below.

Both pixel numbers stay **responsive**, because a hard pixel size is a
promise a phone cannot keep:

- A **width** claims a whole number of the 12 grid columns, rounded up, so it
  re-flows at every breakpoint exactly as a named width does — and it is
  clamped to the space **remaining from where the widget sits**, not to the
  canvas as a whole, so a wide widget in the seventh column can't spill off
  the right-hand edge into somewhere nobody can scroll to. It is also never
  drawn wider than the columns it claimed, because that room belongs to the
  widget beside it.
- A **height** is drawn exactly as typed, published as a CSS custom property
  so a media query can cap it on a phone — where a widget taller than the
  device is a trap rather than a layout — and floored at 60px so a mistyped
  `2` doesn't produce a widget two pixels tall. The **card stretches to fill
  it** and anything too tall scrolls inside the card, so the widget changes
  rather than the space around it. It beats a height the widget sets for
  itself (a leaderboard is 480px by default) — your number is the more
  specific instruction. Blank clears the pin and lets the masonry size the
  widget from its content, which is what most widgets want.

The **content fills the size too** — a chart, a trend, a stacked chart, a
pie and a flow canvas all stretch to the height you set instead of keeping
their own default and leaving the rest of the card empty. A table or a pivot
scrolls inside it instead, which is what a fixed height means for a list.

#### Why a pinned widget can leave a hole beside it — and the `+n` that closes it

The canvas is twelve columns. A widget pinned to **260px** on a canvas whose
columns are 95px claims **three** of them — 305px — and the 45px left over is
dead space: too narrow to hold anything, and nothing can be placed there
anyway. Three KPIs in a row each doing that is why a gap opens beside them
that no other widget ever fills, and it's invisible unless you know the model.

So it's shown. A pill reading `1 260×94 **+45**` is saying *this widget claims
45px it doesn't use*, and the **⤢** inside widens it to exactly its span so
the gap closes. Nothing is snapped behind your back — the number you typed is
the number that's drawn — but the cost of that number is now on screen instead
of hiding in the layout.

A few pixels of overhang no longer cost a whole column either. A widget three
pixels past a boundary used to claim the next one outright: a ~100px dead
strip, permanently unfillable, bought with three pixels nobody can see. Within
a 10px tolerance it's drawn a hair narrower instead, which is by far the
smaller lie.

Only admins see the button, and the Firestore rules say the same thing
independently — so the missing button is a convenience, not the security.

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
preference about their own eyes, so it still comes first.

**Arranging is now an admin's tool.** A reader with a saved order keeps it,
but the ⇅ button is admin-only, so the way somebody gets a layout that suits
their job is for an admin to give them one. In **Admin → Users**, beside
*Copy permissions from…*, there is **Copy widget layout from…** — it takes
one user's ordering and gives it to another across every page, and touches
nothing else. Copying the whole permission set to achieve that would hand
over page access nobody asked to change. Nothing here decides
what a user may *see*; that's `hiddenWidgets`, enforced separately and not
reachable from the dashboard.

Lower numbers come first; blank means "leave it where it is", so numbering one
table moves just that table and doesn't reshuffle everything else. A user's
own order is stored per user, per page, so it follows them between devices.

### A long form is a row of buttons

A widget has a setup, its own controls, a blend, a look and a couple of
behaviours. Stacked open, that is a form nobody can see the end of, and
finding the one you came for means scrolling past four you didn't.

So they're buttons: **Setup · Controls · Blend · Look · Behaviour**, one line,
one panel at a time. The same treatment in two more places that had the same
problem:

| Where | Buttons |
|---|---|
| **A widget** | Setup · Controls · Blend · Look · Behaviour |
| **A data source** | Connection · Tabs · Calculated |
| **A page's settings** | Basics · Placement · Look · Background · Spreadsheets |

The catch with hiding things behind buttons is that a setting nobody can see
is a setting nobody remembers making. So **a section holding something
carries a mark** — a count where a count means something (`Controls 3`,
`Tabs 12`), a dot where it doesn't (a blend is on or off; a look is custom or
stock). The row therefore says what is *configured* as well as what exists,
which the stack of open sections never did.

A count of **zero is not a mark**: zero is a real answer and it is "none", and
a mark that is always there tells you nothing.

Three things are deliberately *not* in any section, because they belong to all
of them:

- **Save** — an admin who has just changed a tab must not have to find their
  way back to a particular strip to save it.
- **A failed load's message**, and
- **the warning that widgets are pointing at a spreadsheet nobody selects any
  more**. Those are things that are *wrong*, and hiding a wrong thing behind a
  button is how it stays wrong.

Two small conveniences: a **data source opens at the section there's a reason
to open** — Tabs if it is connected, Connection if it isn't, because nobody
opens a working source to re-paste a link they set up months ago. And a
**blend button only appears on widgets that can blend**.

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

### How far a control reaches

Because a page shows tabs with completely different columns — now from
different spreadsheets — a control that applied to everything by default would
empty every unrelated table. So each one says how far it travels:

| Reach | What it narrows |
|---|---|
| **Only its own tab and the ones listed** | The default, and what every control did before. A `DSE Name` dropdown built on MASTER filters the MASTER widgets and leaves GOOGLE REVIEW alone. |
| **Every tab with a column of this name** | No links to maintain — and a tab added next month is covered the day it arrives. |
| **The whole page — by column, else by key** | Everything above, *plus* the tabs that have no such column, narrowed by a shared key instead. |

That last one is what makes "show me the page as it looks for Ravi" true
rather than nearly true. GOOGLE REVIEW has no `DSE Name` column, so nothing
about a DSE can be asked of it directly — but it has a `VIN`, and the VINs
Ravi sold are knowable. Give the control a **key column** and the tabs it
couldn't reach by name follow the ones it could.

Three details that stop it lying to you:

- The keys are read from the source tab **after every other control has
  run**, so a second filter narrows the bridged tabs too. Filter to Ravi *and*
  model B, and the review of a vehicle that dropped out goes with it.
- A tab that already matched **by column is never also intersected with the
  keys**. A quotation for a vehicle MASTER has never heard of still belongs in
  a "DSE = Ravi" view, and would silently vanish otherwise.
- A tab sharing neither the column nor the key is still **left completely
  alone** — silence, not an empty table. That rule never bends.

Where the key is called different things on different tabs (`VIN` here,
`Chassis No` there), map it once per tab. And the admin panel shows a
**coverage strip** under every control — one chip per tab on the page, saying
*its own tab* / *same column* / *bound column* / *by key* / *not narrowed* —
computed by the filter engine itself, so what you are shown while editing
cannot drift from what the dashboard will do.

Buttons narrow only the tabs their conditions name. The **global search box**
is the other exception — it matches any cell on any tab.

### Calculated columns

A column your sheet doesn't have: **margin**, **age in days**, **share of the
branch**, a status worked out from three other fields. Adding it to the
spreadsheet means asking whoever owns the spreadsheet; adding it to one widget
means adding it again to the next eleven.

So it's defined **once, on the tab**, in **Admin → Data sources**. From that
moment it is simply one of that tab's columns — it appears in every picker,
filters like a column, groups like a column, buckets like a column, charts like
a column, drills like a column, and travels into a **blend** like a column.
Nothing downstream knows it was calculated, which is exactly why a calculated
column on a parent table can be used in a widget that blends it with another
one, with no further setup.

The order is deliberate: **calculate → scope → filter.** A filter can't mention
a column that doesn't exist yet, and a per-user row scope has to be able to
hide rows *by* one.

#### Writing one

It reads like a spreadsheet, because everyone using this has spent years in
one:

```
[Sale Price] - [Cost]
ROUND(([Sale] - [Cost]) / [Sale] * 100, 1)
IF([Status] = "Delivered", "Done", "Pending")
IFS([Sale] > 100000, "Large", [Sale] > 25000, "Medium", "Small")
DAYSSINCE([Invoice Date])
[Branch] & " · " & [Model]
ROUND(SHAREOF([Amount], [Branch]), 1)
```

`[Column Name]` is a column — brackets are what let a column be called *Sale
Price (ex GST)*. A bare word works too, so `Sale - Cost` is a valid formula.
`&` joins text. `=` compares **without caring about capitals or spaces**,
because `[Status] = "delivered"` failing on `Delivered` is not a subtlety
anybody wants to debug.

| Group | What's there |
|---|---|
| Logic | `IF` `IFS` `AND` `OR` `NOT` `ISBLANK` `ISNUMBER` `COALESCE` |
| Numbers | `ROUND` `FLOOR` `CEILING` `ABS` `MIN` `MAX` `NUMBER` `DIVIDE` |
| Text | `CONCAT` `UPPER` `LOWER` `TRIM` `LEN` `LEFT` `RIGHT` `CONTAINS` `STARTSWITH` `ENDSWITH` `REPLACE` `SPLITPART` |
| Dates | `TODAY` `DAYSSINCE` `DAYSBETWEEN` `YEAR` `MONTH` `DAY` `MONTHNAME` `WEEKDAY` `ADDDAYS` |
| Whole table | `TOTAL` `AVERAGE` `MAXOF` `MINOF` `COUNTROWS` `PERCENTOF` `RANK` |
| Within a group | `TOTALBY` `AVERAGEBY` `COUNTBY` `SHAREOF` `RANKBY` |

The last two groups are the advanced ones, and they're the reason this is more
than arithmetic. `PERCENTOF([Amount])` is this row's share of the whole tab.
`RANK([Amount])` is its place in the table — **dense**, so two rows on the same
number share a rank and the next distinct number is the one after it, and "rank
3 of 40" always means something. `SHAREOF([Amount], [Branch])` is its share of
its *own branch*, and `RANKBY([Amount], [Branch])` its place *within* it. Each
is measured once over the whole tab, not once per row, so a forty-thousand-row
sheet doesn't pay for it forty thousand times.

**One column can be built from another.** `Margin` from `[Sale] - [Cost]`, then
`Margin %` from `[Margin] / [Sale]` — which is what keeps a complicated
calculation readable instead of one enormous formula. They're sorted by what
they depend on, and two that need each other are reported rather than looped
over.

#### Three things that make it usable

- **Recipes.** Nine formulas out of ten are one of eight shapes — a difference,
  a percentage, an age, a banding, a join, a share of the total, a share of the
  group, a yes/no rule. One click each, pre-written with this tab's own column
  names, then editable.
- **The columns are right there.** Click one to insert it, correctly bracketed,
  instead of typing a name from memory and mistyping the space in it.
- **It shows the answer,** against real rows pulled by the last **Sync data** —
  through the same code the dashboard uses, because a second implementation
  would eventually disagree and the disagreement would be found by whoever
  trusted the wrong one. Whole-table functions in the preview are measured over
  the sample rows only, and it says so rather than implying a number it can't
  know yet.

#### What it won't do

A formula that can't be read **doesn't become a column** — you get the reason
in a sentence (`No column called "Amont" on this tab`, `ROUND() takes 1 to 2
arguments`), and every other column on the tab still works. A formula that
reads but can't be worked out for one row leaves that cell blank rather than
writing `#VALUE!` down the column.

A calculated column is **read-only**. Inline edit writes a cell back to Google
by column name, and a calculated column has no cell there — so it's excluded
from the editable list by construction, not by a check somebody could forget.
It also can't take the name of a real column, so nothing is ever quietly
replaced.

Formulas are parsed, not `eval`'d: an admin's string never becomes JavaScript,
which matters both for what a formula could otherwise reach and for what
running one forty thousand times would cost.

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
| **Fill-in rules** | Swap in another column wherever a value is missing — or fails any check. |

### Fill-in rules

**Worth setting.** A blended cell ends up empty two ways — the key matched
nothing, or it matched a row whose cell is blank — and they look identical on
screen. Either way a chart grouped by that column **skips blanks**, so those
rows quietly disappear and the totals stop adding up. Five vehicles in stock,
four bars, no explanation.

Empty is only the most common hole, though. A `TBD`, a zero standing in for
"unknown", a lead time past 90 days — all are values you'd rather replace.
So a rule is a condition, not a blank test:

```
if    Yard · Location   is empty        show  Stock · Default Yard  or  "Not allocated"
if    Yard · Location   is exactly TBD  show  Stock · Default Yard  or  "Not allocated"
if    Yard · Days       > 90            show  —                     or  "Over 90 days"
```

The operator list is the same one the condition buttons use — `is empty`,
`is not empty`, `contains`, `is exactly`, `is one of`, `>` `≥` `<` `≤`,
`between`, the date operators, `within last N days` — one vocabulary, one
evaluator, nothing new to learn. Dates are read in the source's own
day-first or month-first order, exactly as everywhere else.

Both column boxes list **every column, from either tab**, plus what the blend
itself adds (the match count and any roll-ups). The picker names the tab
beside each column, because both tabs having a `Status` is normal and the
side is what tells them apart. That means a rule can run either direction:
fill a hole in the blended column from your own tab, or fill a hole in **your
own** column from the blended tab. The backup is read off the matched rows,
so it works whether or not that column was brought across.

Order of preference: the backup column, then the text. A rule only fires
where its check holds, so a value you're happy with is never touched, and the
match-count column still tells the truth — a fill-in changes the display, it
doesn't pretend a match happened. When several rows match, a backup from the
blended tab is collapsed the same way the value it replaces would have been,
so *last match* means one thing.

Every rule reads the row **as the join left it**, so rules can't chain off one
another and the order you add them in never changes the answer.

Two cases where a rule appears not to work, both of them the row already being
past saving:

- A backup from the **blended tab** is empty for a row that matched nothing —
  there is no matched row to read any column from. That falls through to the
  text, which is where a caption like "Not allocated" earns its place.
- **"Only matching rows"** drops unmatched rows before any of this runs. A
  matched-but-blank cell still gets filled; a row with no match at all is
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

### The Flow widget — depth on demand

Every other widget answers one question at one depth. A KPI says 1,284. A
chart says 1,284 split by Model. Neither says:

> 1,284 in stock — of which 812 are SPLENDOR, of which 190 are unallocated,
> of which 40 have an open job on the **service** tab.

That sentence is the shape of most real questions, and it's what a flow is
for. It starts as one number and a few branches; every click adds a level.
Nothing below the top is computed until you open it, so depth costs what you
actually look at rather than what the page was configured with.

**Everything below a branch is a subset of it**, so the arithmetic reconciles
all the way down. That is the property that makes a drill path trustworthy,
and it's enforced in the small places too: the tail beyond *show top N* rolls
into **Other** rather than being dropped, and blanks get a branch of their own
instead of vanishing the way a chart silently drops them.

#### The six ways to go one level deeper

An admin describes a **path**, not a picture: each level says how to turn a
branch into its children, and it applies at every branch. A handful of levels
describes a tree of any width.

| Level | What it does |
|---|---|
| **Break down by a column** | One child per value, biggest first, top N with an "Other" roll-up and a "(blank)" branch. Optionally **viewers can change the column**, which is the single most useful control here — the interesting split is rarely the one anyone predicted. |
| **Branch on conditions** | Admin-written branches, each a label + colour + any number of column conditions (the same operator list as buttons). *First matching branch wins* by default, so the level reads as a decision tree and still adds up. |
| **Show numbers about it** | Branches that are *numbers* rather than subsets — count here, sum of Amount there, count of the financed ones. Each keeps the branch's rows (narrowed by its own conditions if it has any), so a number can still be opened and drilled. This is how a flow stops being a census and becomes a scorecard at any depth. |
| **Break down by a list on another tab** | Branches come from a **reference tab** — a model catalogue, a staff list — matched against a column here. |
| **Follow a key into another tab** | The branch becomes the rows of a second tab whose key appears in the rows above it. "812 vehicles" becomes "1,940 service jobs", and every level below reads the new tab's columns. |
| **Bring in other tabs** | One branch per tab, related to the branch above by *nothing at all*. For a flow that is a map of several tables rather than the decomposition of one. |

A single branch can be marked **stop here**, which ends the flow for that
branch alone. That's what gives a flowchart its asymmetry: lost deals rarely
need breaking down five more ways.

#### A flow is not "a widget for one table"

The flow picks its own **starting table** — it needn't be the widget's — and
three of the six levels above change tables. Only *follow a key* claims a
relationship. *Break down by a list* borrows a list. *Bring in other tabs*
claims nothing, and says so.

Two of those earn their place by doing something no amount of grouping can:

- **A value with zero rows.** A model nobody sold this month does not exist in
  the sales data, so grouping that data will never reveal it — and "nobody
  sold any" is usually the thing somebody needed to see. Read the branches
  from a catalogue tab instead and the gap is visible. Rows whose value isn't
  on the list get a *"not on the list"* branch, so the level still adds up and
  a typo is visible from both directions.
- **An honest non-relationship.** An independent branch shows **no share and
  no drop-off**. Two service jobs is not "50% of four sales" — it isn't part
  of them at all, and a percentage would be an invention. It's labelled *own
  total*, and everything opened underneath it does have shares again, because
  those genuinely are its subsets.

Any level can also **measure differently** from the one above it — rows at the
top, rupees underneath, inherited by everything below. Where two branches
report different kinds of number, the percentage between them falls back to
counting rows, which always reconciles. A sum of Amount is not a share of a
row count, and the flow will not pretend otherwise.

#### Reading one

- The **tint behind each row** is that branch's share of its parent, so a
  glance down a branch answers "how much of that survived to here".
- **▼37%** is what was lost at that step — the funnel read, at every level,
  not just the top.
- **Extra numbers** (added by the admin) appear on a branch once it's open:
  "how many, and worth how much", without leaving the tree.
- Percentages can be measured against the parent (conversion at each step) or
  against the starting number (share of the whole).

Three affordances per row: **click to open**, the **funnel** to filter the
whole page to that branch, the **zoom** to make it the temporary top of the
tree — with a breadcrumb back out. Expand-all stops at a branch limit rather
than locking the tab.

#### Two views of the same tree

A **Tree / Diagram** switch sits in the widget's header; the admin picks
which one a page opens on, and the reader can change it.

- **Tree** — the indented list. Answers "what is under this", survives a
  phone, and stays readable at any breadth.
- **Diagram** — the same nodes as cards on a pannable canvas, laid out as a
  tidy tree: every parent centred over its children, top-to-bottom or
  left-to-right. Drag to pan, zoom in/out, **fit to view**. It auto-frames
  itself as you open branches, and stops doing that the moment you pan or
  zoom yourself — after that, Fit is one click away.

The diagram exists for the one thing indentation cannot show: **shape**. The
edge between two nodes is drawn as thick as the share flowing along it and
carries that branch's number, so a fat line splitting into three hairlines is
visible before you have read anything. Nodes are placed by the data — there
is nothing to drag into position, and nothing to tidy up, so two people
looking at the same page always see the same picture.

Everything the canvas can do:

| | |
|---|---|
| **Find a branch** | A search box, top-left. Matches a node by its own name **or by the path that led to it** — searching *Pune* finds *Pune → Splendor → Financed*, because on a drill tree where a node sits is most of what it means. It counts the hits, and ▲ ▼ (or `Enter` / `shift+Enter`) walk between them, **centring each one** — a hit you can't see isn't a search result. |
| **Peek inside a branch** | Hover any node and a **magnified square window** opens beside it — at full size whatever the canvas is zoomed to — listing everything directly underneath. It **scrolls**, so a branch with forty children is all there rather than the six that fitted on the card. **Click a row to move the window into that branch**, with a back arrow to walk out again: a whole path can be read without touching the canvas, the zoom, or what's open. Filter the page or open the branch on the canvas from its footer; `Esc` closes. |
| **Magnifier** | **Hold ctrl** and a round glass follows the cursor, the way you'd hold one over a newspaper — let go and it's gone. The 🔎 button pins it out for when both hands are needed. Zoomed out far enough to see the shape of a whole flow, the labels are too small to read — this reads them without giving up the shape. 1.75×, 2.5× or 4× on top of whatever the canvas is already at. It never takes the pointer: hovering, clicking and dragging go straight through to the diagram underneath, and it lifts off the toolbar so it never magnifies the button you are reaching for. |
| **Follow one path** | Hover any node and its whole lineage lights up — up to the root, down through everything it became — while the rest of the canvas goes quiet. Tracing one path through a wide fan is otherwise squinting. |
| **Know where you are** | A **minimap** in the corner shows the whole canvas with a rectangle around the part you're looking at. Click it to jump. Zoomed into level three of a five-level tree, this is the difference between navigating and wandering. |
| **Ask about one node** | Click its ⓘ. A panel gives the full path, the value, the rows, the share, the drop-off and every metric — with *Open*, *Zoom in*, *Centre* and *Filter page* on it. A 178px card can't hold that, and shrinking the type until it does helps nobody. |
| **Full screen** | The whole widget, not just the picture — the view switch, breadcrumb and breakdown pickers come with it, because a diagram you cannot steer is a poster. There's a button on the canvas too, since the canvas is where you run out of room. `F` toggles, `Esc` leaves. |
| **Pan** | Drag anywhere that isn't a card, or use the **arrow keys**. |
| **Zoom** | The `+` / `−` buttons, or **⌘/ctrl + scroll** anchored under the cursor — in full screen a plain scroll does it, since there is nothing behind to scroll past. Zooming is always about a *point*, so what you aimed at stays where you aimed. |
| **Fit** | Frames everything. It re-frames itself as you open branches, and stops the moment you pan or zoom yourself. |
| **100%** | The percentage readout is a button back to actual size. It used to be a second Fit button, which meant that once Fit had shrunk a big diagram there was no way back to reading it at full size. |
| **Edge labels** | The number on each line can be turned off, for when the shape is what you're reading and forty pills are in the way. |
| **Undo / redo** | **Ctrl+Z** and **Ctrl+Y** (or Ctrl+Shift+Z) step back and forward through everything you've done to the flow — what's open, what you zoomed into, the breakdown column, the order, the percentage base, the view. **Esc** returns it to how the page opened, and *that* is undoable too: pressing Escape by accident shouldn't be the one action you can't take back. There are buttons for all three, and they grey out when there's nothing to step to. |
| **Keyboard** | `+` `−` zoom · `0` fit · `1` actual size · `F` full screen · `/` search · arrows pan. Typing in a text box never steals the keystroke. |
| **Zoom into a branch** | Double-click it, or use its ⤢ — it becomes the temporary top, with a **breadcrumb back out that now shows in both views** (it used to live only in the tree, so zooming in on the diagram left you with no visible way back). |

#### Reading controls — the three questions a reader keeps re-asking

Above both views, and changing not one number:

- **Order** — *As built* (the admin's), *Biggest first*, *Smallest first*,
  *A → Z*, or **Worst drop-off first**, which is the order you want when
  you're hunting a leak. Roll-up buckets (*Other*, *(blank)*) stay **last**
  however it's sorted: a big Other at the top of a list reads as the answer,
  and it's a footnote.
- **Hide under n%** — drops branches below a share of their parent. A split
  that fans out forty ways where thirty-four are under one percent is
  unreadable and the six that matter are the whole point. **What it hides is
  counted on screen** — `· 34 hidden (218)` — because a diagram that silently
  loses rows is a diagram that lies.
- **% of its parent / % of the total** — the percentage base, which used to
  be an admin-only setting. Reading down a branch you want *how much of that
  survived to here*; comparing two branches you want their share of
  everything. Neither is the right default for both.

And one thing found for you: the **worst drop-off** in the whole canvas, as a
chip. On two hundred nodes across four levels, hunting that by eye is exactly
the work a computer should have done first. Click it to zoom straight there.

#### Several trees on one canvas

A flow widget holds a **list of trees**, not one. Each has its own table, its
own starting number, its own conditions and its own levels; they share the
canvas, the zoom and the set of open branches, and nothing else.

Three related questions belong in one picture — sales, service, reviews —
and three separate widgets cannot share a canvas or a reader's attention.
Two separately-scrolling boxes make comparison impossible: you can never get
both at the same size on the same screen at the same time. So the trees sit
side by side in **one** coordinate space, each on its own faint plate.

Opening a branch in one tree leaves the others exactly as they were.

#### A tree can join a second table before it starts

A tree isn't limited to the columns its table happens to have. Give it a
**blend** — the same per-widget join every other widget can do, with the same
editor: join type, multi-match strategy, prefix, roll-ups and fill-in rules —
and it runs **once, at the root**. Every level below sees the joined columns
as if they had always been there, so a tree rooted in MASTER can branch on a
column that only exists in Quotations.

One consequence is handled for you: a blended column exists on *neither*
tab under that name, so no condition built from it could describe anything to
the rest of the page. Every branch of a blended tree therefore drills **by the
key the blend joined on** — which reaches not only both blended tabs but every
other tab carrying that key, exactly as a blended chart's drill does.

#### What a click filters

Whatever the branch actually means, expressed in the most portable form
available:

- **A readable condition** whenever the chain from the top is still a plain
  AND — it reads well as a chip, and because it's a description rather than a
  snapshot, removing some other filter widens it again instead of leaving it
  stuck.
- **By key, once the flow has hopped tabs.** This is the same mechanism a
  blended drill uses, so the drill reaches every tab carrying that key — the
  whole page follows the flow across the spreadsheet boundary. The branch's
  own conditions travel with the keys, so on its own tab it stays exact:
  clicking "PDI" filters the service table to PDI jobs, while the stock and
  feedback tabs narrow to the vehicles those jobs belong to.
- **By sheet row** for the branches no flat AND can describe — an ANY branch,
  or a later branch of an exclusive level, whose real meaning includes "and
  none of the branches above". Exact, and scoped to its own tab, since a row
  number means nothing anywhere else.

Clicking a second branch of the same flow **replaces** the first rather than
stacking two contradictory filters.

### Widget types

| Type | What it does |
|---|---|
| **KPI Card** | One number from a tab + column + calculation. Counts up on change; with filters active it shows the unfiltered total underneath. Can express a conversion between two tabs. Its mark can be an emoji **or an image URL**. |
| **Workflow Pipeline** | A funnel of stages, each a label + colour + its own condition set, with optional trend line and a pop-up of KPIs, a pivot and a leaderboard. Click a stage, a KPI, a leaderboard row or a pivot cell to drill in. |
| **Flow (drill-down tree)** | One or more trees on a shared canvas. Each opens level by level — by column, by conditions, into named numbers, by a list on a reference tab, across a **key into another tab**, or into other tabs outright — and each can blend a second table into its rows first. Full screen, pan and zoom. See below. |
| **Filter Panel** | The page's filters as a column of labelled button groups, on the canvas — the right-hand panel of a classic report. |
| **Leaderboard** | Ranks any column by any metrics you define. Click a row to drill in. |
| **Data Table** | Sortable, reorderable, searchable grid with optional inline editing, row detail panel and per-row download actions. |
| **Chart** | One data shape, **21 styles** — bar, horizontal bar, lollipop, **arrow bars** (up or across), **cylinder bars**, **nested circles**, line, step, area, waterfall, pareto, histogram, pie, donut, rose, radar, radial, treemap, funnel, progress list. Plus colour rules, reference lines and axis scaling. Every style is clickable to drill in. |
| **Stacked / Grouped Bars** | Bars by one column, split by a second. Stacked or side-by-side. Overflow segments merge into "Other" so totals stay honest. |
| **Combo Chart** | Bars and a line on **two independent axes** — volume against rate, which one axis would flatten. |
| **Scatter / Bubble** | Two numeric columns plotted against each other, optionally sized by a third and coloured by a fourth. The one widget that shows individual rows, so outliers survive. |
| **Heat Map** | The pivot's cross-tabulation as colour intensity, with five ramps. Click a cell to filter to that row × column. |
| **Trend Over Time** | Two kinds of time axis — along a timeline (day → year) or **folded onto one cycle** (Jan–Dec, Mon–Sun, Q1–Q4…). **Split into series** by any second column, and if that column holds dates, bucket it too — which is how you get one line per year. Running totals, a moving-average line, value labels, and a legend you can switch series off in. |
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
- **On the page** — three states, not two:
  - *On the page* — anyone can change it. The normal case.
  - **Fixed — always applied, never shown.** The page's own rule. See below.
  - *Parked* — not shown and not applied; switched off without deleting it.
- **Default value** (or *On by default* for a button) — the page opens with it
  applied. **Reset** returns to *these* defaults, not to blank: a control the
  admin meant to be on shouldn't be switched off by a reset.
- **Also show** — extra columns joined into the control's values. "Ravi" is
  ambiguous when two branches have a Ravi; **"West · Ravi"** is not, and it's
  one control rather than two the reader has to set in the right order. Only
  the combinations that **actually occur** are listed — three regions and
  forty names is a hundred and twenty options, most of which don't exist. A
  blank part shows as *(blank)* rather than collapsing, so two genuinely
  different rows never merge into one option. The separator is yours.
- **Narrow its values to what the page shows** — on by default. A Region of
  *West* leaves the DSE list showing only DSEs who sell in the west; without
  it, every other name is a trap that empties the dashboard with nothing to
  explain why. Two rules keep it from becoming a dead end: a control never
  narrows **its own** list (or picking *West* would leave *West* as the only
  region on offer), and a **currently selected value always stays listed**
  even once nothing matches it — otherwise it vanishes while still filtering,
  and there is no way to undo what emptied the page. Switch it off for a list
  that is a *reference* — every branch you have, whether or not it sold
  anything — where shrinking hides the zeroes that matter.
- **Max chips** — `0`, the default, shows **every value**. Chips used to cap
  themselves at twelve and say nothing about the rest; now a cap is something
  an admin chooses, and a capped list says `+N more` rather than pretending
  those values don't exist. Uncapped, the chip row scrolls instead of pushing
  the rest of the bar off the page.
- **Bucket by** — group a control's values instead of listing every one.
  Four hundred dates, or nine hundred amounts, or a column of four hundred
  names are all the same problem: too many distinct values to choose between.

  | Column | Buckets |
  |---|---|
  | **Dates** | Year (2026), Quarter (2026 Q1), Month (Mar 2026), Month name (March), Day of week (Monday) |
  | **Numbers** | Bands of a fixed size (`0 – 100`, `100 – 200`…), your own breakpoints (`< 0`, `0 – 100`, `250+`), negative / zero / positive |
  | **Text** | First letter (A, B, C… with everything non-alphabetic under `#`), first word, first *N* characters |
  | **Anything** | Filled or blank |

  Options come out in **their own order** — "April" before "August" is
  alphabetical nonsense, `1,000 – 1,100` before `200 – 300` is worse. Bands
  are **half open**, so `100 – 200` holds 100 up to but not including 200 and
  nothing can fall in two of them. A value the rule doesn't fit — a malformed
  date, an `n/a` in a column of amounts — **keeps its own text and sorts
  last**: it's a data-quality finding, and swallowing it would hide exactly
  the rows somebody needs to fix. It's still selectable, so you can filter
  *to* the broken ones.

  Available on page controls, the filter panel and a widget's own controls,
  all matching on the bucket rather than the cell.
- **How far this reaches** — its own tab, every tab sharing the column name,
  or the whole page via a key. See *How far a control reaches* above.
- **Bind a specific tab to a differently-named column** — one control driving
  `Owner` on one tab and `DSE Name` on another.

Sliders read their bounds from the column's real values unless you pin them,
so they stay correct as the sheet grows. Each reuses a value shape the engine
already understood (`{from,to}` for ranges, a bare number for thresholds and
day counts), and the page bar and the per-widget bar share one set of slider
components — two implementations would drift apart the first time one got a
fix.

### Fixed filters — a page's own rules

Some filtering isn't a choice anyone should be making. *This page is the Pune
branch.* *This page never shows cancelled orders.* Set any control's **On the
page** to **Fixed** and it becomes a rule of the page instead of a control on
it:

- **Always applied**, at the value the admin set.
- **Never shown** — not in the bar, not behind *More*, nowhere.
- **Not resettable.** Reset returns the page to how the admin designed it,
  and how it was designed includes its rules.
- **Not part of a saved view.** A view can neither carry a rule nor drop one
  by being saved at the wrong moment.
- **Only an admin can change it**, in the admin panel, where it carries a
  `fixed` badge so a page's rules are findable at a glance.

This isn't a default value on a hidden control. A default can be changed, and
a Reset would put it back to something the admin never meant to offer. A fixed
control's value is **forced at the moment of filtering**, over whatever else
is in play — so no saved view, no stale value from before the control was
fixed, and nothing written later can quietly override what the page says it
is.

It's the same control model as everything else, so a fixed control gets all of
it: any kind (a dropdown, a date range, a **condition button** with as many
column conditions as you like), and the full **reach** above — including *the
whole page, by key*. A fixed condition button is how you say "this page is
only ever about live, financed deals" in one place.

Two states are excluded from the count of active filters and from the *More*
badge: a rule the reader cannot see, reach or clear would otherwise send them
hunting for a control that doesn't exist.

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
sixteen widget types get them without any widget knowing controls exist.

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

### Bucketing, everywhere a column is grouped

The buckets a control offers are the same ones every **widget** offers,
because grouping four hundred dates into years is the same problem whether
it's a dropdown or a bar chart:

| Widget | What it buckets |
|---|---|
| **Chart** | Its *group rows by* column |
| **Leaderboard** | The column it ranks |
| **Stacked / Grouped Bars** | The bars and the segments, **independently** |
| **Pivot Table / Heat Map** | Each axis column **on its own** — a "Region / Sold" axis wants the region as it is and the date by month |
| **Trend** | Its axis (timeline or folded cycle) and its breakdown |
| **Flow** | Its *break down by* levels |
| **Controls** | Every list a reader picks from |
| **Pipeline** | A stage's pop-up pivot, per axis |

A control's list only joins several columns when **Join other columns into
the value** is ticked. Picking a column used to *be* the decision, which
meant there was no way to look at a joined control, decide against it and
get back — except by un-picking every column one at a time. The columns are
remembered while the switch is off, and **bucket by** applies to a single
column only.

**Clicking a bucketed bar still filters the page.** `100 – 200` is not a
value any row holds, so the drill translates the bucket back into real
conditions: a band becomes `≥ 100 AND < 200`, a year becomes a date range
(a quarter and a month work out their own last day, leap years counted
rather than assumed), *Blank* becomes `is empty`, a first letter becomes
`starts with`. Where a bucket has **no** exact form — a first word, a
three-letter prefix, `#` for "not a letter" — the drill selects those rows
by identity instead, so a click works everywhere rather than only where the
maths happens to be expressible. A test asserts the two halves agree: every
row a bar grouped is a row its drill selects.

### Long charts scroll; they don't squash

A chart of forty categories has two honest options and one dishonest one.
Honest: show the top N and say so. Honest: give every category the room it
needs and let the reader scroll. Dishonest: fit forty bars into the height of
twelve — the bars become hairlines, the axis silently drops four labels in
five, and nothing on screen tells the reader whether they're seeing
everything.

So every category gets a fixed amount of room. If they all fit, the chart
looks exactly as it did. If they don't, it grows past its frame and the frame
scrolls — **down** for horizontal bars, **across** for vertical ones — and the
scrollbar is itself the signal that there's more. Once a chart has been given
room for every bar, **every bar is labelled**: Recharts thins axis labels when
they collide, which is right inside a fixed frame and wrong once the room
exists, where a dropped label is a category nobody can name.

**The admin decides.** Each chart, stacked chart, combo and trend has a
**Scrolling** block:

| | |
|---|---|
| **Chart scrolls** | On by default. Off squeezes every category into the card however many there are — a bad default, but a legitimate choice for a wall display nobody can walk up to. |
| **Width / height per bar** | The lever that actually makes a chart scroll. A chart only outgrows its card when its categories need more room than there is, so twelve categories on a wide card will never scroll until you ask for wider bars. |
| **Legend scrolls** | On by default, with its own height. |

If a bar chart isn't scrolling, it's one of two things and the editor says
so: either there are few enough categories to fit — raise *width per bar* —
or **Max bars/slices** is hiding the rest. Set it to `0` for every category.

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

### The filter panel

The control bar along the top is right for two or three controls and wrong
for eight: it wraps into a hedge, and every value hides behind a dropdown you
have to open before you can see what's in it. A report with a dozen dimensions
wants the other arrangement, and that's the **Filter Panel** widget — a column
of labelled groups, every value a button, the selected ones lit, with
*select all* and *clear* on each group and a *clear everything* at the top.

Put it in a quarter-width column beside the charts and you have the classic
report layout.

It is a second **surface** for controls that already exist, not a second
filtering system: it reads and writes the same values the bar does. So the
same control can appear in both, a saved view still restores it, Reset still
clears it, and the reach rules still decide which tabs it narrows. Pick which
controls appear, and how many buttons per row, per panel. Only dropdown,
multi-choice and chip controls qualify — a date range drawn as a grid of
buttons is a worse date range. A **fixed** control never appears, because it's
a rule of the page rather than something anyone is meant to press.

### Themes

**Admin → Pages → Widget theme** restyles every widget on a page at once.
Each theme is a surface, a corner radius and an accent that go together —
*Report (olive)*, *Soft product*, *Glass*, *Paper*, *High contrast*,
*Midnight*, plus the plainer *Outlined / Elevated / Flat / Dark*. The accent
is what colours a filter panel's selected buttons, so the panel matches the
page it sits on.

It's a **default, not an override**: a widget you restyled by hand keeps its
own look. One page setting silently undoing a dozen individual decisions is
the kind of change nobody can find afterwards.

### Breaking a chart into series

"Sales by month" answers a question. "Sales by month, **split by model**"
answers the one everybody asks straight afterwards — and it's a different
chart, not a filtered version of the first, because a flat total can hide one
category collapsing while another takes its place.

Pick any second column as the **breakdown** on a Trend widget and you get one
series per value. Then:

| | |
|---|---|
| **How they're drawn** | Lines (compare shapes), stacked areas (total *and* mix), 100% stacked (mix only), stacked bars, or grouped bars. |
| **Colours** | Pin a colour to a value — red for *Cancelled*, green for *Delivered* — and it keeps it whatever the data does. Matched ignoring case and spaces. Everything unpinned cycles a palette you choose (Standard / Cool / Warm / Earth / One hue). Same controls on **Stacked / Grouped Bars**. |
| **Too many series** | The tail is grouped into **"Other"**, never dropped, so the stack still adds up — with a caption naming what went in. Series are ranked by their total across the *whole window*, so a one-off spike in March can't evict something that's steadily second all year. |
| **The legend is a control** | Click a series to switch it off, hover to bring it forward. It's a question ("what does this look like without X"), not a filter — nothing else on the page moves, and the last visible series can't be switched off. |
| **Running total** | Answers "how are we doing against the year" without making anyone add up twelve bars. |
| **Moving average** | A dashed overlay, **trailing** so the newest period is always drawable, and it waits for a full window rather than drawing an "average" of one point. Shown when a single series is visible — six smoothed lines on top of six real ones is not a chart. |
| **Tooltip** | Every series in that period, biggest first, with the total. Recharts' own lists them in declaration order, which on a stack is bottom-to-top and on six series is a scavenger hunt. |

A blank value becomes its own **"(blank)"** series rather than quietly
dropping out of a total that claims to be complete — the same rule the flow
and the pie follow.

#### Two kinds of time axis

A **timeline** axis runs Jan 25, Feb 25, Mar 25 — one bucket per period that
actually happened. It answers *what happened*.

A **cycle** axis runs January…December, or Monday…Sunday, folding every year
onto the same twelve slots. It answers *when in the year does this happen* —
and paired with a breakdown by year, it answers the question every seasonal
business actually asks: **how does this November compare with the last three?**

Cycles available: month of year, quarter of year, day of week (Monday first,
so the weekend stays together), day of month, week of year. Every slot exists
whether or not the data does — a March with no sales is the finding, and a
chart that omits March hides it.

**A date column makes a poor breakdown raw** — every row becomes its own
series and the legend has four hundred entries. So a breakdown can be bucketed
too: by year, quarter, month, month name or day of week. That's the whole
trick behind the year-on-year chart, and there's a **one-click preset** in the
editor that sets all six settings at once.

Two details:

- **Series order** can follow size (default) or name — ascending or
  descending — so a year breakdown reads 2026, 2025, 2024 rather than by
  volume. Which series are *kept* is always decided by size; only the drawing
  order follows the sort, because dropping the biggest series for sorting last
  alphabetically would be indefensible.
- **Clicking a folded bucket still filters.** "March" is three Marches from
  three different years and no date range covers it — so it drills by sheet
  row instead: exact, and scoped to its own tab, since a row number means
  nothing anywhere else.

### Pie, donut and rose — built for real data

A pie of 120 categories is not a hard chart to read, it is an unreadable one:
the labels overlap into a grey smear, the slices under ~2% are thinner than
their own outline, and the palette has long since started repeating.

The usual fix — keep the top 12 — is **worse**, because it is wrong rather
than merely ugly. Keep 12 of 120 and every percentage on screen becomes a
percentage of those twelve. A slice reading 34% might be 4% of the data, and
nothing says so.

So the rule here: **a part-of-whole chart may hide a category, but it may
never lose one.**

- Everything past the cut is **grouped into "Other"**, never dropped, and
  every percentage is computed against the real total. The circle adds up to
  the thing it claims to be a picture of. A caption underneath says how many
  categories were grouped and what share of the total they are.
- **Labels only where one fits** (default: slices over 4%). The rest are
  still slices — hoverable, clickable, in the list. It is the *text* that is
  dropped, not the category.
- **The names live in a list beside the chart.** A list holds 120 rows and
  stays readable; a circle does not, and no label-placement algorithm will
  change that. It shows every slice with its value and share, scrolls, and is
  bound to the same hover and click as the circle — hovering either half
  highlights the other, so it is one chart rather than a legend to
  cross-reference.
- **The hovered slice lifts out** of the circle, and a donut's centre reads
  the total until you point at a part, then reads that part.
- Slices run **clockwise from twelve, biggest first**, because that is how a
  pie is read.
- Hovering **"Other"** lists what is in it; clicking it does nothing, because
  it is a bucket the chart invented and there is no coherent thing to filter
  the page to.

#### Or scroll the pie through them

Rolling the tail into "Other" is honest and usually right. It answers the
wrong question when the tail **is** the point — when somebody wants all 120,
in order, each with its own share.

So there's a second answer, chosen by the admin: **List them all — scroll the
pie through them.**

- Every category is in the list, in order, with its value and its share.
- **The circle draws whichever are in view, at the size they are relative to
  each other.** Scroll the list and the pie moves through the data, re-scaling
  as it goes, so 120 categories are readable in a space that fits eight. Rows
  the circle isn't currently drawing are dimmed in the list.
- **The caption says what the circle is.** *"The circle is these 8 of 120 —
  together they are 6% of the whole."* That sentence is what makes a
  re-scaled pie honest rather than a lie: eight slices worth 1% between them
  drawn against a 99% grey wedge is a chart of nothing, and filling the circle
  with them is the only way the tail is readable at all — but only if it says
  so.
- **A percentage can mean either thing, and the admin picks**: *% of
  everything* (the default — the number that means the same thing however the
  list is scrolled) or *% of what's on screen* (the one the geometry is
  showing). Both are carried on every slice, so switching costs nothing.
- Prefer the strict reading? Turn **Fill the circle with what is on screen**
  off and it goes back to keeping the whole, with everything outside the
  window as one grey wedge carrying its own share. That wedge isn't
  clickable, for the same reason "Other" isn't: it's a bucket the chart
  invented, not a value any row holds.

All of it is adjustable: how many slices to draw, the smallest slice worth
its own wedge, the label threshold, **what each label says** (name, value, %,
or any pair of them), and which of the two answers to a long tail you want.

### The admin decides what the text looks like

Seven decisions, on **every widget and every control**: heading colour, muted
colour, typeface, weight, letter spacing, alignment and size.

Set them in three places, in order of precedence:

- **On the widget** — the paintbrush on its Arrange pill, or *Appearance* in
  the admin panel. The widget's own controls take the same treatment, because
  a control bar in a different typeface from the widget under it is an
  oversight, not a design.
- **On the page** — the **Text** tab of *Design this page*. This covers every
  widget and every control on the page, including the page filter bar. It's a
  default, not an override: a widget you styled by hand keeps its own, the
  same way the card surface works.
- **Nothing at all**, which is the default and stays the default.

**Heading colour and muted colour are two separate fields**, deliberately.
The greys exist to create a hierarchy — a heading in `slate-800`, its caption
in `slate-400` — and one field for both would mean that *using* the feature at
all flattened it.

**Only the neutral greys are re-coloured.** An error stays rose, a KPI keeps
its accent, a positive delta stays green. Choosing a text colour is not a
request for your errors to become invisible. It's the same mechanism the dark
card themes have always used, pointed at a colour you picked instead of at a
built-in one.

**No font here is downloaded.** All seven typefaces are stacks of what's
already on the machine. A dashboard that waits on a webfont shows a page of
invisible text first, and picking a typeface from a dropdown is not agreement
to that on behalf of forty readers.

Size is a zoom, like the page's own text size, so spacing and borders come
with it — that's what *"the same design, bigger"* means. It's applied to the
card rather than to the wrapper the canvas measures, so the packer never ends
up reading a height in one coordinate space and placing it in another.

> The **Text** picker on the paint panel used to save its value and do
> nothing — nothing ever turned it into a property anything read. That's
> fixed, and there's a test named after it.

#### Inside a chart, twice

A chart is two kinds of writing in one picture, and they are read
differently. The **axes and the labels on the marks** are part of the
drawing: small, quiet, glanced at while reading a value off the chart. The
**legend** is a key — read once, deliberately, and very often the one thing
that's too small on a screen across the room.

So they're set separately, each with its own colour, typeface, weight and
size. One control for both would mean that enlarging a legend enlarged forty
axis ticks with it and the chart lost the space it was drawn in.

Both appear on the widget's paint panel and in the admin panel's
*Appearance* — but **only on widgets that actually draw one** (bar, line,
area, pie, trend, stacked, combo, scatter). Offering it on a table would be a
control that does nothing, which is the bug this whole section exists to fix.
Page-wide versions live in the **Text** tab of *Design this page*.

Three details:

- **Size is in pixels here**, not a percentage. What's being sized is a font
  size the chart set element by element — 11 for an axis tick, 9 for a radius
  axis — and a multiplier over several different bases is a number nobody can
  predict the result of.
- **A label drawn inside a bar keeps its own colour.** It's white because it
  sits on the bar's fill; a colour picked against a white card would vanish
  into it. Same reasoning as "only the neutral greys".
- **The app's own legends count as legends**, not just the built-in one — the
  pie's scrolling list and the trend chart's series toggles take the legend
  settings too.

The rules are aimed at Recharts' own class names, which are checked against
the installed copy of Recharts by a test — an upgrade that renamed one would
otherwise turn the whole feature off silently.


### A colour belongs to a value, not to a position

A colour is a label. Once a reader has learned that red means **Cancelled**,
they read the chart without the legend — and that only works if the colour
stays with the value.

Cycling a palette by rendered position breaks it the moment anything is
filtered. Drop *Delivered* and every category behind it shifts up a seat, so
Cancelled turns from red to amber: the reader's learned colour is now a
confident lie about a different category. Two charts of the same column on
one page disagree with each other for exactly the same reason.

So every chart now takes its colours from one place (`lib/valueColors.js`),
in this order:

1. **A pin.** *Cancelled is #DC2626.* Set it under **Fixed colours (by
   value)** on the chart, matched on the value ignoring case and surrounding
   spaces — "HDFC " in the sheet is `HDFC` in the panel.
2. **The value's seat in the roster** — the order the chart draws with
   *nothing* filtered. A filter narrows the chart without moving anybody's
   colour.
3. **The rendered position**, when there is no roster to consult.

Because step 2 seats values in their unfiltered order, **an unfiltered chart
looks exactly as it always did** — its roster order *is* its render order.
Nothing on an existing dashboard changes colour until something is filtered,
and then only by *not* changing.

**A pin beats the colour mode.** Pin Cancelled red and it is red in the
one-colour chart, the shaded-by-value chart and the highlight-best-and-worst
chart too. A pin that meant something different in every chart on the page
would be the opposite of what pinning is for.

Where it applies: bars, columns, lines, areas, pies, donuts, roses, treemaps,
funnels, progress lists and nested circles; stacked and grouped bars; the
trend chart's series; and scatter groups. Pick the palette unpinned values
are handed out from in the same place.

Three details worth knowing:

- **A category the roster has never seen sits behind everyone it knows.** A
  chart capped at twelve categories has a roster of twelve, and a filter can
  lift a thirteenth into view — seating it at its rendered position would
  drop it straight on top of whoever holds that seat.
- **"Other" is always grey**, even if you pin it. It is a bucket the chart
  invented out of a tail it could not draw, and painting it like a category
  would have the chart claim a category exists that no row holds.
- **Two values pinned to the same colour** are flagged in the editor rather
  than quietly renumbered. Which of the two should move is your call — and a
  chart where two categories are indistinguishable isn't a crash, it's worse:
  it reads fine and means nothing.

The trend chart gets this for free in one more place: switching a series off
in the legend narrows the chart too, and the ones left keep their colours.

Costs nothing when nothing is filtered — the roster is only built when the
filtered and unfiltered row counts differ, because otherwise it would return
the colours the position already gives. Turn the whole thing off per chart
with **Keep each value's colour when filtered** if you want the old
by-position behaviour back.

### Two axes worth knowing about

**Log scale** — on the value axis of any chart that has one. On a linear axis
a top bar of 1,667 makes everything under about 200 a stub of the same
height, and the difference between 40 and 4 — which may be the entire point —
is invisible. A log axis is the honest way to show a range spanning orders of
magnitude, and a *dishonest* way to show a narrow one, which is why it's a
choice rather than something the chart decides for you. Zero has no
logarithm, so the floor is the smallest positive value in the data.

**Stacked to 100%** — a third layout for stacked bars. Regular stacking
compares totals *and* composition at once, which means a branch with 4,000
rows drowns one with 40. Scaling every bar to the same height asks a
different question — *what is the mix here* — and answers it for every
category equally. The axis reads as percentages and the caption says which
chart you're looking at, because Recharts scales the bars to 0–1 and an
unformatted axis would read "0.4" up the side of a chart about proportions.

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

Clicking a **pipeline stage**, a **stage KPI**, a **flow branch**, a **chart
bar/slice/tile**, a **stacked or combo bar**, a **heat-map cell**, a
**leaderboard row**, a **KPI** or a **gauge** filters the whole page to those
rows. Active drill-downs appear
as removable chips, so it's always visible *why* the numbers changed. Clicking
the same thing again clears it. Drill-downs obey the same tab scoping as
everything else.

#### Everything in a pipeline stage's pop-up drills

A stage's pop-up shows **the stage's own rows** — its KPIs, its pivot table and
its leaderboard all describe the card you clicked. That's what lets everything
in there be clickable, and mean what it says:

- a **KPI** → the stage *and* that KPI's conditions ("delivered vehicles that
  were financed", not just "financed")
- a **leaderboard row** → that person's rows *in this stage*, not everything
  they've ever touched
- a **pivot cell** → that row × that column, within the stage; a **row or
  column total** → that one label. An empty cell stays inert, since there are
  no rows behind it to show.

A stage KPI with no conditions of its own stays inert, since filtering by it
would be identical to clicking the stage. `(blank)` is a real group, so it
drills as *"this column is empty"* rather than as the literal text.

When a stage matches **any** of its conditions rather than all, the stage
travels as a chip of its own with the narrower drill stacked on top —
"(booked or delivered) **and** financed" can't be written as one flat set of
conditions. Both chips appear, move and clear together.

> **Fixed:** a stage whose conditions never recorded which tab they belonged
> to — one migrated from v2, or written before multi-source refs existed —
> used to **count correctly and then filter nothing at all** when clicked.
> Counting only ever looked at the column; the filter engine also insists a
> condition names its tab, and silently ignored the rest. Both now go through
> one function, so a stage's number and its drill can't disagree again.

### Exporting to CSV

Every widget that holds numbers worth taking away has a **CSV** button, and
what it gives you is **exactly what is on screen** — not the tab as it exists
in Google Sheets. A file that disagrees with the screen is worse than no file,
because the disagreement is invisible until somebody acts on it.

| Widget | What comes out |
|---|---|
| **Data Table** | Every row the filters left — not just the page you're looking at, which is a paging artefact — in your current column order and sort. |
| **Chart** | The grouped series: one row per category, with its label and value — every category, including any the chart rolled into “Other”. The aggregate is the point of a chart, and it's what people paste into a deck. |
| **Leaderboard** | The ranking, with a column per metric. |
| **Pivot Table** | The grid as a grid: one column per row dimension, one per column heading, plus totals. |
| **Flow** | The branches you have **opened** — tree, level, branch, full path, table, value, rows, share of parent, share of total. A flow's premise is that you choose the depth, so an export that walked past that choice would not be the thing on screen. |

Details that matter once a month and ruin your day when they're missing: a
UTF-8 **BOM**, so Excel on Windows renders ₹ and accented names instead of
mojibake; **CRLF** line endings per RFC 4180; quotes doubled (never
backslash-escaped) and fields quoted only when they contain a delimiter,
quote, newline or edge whitespace; and a **dated file name** (`Stock-ageing_2026-08-24.csv`),
because the same export run twice a week apart is two different files.

Admins get a per-widget **"Let viewers download this as CSV"** toggle, on by
default. Switching it off hides the button for everyone but admins, who can
always take the data they administer.

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
- **"Select all" toggles.** Press it once to tick everything, again to untick
  everything. Unticking the last value *one at a time* still clears the filter
  instead of emptying the table — that is usually a slip — but pressing the
  box itself is not a slip, and both the box and *Clear filter* are in plain
  sight as the way back. With a search active it reads *Select shown* and
  touches only what's listed.

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

**Signing in** is Google-only, and a new account lands on a waiting screen
that asks two things: their **name** and **their role** — *Sales Executive*,
*Service Advisor*, *Yard Supervisor*.

The name is **typed, never taken from Google**. Google's display name is
whatever that account happens to be called — a personal one, an initial, a
nickname — and it was previously rewritten on *every* sign-in, so a name
somebody corrected went back to Google's the next time they logged in. The
box starts empty rather than pre-filled, because a pre-filled box is accepted
without reading, which is how a user list fills up with names nobody
recognises. The request can't be sent without one.

That role is their **job**, typed freely, not an access level. A dealership's
job titles are its own, and any dropdown written here would be wrong at the
second dealership that used this.

**Admin → Users** shows it as its own column beside the name, and it's
**editable there** — everybody who signed up before the field existed has
none, and an admin who knows the answer shouldn't have to wait for them to
sign in again and type it. It's searchable too, because "the service advisor
who joined last week" is how an admin actually remembers somebody. The
columns are named apart on purpose: **Work role** for what somebody does,
**Access** for what they may see.

Nothing a user types about themselves changes what they can see: `jobRole` is
deliberately not `role`, and the security rules freeze `role` and `status` at
whatever the document already says.

**Admin → Users** filters by **All / Pending / Active / Removed**, each with a
count, and lists pending users first — they're the ones waiting on somebody.
Per page, *set order for this user* also offers **same order as ⟨user⟩**,
listing anybody who has an order for that page, **admins included**: theirs is
usually the arrangement worth spreading.

In **👥 Users & Access**, expand a user to get a card per page:

- **Can view** the page at all
- **Widgets visible** — a per-widget deny list, so a widget added next week is
  visible by default rather than silently hidden until everyone is re-granted
- **Columns they may edit** and **Downloads they may use**, per tab

Plus *Grant all pages*, *Revoke all*, and **Copy permissions from…** another
user — the fast path for onboarding someone into an existing role.

### Only these rows — a per-user page filter

Page access is all-or-nothing: you can open the Sales page or you can't. That's
the wrong shape for the request that comes up most — *"Ravi should see the
Sales page, but only the west"* — which until now meant building a second page
with a filter baked in, then a third, then keeping all of them in step for
ever.

On every access card there's now **Only these rows**. One line, because one
line is the whole request nine times in ten:

> `Region` **is** `West`

A column and a value. Pick the tab first if the page reads more than one. Click
**more conditions** for the full builder — every operator, several conditions,
**ALL** or **ANY** — and **simple** to come back.

**It is not a control.** It runs before anything on the page, it isn't in the
filter bar, no chip dismisses it, **Reset** doesn't touch it, and no saved view
restores past it. It is the extent of their data, not a filter they applied.
It's applied at the *source*, too, so a widget set to *ignore filters*, a blend
reading its raw side, a control building its dropdown, the *showing X of Y*
count and the Flow widget all see a sheet that never contained the other rows.

**One rule can serve everybody.** Instead of typing a value, click a token:

| Token | Stands for |
|---|---|
| `{{email}}` | their email |
| `{{name}}` | their name |
| `{{jobRole}}` | their work role |
| `{{uid}}` | their account id |

`DSE Email` **is** `{{email}}` set once means forty reps each see their own
rows — and the forty-first sees theirs the day they're granted the page, with
nothing left to remember. Tokens can sit inside other text (`branch-{{jobRole}}`).

**It fails closed.** A rule whose value can't be worked out — a user with no
work role, a rule written before that field existed — shows them **nothing**,
not everything. Row-level security that degrades into *all rows* on a missing
field is how a leak happens quietly. Only the tabs the rule actually named go
empty; a tab it says nothing about is left alone, as everywhere else here.

**Two things make it bearable to administer.** *Apply to every page* writes the
same rule onto every page that user can already open — *"Ravi only ever sees the
west"* is a fact about Ravi, not about one page, and setting it eleven times is
how the twelfth gets missed. It only narrows, never grants, and skips pages
that don't read the tab the rule names. And the user list marks anyone who is
scoped with a **⌗ n row-limited** badge, listing each page and its rule on
hover — so a restriction somebody set in March is visible without opening
thirty cards.

**Admins are never scoped.** Somebody has to be able to see the whole sheet to
know whether a rule is doing what they meant.

Only an admin can write it: the `access` document lives behind admin-only write
rules, so it isn't something a reader can edit their way out of.

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
| `dataSources` | `{sourceId}` | `name`, `sheetId`, `tabs[]`, `tabHeaders{tab: columns[]}`, `computed{tab: [{id,name,formula}]}`, `dateOrder`, `lastSyncedAt` |
| `dashboards` | `{pageId}` | `name`, `navLabel`, `icon`, `iconUrl`, `group`, `order`, `showInSidebar`, `parentId`, `tabUsesPageName`, `background`, `hideSearch`, `sourceIds[]`, `widgets[]`, `controls[]`, `views[]` |
| `access` | `{uid}_{pageId}` | `canView`, `hiddenWidgets[]`, `widgetOrder{}`, `editable{ref: columns[]}`, `downloadable{ref: columns[]}`, `scope{match, conditions[]}` |
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
  lib/flow.js             The drill-down tree: levels, branches, tab hops
  lib/flowLayout.js       Tidy-tree geometry for the flow's diagram view
  lib/flowView.js         Reading a flow: search, lineage, pruning, zoom, minimap, peek
  lib/history.js          Undo/redo: a past, a present and a future
  lib/pageDesign.js       A page's own look: gaps, scale, card surface
  lib/flowPack.js         Laying widgets out by the space each one asks for
  lib/tdz.js              Finds a const used before the line that declares it
  lib/staleRef.js         Finds a ref read from inside a state updater
  lib/adminPanel.test.js  Guards the admin panel's header, folds and grouping
  lib/sectionTabs.js      A long admin form as a row of marked buttons
  lib/valueColors.js      One colour per value, everywhere, filtered or not
  lib/typography.js       Text colour, typeface and size, admin-chosen
  lib/workspace.js        Sources, pages, canvases, access, legacy migration
  lib/widgetOrder.js      Personal + admin widget ordering (pure)
  lib/widgetStyle.js      Per-widget appearance -> CSS custom properties
  lib/pageBackground.js   Per-page canvas backdrop + automatic text contrast
  lib/widgetControls.js   Per-widget dropdowns, buttons and sliders
  lib/csv.js              CSV export: escaping, file names, the download
  lib/pieData.js          Part-of-whole slicing: roll-up, labels, honesty
  lib/seriesData.js       Breakdowns: series picking, colours, cumulative, smoothing
  lib/chartShapes.js      Arrow, cylinder and nested-circle geometry
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
  components/widgets/*        The sixteen widget types
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
