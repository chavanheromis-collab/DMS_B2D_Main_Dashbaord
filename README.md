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

#### Pages are sorted by picking them up

Drag a page in the sidebar and drop it where it belongs. The sidebar is the
only place the order of pages is visible, so it's the only place worth
reordering them from. Dropping **on** a page takes its place; everything from
there down shuffles along, which is what a gap opening under the cursor looks
like.

**Anybody can sort.** What the drag changes depends on who's doing it, and the
sidebar says which while you're dragging:

| Who | What moves |
|---|---|
| An **admin in edit mode** | The workspace order — everybody gets it |
| **Anyone else**, including that same admin a moment later | Their own sidebar, and nobody else's |

That's the same two-level rule widget order has always had: a personal
arrangement beats the workspace default, because a person rearranging their
own screen isn't overriding policy — it's a preference about their own eyes. A
rep who lives in two of nine dashboards can put those two at the top without
asking anybody.

Personal orders live in `userPrefs/{uid}_pages` — the one collection an
ordinary user may write to, and the rule matches on that id prefix, so nobody
can write anybody else's. If it can't be read, the sidebar shows the workspace
order: a preference is a convenience, never a gate.

Three details:

- **Only the pages whose number changed are written.** Dropping something back
  where it started shouldn't be sixteen document writes.
- **The order written back is dense, from zero.** Pages arrive with whatever
  numbers history gave them — gaps, ties, nothing at all on anything created
  before the field existed — and a drag that preserved those would land
  somewhere that depended on data nobody can see.
- **Dropped into another group's list, a page joins that group.** The list you
  dropped it into *is* the group; leaving it out would send it straight back
  the moment the sidebar redrew, which reads as the drag having failed.

#### It comes when it's called

A sidebar collapsed to its rail hands the width back to the dashboard — which
is what you came for — and then costs a click every time you want to go
somewhere. **Hover the extreme left edge and it opens; move away and it goes
back.** The chevron is still there, because a hover is a nice thing to have
and a terrible thing to depend on.

Three rules stop it being the kind of hover menu people turn off:

- **It never fights the button.** Pinned open is pinned open; the peek only
  exists while the sidebar is collapsed. Nothing you did with a click is
  undone by where you moved the mouse. While it's peeking, the chevron is how
  you make it *stay* — which is the whole reason it's still there.
- **It never moves the page.** A peek *overlays* the canvas rather than
  pushing it, so a page of charts doesn't reflow every time the pointer
  crosses the left edge. The function that computes the content offset isn't
  even told about the peek — it can't use what it can't see, and there's a
  test that reads the source to keep it that way.
- **It has to be meant.** ~110ms of intent before it opens, so crossing the
  edge on the way somewhere else doesn't; ~280ms of grace before it closes,
  so a diagonal path to the third page in the list doesn't lose it halfway.
  Leaving by accident is the more expensive mistake, so it gets the longer
  fuse.

The hot strip is a real element that only exists when a peek is *possible* —
not a `mousemove` listener running on every frame of every dashboard. There's
none of it at all on a touch screen, where there is no hover and a strip down
the left edge would just swallow taps, or while the mobile drawer is the
navigation.


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

### Messages

*"The Nashik figures are wrong, don't quote them."* *"Stock take at 4, log
your deliveries first."* Things that are **about** the dashboard, need to
reach the person reading it, and otherwise go out on WhatsApp where they are
read by everyone except the two people who needed them.

Anyone an admin has allowed can send one — from the **bell** at the bottom
right of every screen. To **one person**, **several**, or **everyone with an
account**.

#### It reads as a chat

The bell opens a list of **conversations**, newest first, and tapping one
opens the thread: bubbles, yours on the right, theirs on the left, days
marked between them. Type and press Enter. Text only — no attachments, by
design.

**Nothing is stored differently for this.** A conversation is *derived* from
who a message is between, never written down as its own document: a message
to one person is a chat with that person, to several is the group of those
people, to everyone is the one channel called Everyone. Deriving it means no
migration and — more to the point — no second source of truth about who is in
a conversation, and so no way for the two to disagree.

The id is the **sorted list of the other people in it**, which is what makes
the chat you see when you write to Ravi the same one he sees when he writes
back: his id from your side, yours from his. Sorted, because an id that
depended on the order somebody happened to tick two names would give two
conversations with exactly the same people in them.

**A reply is just the next bubble.** In the database a reply is still nested
inside the message it answers — that is what carries the obligation, since
*should reply* is closed by a reply and not by any later message. It simply
stops being a shape anybody has to look at.

**Typing is answering.** In a chat nobody presses "Reply", they type. So if
the newest thing in a conversation is a question somebody asked you and you
have not answered it, what you type *is* the answer — which is what closes it
and stops it covering the page again five minutes later. If nothing is
waiting, the same keystroke starts a new message. Without this rule every
answer would leave its question open.

The obligation picker sits above the box, always on screen, with the chosen
one filled in and a line under it saying what it will do. Folded away it was
a setting nobody knew was there — and what you are asking of somebody is the
one thing about a message that cannot be inferred from its words.

A conversation with something still owed shows **reply** in red rather than
an unread count — a question you have read and not answered is a different
thing from a message you have not opened.

#### The number on the bell

The message icon carries a count — 1, 2, 3 — of what is **waiting on you**,
capped at 9+ so it stays a badge rather than a width. Waiting, not unread,
because two different things wait:

- something you have not opened, and
- a question you **have** opened and not answered.

Counting only the first makes the badge vanish the moment somebody glances at
a question, which is precisely when it starts being owed. Counted per message,
so one that is waiting both ways is one and not two. The same number goes in
the tab title, from the same function — two counts of "how many" that can
disagree is somebody seeing 3 in the tab and 1 on the bell.

#### What you are asking of them

The sender picks an **obligation**, not a volume. Loudness is a decision about
the sender's feelings; the obligation is the thing the reader actually needs
to know — *may I carry on, do I have to look, do I have to answer.* Everything
else follows from that one field.

| | what it does | comes back |
|---|---|---|
| **Can be ignored** | a toast in the corner; gone in 9 seconds; nothing has to happen | never |
| **Should be seen** | covers the page until they close it | never |
| **Should reply** | covers the page until they **answer** | **after 5 minutes** |
| **Urgent — reply now** | the same | after 1 minute |

#### Toasts, not a stack down the page

Messages arrive as **toasts in the bottom-right corner**, floating clear of
the page. Three things follow from that, and each of them was a complaint
about the banners they replaced:

**The dashboard does not move.** The stack is `fixed`, so a message arriving
neither shortens the page nor pushes the widget somebody is reading down the
screen. A column of notices along the top of a dashboard is a column of
dashboard nobody can see.

**They go by themselves — when they asked for nothing.** *Can be ignored*
lasts 9 seconds, *should be seen* 6 (which it only ever gets while something
louder is covering the page ahead of it). A notice that can be ignored and then
sits there for ever is being ignored **and** taking up room. The timer
**pauses while the pointer is over the card or the cursor is in its reply
box**: a message that vanishes mid-sentence is a message that has to be
found again in the inbox.

**A question never goes by itself.** *Should reply* and *urgent* carry no
timer at all — one that vanishes after 9 seconds is a question nobody
answers, and 9 seconds is exactly how long somebody looks away for. That rule
is stated over the model rather than per tone, so a fifth tone added next
year cannot quietly time a question out. What a question does get is
**Later**, which takes the card off the screen and leaves the message owed —
it is still in the inbox, and it still comes back.

**What you sent puts itself away.** The sender's own copy is a *receipt* — it
says the thing left — and it goes after 4 seconds whatever its tone, because
nobody is being asked anything by a message they wrote themselves. A question
you sent, sitting on your own screen until you answer it, is a loop.

**Three at a time, and the rest are counted.** A fourth toast is not more
information, it is the bottom of the page. Past three the stack shows
*“2 more”*, which opens the inbox — a stack that silently drops the rest is
worse than one that says so.

**Nothing behind them is blocked.** The column takes no clicks and each card
takes its own back, so the dashboard under a toast stays usable. And none of
it prints.

Hiding a toast is **not** closing the message: it is off this screen, still in
the inbox, and anything owed is still owed — which is why the covering
dialogue below does not consult it. Pressing the **×**, by contrast, closes
the message for good. The one message currently covering the page is never
also drawn as a toast behind its own dialogue.

#### Who may use it at all

Two switches per person, in **Admin → Users → Messages**: **Send** and
**Receive**.

**Absent means yes.** Everybody who signed up before these fields existed
keeps working, rather than silently losing messages until an admin ticks a box
nobody told them about. Only an explicit `false` switches somebody off.

**Sending is fenced in the rules**, not only in the form — a hidden button is
a hidden button, and `firestore.rules` reads the sender's own user document
before it will accept a message. **Receiving is honoured by the client**,
because it is a feature being switched off for somebody rather than a secret
being kept from them.

**Neither switch can be flipped by the person it is about.** They are frozen
on self-update the same way `role` and `status` are, using
`get('canSendMessages', true)` on both sides so an account that predates the
fields compares equal and can still save its own name.

**Somebody who cannot receive is not offered as a recipient.** Listing them
would be offering to send into a hole: the message would go, it would be
stored, and the sender would never learn it was not delivered.

#### Covering the page, and getting out from under it

A covering message genuinely covers: the backdrop takes the clicks, so
nothing behind can be read or pressed. A notification that can be scrolled
past is a notification that gets scrolled past.

But it can be **minimised**, and minimising gives the dashboard straight back.
Somebody who needs the number in order to answer the question has to be able
to get at the number — a message that makes its own answer impossible is a
message that will not be answered.

What minimising costs is said on the dialogue **before** it is pressed, rather
than discovered five minutes later: *"This returns in 5 minutes unless you
reply."*

And it does return. A question you can put away for ever by pressing minimise
is a question you can ignore by pressing minimise. One that asks for nothing
back stays minimised, because covering the page again would be nagging about
something already dealt with.

There is **no Escape and no click-away**. Those are the two ways a dialogue
gets dismissed without being read; every button here — minimise, close,
answer — is a decision worth making on purpose.

Minimising is remembered for the **session**, not written to the database. It
is *"not right now"*, not a decision worth recording, and a document write
behind a gesture people make while reaching for something else is a write
nobody asked for. A reload puts an unanswered one back, which is the right
answer for something still unanswered.

Five more decisions worth knowing:

**"Everyone" is a flag, not a list.** Store the uids and you have a snapshot:
send it Monday, and the person who joins Tuesday never sees it — which is not
what anybody means by everyone.

**Closing is per person.** One recipient putting a message away cannot put it
away for the other eleven, so the state is `dismissedBy: [uid]` on the message.

**Closing a question is not answering it.** A *Should reply* card has no
close button for the people it asks — offering both makes the answer optional.
That rule lives in the model, not the markup: a rule enforced only in the UI is
a rule enforced nowhere. Answering it *does* close it, though — leaving a card
up after the thing it asked for has been done is the other way to teach people
to ignore them.

**Only one thing covers the page at a time.** Three dialogues stacked on a
dashboard is not urgency, it's an obstacle — and somebody who has to dismiss
three things before they can read a number will dismiss the third without
looking at it. The newest one covers; the rest wait as toasts and in the
inbox.

**The sender is never interrupted by their own message.** They wrote it. And
an unrecognised tone falls back to *can be ignored*, so a message stored with
a value nobody recognises cannot end up covering everybody's screen.

**Dismissing is not deleting.** Everything stays in the inbox behind the bell,
because *"where did that go"* is the first thing somebody asks after closing
one by accident.

#### The ask, and why it is not optional

Notifications are asked for on **every session until the answer is settled**,
in a panel that covers the page rather than a button in a corner. Messages
here carry obligations — somebody is waiting — and a message that only arrives
if the right tab happens to be open is a message that does not arrive.

Two details that decide whether anybody ever says yes:

**The browser's own prompt is still raised from a click.** Not politeness:
Safari and every browser on iOS refuse `requestPermission` without a user
gesture, so asking on load is how you get no prompt at all. And a prompt
somebody chose to open is the one they accept.

**"Not now" exists, and means an hour.** A prompt with no way out is one
people answer by closing the tab. It is remembered per browser — permission
*is* per browser, so putting it off on the office desktop must not silence the
ask on somebody's laptop — and in a private window, where storage throws, it
simply asks again.

A **denied** answer is never asked again. The browser will not re-prompt, so a
button that appears to ask and silently does nothing is worse than no button;
the app says where the switch is instead.

#### What a notification looks like

Not a wall of text. Each one carries:

- **The sender's face** — the same coloured circle with their initials that
  the app draws, rendered to a canvas. A notification with no icon is a grey
  square with the browser's logo on it, indistinguishable from every other
  site that notifies; the avatar makes it recognisable before it is read,
  which is most of what a notification is for.
- **Where it came from**, when that adds something. "Ravi" and
  "Ravi · Everyone" are two different things to be interrupted by, and only
  one of them is worth turning to. A one-to-one chat is just the name — the
  conversation *is* the sender, so repeating it would read "Ravi · Ravi".
- **One stack per conversation.** Tagged by conversation rather than by
  message, so six lines from one person are one alert that updates, not six.
- **A buzz only when something is wanted.** `vibrate` for a question,
  silence for a notice — the obligation, carried out of the app.
- A monochrome **badge** for the Android status bar, inlined so it costs no
  request and cannot 404 after a deploy.

The avatar comes from `lib/avatar.js`, which is also what the app and the
remark threads draw from. Three copies of "which colour is Ravi" is three
answers to that question, and the day two of them disagree is the day the
picture stops meaning anything.

#### Reaching somebody who is not looking

A banner is only a banner to somebody who can see it. The person a message is
actually for is usually in another tab, or has the browser minimised behind
the DMS, or is in a meeting with the laptop shut. For them the dashboard's own
banner is a thing they find later — which is the same as not being told.

So two more surfaces, neither of which needs the tab to be on screen:

**A count in the tab title** — `(3) Dealer Dashboard`. Costs no permission,
survives a denied prompt, and it is the thing people actually notice glancing
along a row of tabs. Capped at 9+, for the same reason the bell is.

**A desktop notification**, which arrives whatever the browser is doing. The
sender's name is the title, because *"Ravi"* tells somebody more than *"New
message"* does, and the obligation follows the message out of the app: a
**Should reply** notification stays on screen until it is dealt with, while
one that **can be ignored** arrives silently.

Four rules keep that from becoming the thing people switch off:

- **Only when they cannot see the page.** Firing a desktop notification for a
  banner somebody is already reading is how an app teaches people to mute it.
  And "cannot see" means both halves — a visible tab in an unfocused window is
  a dashboard on a second monitor that nobody is reading.
- **Never twice.** A re-render, a reconnecting listener, or a reply arriving on
  a message must not raise the same alert again. The id is remembered *before*
  the notification is raised, because `new Notification` throws on some
  platforms and retrying every snapshot would be an invisible loop.
- **Asked for by a button, never on load.** A permission prompt on page load is
  the anti-pattern that gets denied for ever, and a denial is permanent — there
  is no second chance from JavaScript. The offer appears only once a message
  has actually arrived, when the reason for it is on screen, and never again
  once it has been denied: a button that appears to ask and silently does
  nothing is worse than no button.
- **It degrades to nothing.** No permission, an old browser, a platform that
  wants a service worker — the banner and the title badge still work. Nothing
  here is the only way a message arrives.

#### What the rules enforce

This is the second collection an ordinary user may write to, and the first
where what they write is seen by somebody else — so `firestore.rules` does more
work here than anywhere else in the file:

- **You can only read what was sent to you.** A `list` rule is evaluated per
  document and rejects the whole query if any of them fails, so the client asks
  two constrained questions — *addressed to me* and *addressed to everyone* —
  and merges them. Do not "optimise" that into one query; it will fail for
  everyone who is not an admin.
- **You cannot send as somebody else.** `from` must be your own uid.
- **A recipient may only mark and reply.** Every other field is frozen, and the
  two id lists may grow by *at most the writer's own uid* — so nobody can
  dismiss on another person's behalf or edit the body of something already
  delivered.
- **A new message arrives unread, unclosed and unanswered**, so it cannot be
  posted pre-dismissed for everybody.
- **Unsending is the sender's**, and an admin's.

The message centre is mounted on the **shell**, not on a page: a message about
the workspace should not vanish because somebody navigated to the admin panel.

### Remarks on a row

*"Customer asked to postpone delivery to the 14th."* *"Invoice already
raised — do not re-bill."* Things that are true about **one record**, that
the next person to look at it needs to know, and that have nowhere to live: a
spreadsheet column is the wrong shape for them and a WhatsApp message reaches
the wrong people.

An admin switches it on per table — **Widgets → (a table) → Remarks**. Every
row then gets a small note button. Anyone who can see the table can open it,
read what others have written and add their own; each remark carries the
writer's **name** and the **time**, and several people write on the same
note. It is a thread, not a field. You can reword or delete your own — and
only your own.

#### What a remark is attached to

The one decision here that matters, and it is worth being blunt about.

A remark is attached to the value in a **key column** the admin picks — a
deal id, a chassis number, an invoice number. Not to the row's position. If
it were pinned to the spreadsheet row number, then the moment somebody
inserted a row in Google Sheets **every remark below it would move down onto
a different record** — silently, onto real records, carrying somebody else's
words. That is the worst thing this feature could do.

With a key column, rows can be sorted, filtered, paged, re-imported or moved
and each note stays with its record. The address is the **tab plus the key**,
which also means a record shows the same remarks in **every** table built on
that tab — two tables on one tab are two views of the same records, and a
remark that appeared on one but not the other would have people asking where
their note went.

The row number is still the fallback when no column has been chosen, because
a feature that refuses to work until it is configured perfectly is a feature
nobody switches on. The editor says plainly what that costs, in amber, at the
moment the decision is made.

#### Reading it without opening it

A row nobody has written on has a faint outline that does not compete with
the data. A row that has been talked about is **amber and carries a count**,
so somebody scanning a table sees which records have a history before opening
anything. Hovering shows the most recent remark — usually the only one anyone
wanted. Hovering a **round avatar** in the thread gives the author's full name
and the exact date and time — the full name matters most on your own remarks,
where the line above says only *"You"*. The count caps at 9+, the same rule the message bell follows.

The note itself is portalled out of the table and positioned fixed, because
the table scrolls inside a card: a panel drawn in the row would be clipped by
the row beneath it. It is measured before it is placed, so one opened on the
last row or against the right edge flips instead of hanging off the window.
Escape, a click outside, or scrolling the page closes it — scrolling *inside*
it does not.

#### Four rules about what people can do

**You write as yourself.** Every remark carries the writer's uid, and
`firestore.rules` refuses one that does not. On a note colleagues make
decisions from, a remark signed by the wrong person is the whole game.

**You reword your own, and it says so.** The pencil edits a remark where it
sits — in place rather than in the box at the bottom, because a correction
belongs at the point in the conversation it corrects. What an edit may change
is the **words, and nothing else**: the author, the name against it and the
moment it was first written are all carried over, so "edit" can never become a
way to put your words in somebody else's mouth or to make a remark look older
than the thing it is about. Every edit leaves an **"edited"** mark carrying the
time it was changed.

That mark is the point. A remark colleagues have already acted on quietly
becoming a different sentence is the hazard; one that says it was changed, and
when, is a correction. Saving the same words back is refused rather than
stamped — the marker crying wolf would teach people to ignore it.

**You delete your own and nobody else's.** The rule takes the set difference
in *both* directions and looks at the `by` field of what actually changed;
`hasAll` alone would prove a list had not shrunk while saying nothing about
whose remark had gone. A write adds one, removes one of yours, or swaps one of
yours for a reworded version of itself — never a mixture, because an add and a
delete in the same write would leave the delete unchecked.

An edit is checked as the *same remark coming back*: same author, same name,
same original timestamp, now carrying `editedAt`. Without the timestamp
comparison, "one out and one in" would just be a delete and an unrelated add
wearing a disguise — which is how somebody replaces their own remark with a
different one dated to last week.

It is also the one write in the feature that is a **transaction**. `arrayUnion`
and `arrayRemove` are transforms on the same field and Firestore will not apply
two in one write, so an edit has to send the whole list — and a plain
get-then-set would silently discard whatever somebody else added in between.

**A note cannot be moved to another record.** `scope` and `key` are frozen on
update, or a whole thread could be relocated onto somebody else's row.

Binning an entire note is an admin's job. One person deleting the record of
what eleven people said is not something to leave lying about.

#### What it costs

One Firestore listener per table that has remarks switched on, scoped to that
tab — not one per row, which for a 25-row page would mean twenty-five
subscriptions torn down and rebuilt on every page turn. A table with remarks
off opens nothing at all.

The first remark creates the note; there is no read to find out whether it
exists, which would be a round trip on every row anybody opened plus a race
between two people writing the first remark at the same moment. Remarks are
added with `arrayUnion` so that two people writing within a second of each
other both keep theirs.

### When something breaks

A dashboard draws thirty-odd widget types over whatever a spreadsheet happens
to contain that morning — a column renamed, a date that is now the word
"pending", a chart pointed at a tab somebody deleted. React's answer to a
render error is to unmount the whole tree, so **any one of those turned the
page white**: no widgets, no header, no sidebar, and the one widget that broke
invisible along with the twenty-nine that were fine.

Every widget is now drawn inside its own boundary. One that fails becomes a
card saying which widget it was and what the message said; the rest of the
page carries on.

Three details decide whether that is useful or merely tidy:

- **The boundary sits inside the edit chrome.** A widget that cannot draw is
  exactly the one an admin needs to open, so its Edit pill and arrange pill
  are outside the boundary and survive the failure.
- **Fixing it clears it.** The reset key is the widget object, and every save
  builds a new one — so the card recovers in the same render as the new
  config. Without that it stays stuck on an error from a minute ago and only a
  reload shows the fix.
- **The message, not the stack.** "Cannot read properties of undefined" often
  tells an admin which setting is empty. Forty minified frames tell nobody
  anything. The full error still goes to the console.

The page's own scaffolding — the layout, the control bar, the header — has a
second boundary, because a widget boundary cannot catch a failure there and
that is the failure that produced the white screen.

### What a reader downloads

The admin panel is the largest thing in the app, and it was landing in the
bundle **every visitor** downloads before seeing a single number — most of them
readers who cannot open it at all.

The admin route and the three on-page editor panels are now fetched when
somebody opens one. Both had to move: they share the same editor tree, so
splitting one and not the other leaves it in the main bundle regardless.

| | before | after |
|---|---|---|
| First-load bundle | 874 kB (242 kB gzipped) | **602 kB (177 kB gzipped)** |

Roughly a third off what a reader waits for, and Vite's chunk-size warning is
gone. `WorkspaceCtx` stays eager — it is a few lines of context object, and the
provider wraps the page whether or not anything is being edited.

### Waiting

It was the word "Loading…" in grey, centred on white. Not wrong, exactly — just
indistinguishable from a page that has given up, and a dashboard's first load
(auth, then the workspace, then every tab of every sheet) is long enough for
somebody to start wondering.

Three things fix that, and none of them is a bigger spinner:

- **Motion**, so the app reads as working rather than stuck.
- **A reason** — *Signing you in*, *Finding that page*, *Opening the admin
  panel* — so a long wait is explained rather than mysterious.
- **A shape** where the thing being waited for will appear. A canvas with no
  widgets yet shows card skeletons: a spinner says *wait*, a skeleton says *a
  card is coming and this is where it goes*.

The sheen stops for anyone with `prefers-reduced-motion` set, and every
skeleton is `aria-hidden` — it is a picture of a card, not a card.

### View mode and edit mode

A dashboard is a thing you look at, so it **opens as one** — for everybody,
including the admin who built it. **Edit** is a switch in the header, not a
second screen, because *go to the admin panel, change a number, save, come
back, squint* is four steps of which three are travel.

#### The editor is a split, not a panel

Turn on Edit and everything opens the same way: **the form on one side, what
it changes on the other, live.**

```
┌──────────────────────────┬───────────────┐
│                          │  Sales by DSE │
│   ▁▃▅█▆▃▁  (live)        │  ─────────────│
│                          │  Chart type ▾ │
│   the widget, rendered    │  Group by   ▾ │
│   by the page's own code │  Colour     ▉ │
│                          │  …            │
└──────────────────────────┴───────────────┘
        preview                  editor
```

**The preview is not a mock-up.** It is the same component the page renders,
given the same unsaved draft — so what you see *is* what the page will show.
There is no second implementation to disagree with the first.

**And it is live, not a picture of one.** Click a pipeline stage and it opens
its sub-stages; open a dropdown, scroll a long chart, drill a bar — the
preview behaves exactly as the page will, while you are still changing it.
The highlight that marks which card you're editing is a sheet of glass: it
takes no clicks. The **Edit** pill in the card's top-right corner is what
opens the form.

This is a correction. The highlight used to be a button covering the whole
card, so a widget in edit mode could be looked at and not used — and a
preview you cannot work is a screenshot. The arrange pill keeps the opposite
corner, so a card can carry both without either getting in the way.

**Move the form** to the left, the right or the bottom from the buttons in
its header, and **drag the divider** to resize. Both are remembered per
browser, because they're a preference about *your* screen and not a property
of the dashboard. On a screen too narrow for two columns the split stacks
itself — a 320px form beside an 80px "preview" is a strip of colour, not a
preview.

An earlier version of this docked the panel around the widget's own
rectangle. It worked, and it was wrong: the form appeared in a different
place every time and you had to find it again.

#### Everything opens in it

| Click | You get |
|---|---|
| **The widget itself** | Its whole editor — the same form the admin panel shows |
| **⇄** on a widget's pill | The same thing, for when the pill is already under your hand |
| **Controls & buttons** | The page's filter bar, previewed as the page |
| **Page settings** | Title, icon, placement, backdrop, spreadsheets |
| **⚙ on a sidebar entry** | That page's settings, from anywhere |
| **+ New page** in the sidebar | A page, created and opened with its settings beside it |

**A widget or a control previews as the page**, not as itself — you cannot see
what a filter bar looks like by looking at the filter bar alone. Only a widget
previews as itself.

#### Live means live

- **The unsaved edit is merged in before anything reads the widgets**, so the
  blend, the filters, the canvas and the widget all see the change at once.
  Merged further down, a chart would redraw while its own caption did not.
- **The page's own settings are live too.** The settings form reports every
  keystroke, and the page it is describing is the saved page with that draft
  merged over it — one line, so a rename shows in the heading and a new
  backdrop appears behind the widgets while the form is still open. The admin
  panel passes no such callback and is unchanged: it still saves on **Save**.
- **The write is debounced and closing flushes it.** A document write per
  keystroke is not a save strategy; an edit still sitting in a timer when the
  panel closes is an edit lost. The header says *Saved* or *Saving…*.

In edit mode **the widget is the way in**: hover it and it lights up with an
**Edit** chip, click anywhere on it and its editor opens. A pill somebody has
to find first is a pill somebody has to be told about. The click layer sits
*under* the arrange pill, so the pill's own buttons keep working.

**Adding a widget happens on the page**, and **hovering a type shows you what
it is**:

```
┌──────────────┐
│ ▁▃▅█▆▃       │   Chart
│              │   Group a tab by a column
└──────────────┘   and plot it — 11 styles
```

Sixteen names tell you nothing about the difference between a combo chart and
a stacked one, and the way anybody finds out is by adding both and deleting
one. The sketch answers it in the time it takes to move the mouse.

It is deliberately a **sketch, not a live render**. A real one would need a
tab, columns, an aggregation and rows — none of which exist before the widget
does — so it would either be empty or be a lie about your data. Shapes and
proportions are the honest thing to promise.

The new widget then **opens straight into its own editor**, and the defaults
are chosen so it *draws* the moment it lands: a widget that renders as an
empty box until three more fields are picked is a widget nobody finishes.

**Background and page-wide text** are on the edit bar too, under
*Background & text* — the backdrop, the card look and the text colour every
widget on the page inherits. It has always been one click away behind the
palette; in edit mode it belongs with the other things you are there to
change.

**Adding a page happens in the sidebar**, where pages are. It's created empty
and opened immediately rather than after a form is filled in — a page with no
name is a page you can see and rename, and a form in front of an empty canvas
is a form about nothing.

The admin panel is still there and still does everything it did: it is where
spreadsheets are connected and access is granted. What has moved to the page
is everything that is *about* a page you can see.

### One name in the palette, several shapes behind it

**Chart** is one button and twenty-one drawings. A bar chart and a treemap
are not variations on a theme — they answer different questions — and hiding
both behind a word means the way anybody finds the treemap is by adding a
chart, opening its editor and reading a dropdown.

So a type with shapes behind it **opens** instead of adding. The palette
becomes those shapes, every other type steps aside, and each one is **drawn**
rather than named — hover any of them for the sketch. `‹ All widgets` goes
back. The button that opens rather than adds carries its count, so one click
in the row never does something different from every click beside it with
nothing on screen saying so.

Two types have shapes today:

| | |
|---|---|
| **Chart** | all 21 styles — bar, lollipop, waterfall, pareto, histogram, pie, donut, rose, radar, radial, treemap, funnel, … |
| **Stacked / Grouped Bars** | stacked, stacked to 100%, grouped — a total broken up, a mix, and a comparison |

**A variant is a type plus a patch.** Picking *Donut* adds a chart whose
`chartType` is donut — exactly what picking Chart and then changing the
dropdown has always produced. Nothing new is stored and no widget learns a
second identity, so every editor, every saved page and every renderer already
understands the result, and any of it can still be changed afterwards.

The chart list is **built from** the same `CHART_TYPES` the editor's dropdown
uses, so a style added there cannot go missing from the palette. Shapes that
are the same drawing at thumbnail size share one sketch — a bar and a cylinder
bar differ by a rounded top, which is not a difference worth drawing twice.

### A widget inside a widget

One chart of company totals, and behind it the same chart per region, per
branch, per model. Laid side by side that is thirty cards and no story; laid
one level down it is a headline you can open.

**Any widget can hold widgets.** A card that has something inside it carries
an `⧉ 2 inside` chip in its bottom-right corner; clicking it **replaces the
page** with those two, and the page you left becomes a trail at the top —
`Sales dashboard › Sales by region › North`, every crumb clickable. Up to
three levels deep.

The chip is a corner, not the card, for the same reason the edit highlight is
glass: the card is a working chart, and a click on a bar should drill the bar.

**A child is an ordinary widget.** Not a special kind, not a reduced kind —
the same object the page stores. So every widget type, every control, every
condition, every style and every editor works inside exactly as it does
outside, with nothing to keep in step. **Add** adds where you are standing:
on the page, or inside whichever widget is open. That is what "add" has
always meant.

An admin sees the chip on **every** widget, including empty ones — the way in
has to exist before there is anything behind it. A reader only sees it where
there is something behind it, because an empty level is a blank page and a
dead end.

Everything else follows from one rule: a page saves **one array**, so an edit
three levels down is rebuilt into the whole tree on the way out. Adding,
deleting, renaming, reordering, resizing, restyling and re-ordering columns
all go through the same `atLevel` funnel — a site that missed it would write
a child's change onto the page, silently, which is why a test asserts nothing
reaches past it.

Deleting a widget somebody is inside puts them back at its parent, not in
front of a blank page. Changing page leaves the widget behind.

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
- **A row you typed keeps every widget you put in it.** When they don't fit
  across it they wrap onto a second **line** inside the same row band. A row
  is a band, and a band can hold more than one line.
- **A widget you never gave a row still flows** — blank is row 1 for packing,
  but it isn't somebody *saying* row 1, so it spills into the next row as it
  always did, ahead of whatever was already assigned there.

A row is as tall as its tallest widget, so rows line up.

**Each row sorts itself.** The **#R** box is a widget's position *within* its
row — the page's own order decides which row things land in and how the page
reads overall; this is the second question. Renumbering a whole page to move
the third KPI in front of the second is not an edit anybody should have to
make.

Blank is a real answer: an unnumbered widget keeps the place the page order
gave it, **after** the numbered ones. So numbering a single widget moves that
one and disturbs nothing else in the row.

#### Less data moves nothing

A widget with an empty sheet behind it draws short. If the layout reads that
height and decides something different, the page rearranges itself because a
tab happened to be empty on a Monday — and nobody can tell whether they're
looking at a design or at today's weather.

So **no widget can be pushed out of the row it was put in.** Two rules:

- **A row you typed can't be vacated.** It wraps onto a second line inside
  the same band; it never evicts.
- **A height you typed is used as typed**, not measured back off the screen.

There's a test that packs the same page against a hundred different sets of
measurements and asserts every widget came out in the same **row** each time.

What a quiet day *may* do is let something use the space beside a widget that
drew short — see below. That's the space being used, not the layout coming
apart, and it's bounded: the most that can happen is a widget moving from
beside its neighbour to underneath it, **inside the row it was put in**.

The room at the end of a row is offered **per line**: the end of the first
line is a different rectangle from the end of the second.

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

The **W** box shows the width that is actually **in force**. A pixel width
only applies in pixel mode, so a number left behind by switching back to a
preset used to sit in the box looking like it was doing something — the box
is blank there now, and typing in it switches the mode back.

While arranging, the pill shows **what is drawn**, not what was typed, with a
`78%` or `stacked` chip when this screen isn't the one the page was arranged
for. The **W** and **H** boxes still hold the design numbers, and the dotted
"what fits here" boxes report in those same design numbers — the point of
that label is that it tells you what to type, and a number you can't type is
worse than no number.

#### The header comes to you

A dashboard is long, and the controls that decide what it says are at the top
of it. Scroll past the header and a small **Filters** pill appears at the
bottom of the screen; press it and the control bar opens where you are —
without losing the row you were reading. It carries a count when buttons are
active, so it says whether the page is narrowed as well as offering to change
it.

It holds the **real** control bar, not a copy: a second one would drift, and
the one that drifted would be this one. Scrolling back up to the actual header
puts the stand-in away by itself.

Whether the header is on screen is answered by an observer on a one-pixel
sentinel at the bottom of it — the browser answers "is this visible" without
waking React on every frame of every scroll.

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

A rectangle of empty canvas is space whether the widget above it was sized by
hand or by its own content — refusing to use it unless somebody typed a number
would leave a hole on every page that was never sized in pixels, which is most
of them.

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

**The heading stays put while the body scrolls under it.** Shrink a widget far
enough and the card becomes a scroll container; without this the title, the
count beside it and the export button scrolled away with the chart, and a
widget whose name you have to scroll back up to read is one you cannot tell
apart from its neighbour. Shrinking a widget is exactly when the label matters
most, and exactly when it used to disappear.

One CSS rule does it for every widget, found by what the card's first child
*contains* rather than by a marker class on thirteen components — so it works
on the ones nobody has touched since, and on the next one somebody writes. It
matches both shapes a heading is written in: the usual row with a count or a
button beside the title, and the canvas furniture (a note, an image, a
countdown) where the heading is the child itself.

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

**Setup is buttons too**, on the four widget editors long enough to need it:

| Widget | Buttons |
|---|---|
| **Chart** | Data · Style · Advanced |
| **Table** | Rows · Columns · Detail · Files · Pills |
| **Trend** | Data · Series · Size · Readings |
| **Pivot** | Layout · Axes |

The shorter editors — a leaderboard, a gauge, a scatter — are deliberately
left as they are. A row of buttons over a sixty-line form costs a line and
saves none. And a style with no options of its own says so rather than
showing an empty panel, because an empty panel behind a button reads as a
bug, not as "there is nothing here".

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

### How wide a dropdown opens

A control has two widths, and they are not the same measurement. The button
says **"Model: 3 selected"** and has to fit in a bar; the list behind it holds
**"SPLENDOR PLUS DRUM BRAKE ALLOY WHEEL"** and does not.

That list was one hard-coded 256px, so every value long enough to matter
arrived with its end cut off — and a truncated option is one a reader cannot
choose between and one that may as well not be there.

**Open list width (px)** sits beside the control's own width, on the
multi-choice control — the only kind with a list of its own to size. Blank is
the same 256 it has always been, so nothing on a page moves until somebody
types a number. It is bounded 160–720: a menu narrower than a phrase is the
problem it was added to fix, and one wider than most windows is not a menu.

It is also **never narrower than the control it drops from**. A 320px button
with a 160px list under it reads as a rendering fault rather than as a choice,
so the button's width is the floor and the 720 cap still wins over both.

And a wider menu **wraps** its values rather than truncating them further out.
Widening it was asked for so the value could be read; cutting it off at the
new edge would have missed the point.

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

**A button reaches the same three ways.** It says what it wants in
*conditions* rather than in one column — which is how one button has always
been able to narrow several tabs at once — but a tab nobody wrote a condition
for used to be out of its reach entirely. Now it gets the same selector, the
same **+ link another tab**, the same key bridge and the same coverage strip:

- **Only the tabs its conditions name** — the default, and what every button
  did before.
- **Every tab with a column of that name** — each condition also applies
  wherever that column exists.
- **The whole page — by column, else by key** — plus a bridge from the
  button's own tab, built after every other control has run, exactly as a
  dropdown's is.

A link on a button can say *which* of its columns it stands in for. A button
naming a single column isn't asked: the link applies to every condition, and
one *is* every. A tab bound by hand keeps that binding even when the reach
spreads — guessing over an explicit instruction is never right.

The three rules that stop it lying hold here too: a tab already matched by
column is never *also* intersected with the keys, a tab sharing neither is
left completely alone, and the coverage strip is computed by the filter
engine itself.

The **global search box** is the one real exception — it matches any cell on
any tab.

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
| **Workflow Pipeline** | A funnel of stages, each a label + colour + its own condition set, with optional trend line and a pop-up of KPIs, a pivot and a leaderboard. Click a stage, a KPI, a leaderboard row or a pivot cell to drill in — or, where a stage has stages of its own, to open them. |
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
| **Stat Grid** | Several KPIs in **one** card, each with its own rule, its own sparkline, and its own answer to *compared to what?* — the page's unfiltered figure, the period before, a second rule, or a target. |
| **Bullet Chart** | Many targets on one shared axis. A bar for what happened, a tick for what was promised, and **poor / fair / good bands** behind both — eight of them scan in the time one gauge takes. |
| **Top Movers** | What **changed**, not what is biggest. Two windows on a date column, or two rules you write. Ranked by absolute change by default, with a floor, so "1 became 3" cannot lead the list. |
| **Waffle / Pictogram** | A share **counted** rather than judged: 38 squares out of 100, in squares, dots, or emoji. Largest-remainder apportionment, so the squares always add up to the grid. |
| **Calendar Heat Map** | A year of days as a grid — one band of weeks, or twelve month blocks. Shows the rhythm and the **gaps**: the dead Sundays, and the fortnight nobody filled the sheet in. |
| **Timeline / Gantt** | A bar per row, from a start date to an end date (or a duration, or a fixed length). **Overlap becomes a shape.** Open-ended rows run to today and say so rather than disappearing. |
| **Cohort / Retention** | Entities pinned to the period they first appeared in, tracked across the periods after. The unlived bottom-right is **left blank**, not reported as a collapse. |
| **Box Plot / Spread** | The whole distribution per group — median, quartiles, Tukey whiskers and **every outlier as its own dot**. Two branches with the same average stop looking identical. |
| **Sankey / Flow** | How rows move from one column's values to another's, across two stages or several. Quantity is **width**, so nothing has to be read off an axis. |
| **Word Cloud** | The one widget that can read *Remarks*. Counts words, pairs of words or whole phrases, with a stop-word list you can see and edit. Click a word to filter to the rows containing it. |
| **Column Profile** | Not about the business — about the **sheet**. Fill rate, type, distinct values, top values, and the finding nothing else surfaces: values that differ only by case or spacing. |
| **Note / Heading** | Text you write, on the canvas — a section heading, a caption, a callout, a banner or a quote. Markdown-lite, parsed to elements and **never** interpreted as HTML. |
| **Image / Media** | A picture, logo or diagram from any image link, including a Google Drive share link. Optionally with no card around it. |
| **Countdown / Clock** | Time left to a date, time since one, or the time now. Colours change as a deadline approaches, and it redraws only as often as a digit can change. |

### Two shapes about relation, not size

Most charts answer *how big*. Two of them answer *how far apart* and *what
sits inside what*, and the catalogue had neither.

#### Dumbbell / Gap

*"Quoted 140, booked 96"* per branch. A grouped bar chart draws that as six
bars and asks you to subtract them in your head, twelve times. A dumbbell
draws the **gap** — two dots and the line between them — and the eye reads the
widest line first, which is the branch the meeting is actually about.

The same shape answers before-and-after, target-and-actual, this-month against
last, and plan against spend. What they have in common is that the question is
the *distance*, not either end.

- **The rows are ordered by the widest gap** by default, which is the reason
  the chart exists. Any other order buries the finding.
- **The gap is signed** — 96 → 140 and 140 → 96 are the same distance and
  opposite meanings — but the *ordering* uses the unsigned distance, because a
  branch that fell 40 is as interesting as one that rose 40.
- **The cap falls after the ordering.** Otherwise "the twelve widest gaps"
  would mean "the widest gaps among whichever twelve groups were biggest".
- **The axis is not anchored at zero**, and that is deliberate: the chart is
  about a distance, and forcing zero in squashes every gap into the same short
  line. It is the one case where a truncated axis is the honest choice, because
  there are no bars claiming to be proportional.
- **The gap is written as a number too**, green up and rose down. Reading a
  distance off a line is exactly what this chart saves you from.

Drawn by hand rather than through the chart library: there is no chart type for
this, and the library version is a stacked bar with a transparent base plus two
scatter series — three components pretending to be one shape, each with its own
idea of the axis.

#### Sunburst Rings

Region, then branch, then model. A treemap answers *which is biggest* and loses
the levels; a pivot keeps the levels and makes you read forty numbers. A
sunburst keeps both: the ring says which level, the sweep says how much, and a
wedge is **always exactly as wide as its children add up to**.

Up to four rings. The nesting is the **pivot table's own** — the same
`pivotTree` that already sorts every level, buckets every column and knows
about measures. Rebuilding it here would be a second hierarchy to disagree with
the first.

- **A wedge carries its whole path.** Hovering says `West › Pune › SPLENDOR`,
  and clicking filters by *every* level above it — otherwise clicking "Pune"
  inside "West" would filter to every Pune in the sheet.
- **Colour comes from the top-level ancestor**, in lighter shades outward. A
  palette colour per wedge would make a region and one of its branches look
  unrelated, which is the one thing a ring chart is drawn to show.
- **The middle holds the total**, or whatever is under the pointer with its
  share of everything. A ring chart with nothing in the middle has a hole where
  its own headline should be.
- **A wedge too thin to see is left out and counted** — "3 too small to draw" —
  rather than drawn as a hairline that cannot be hovered, labelled, or told
  from the stroke beside it. It still takes its room, so the ring does not
  shift. A **negative** value is not counted there: it is impossible to draw,
  not too small to see.
- **The editor will not let a hierarchy have a hole in it.** Ring three is
  disabled until ring two has a column, and clearing a ring clears the ones
  outside it.

### Compared to what?

The single most useful thing a dashboard can add to a number is a second
number. **412 enquiries** is not information. *412, up 18% on the month
before, against a target of 500* is.

A **Stat Grid** puts several of those in one card — six small figures as six
separate KPI cards is six borders, six titles and six shadows for a group
that is read as a group. Each stat carries its own rule, its own format, its
own sparkline, and its own baseline, because the honest baseline differs by
metric:

| Compared to | What it means | Use it for |
|---|---|---|
| *Nothing* | The number stands alone | A stock level, a headcount |
| *Unfiltered* | The same rule, before the page's filters | Showing what a filter is hiding |
| *Previous period* | The last N days against the N before | Anything with a date column |
| *Another rule* | The same figure under a second condition set | Financed vs cash, this branch vs that |
| *Target* | A number somebody committed to | Anything with a plan behind it |

Three rules keep the comparison honest, and all three are tested:

- **Growing from nothing has no percentage.** 0 → 5 is not "+500%" and it is
  certainly not "+∞%". It shows the absolute change instead.
- **Only a "previous period" stat is windowed.** A stat asking for no
  comparison counts everything the page is showing. Silently narrowing it to
  thirty days because a *sibling* stat wanted a trend would make the same
  metric read differently depending on what sits next to it.
- **Progress is drawn against a target and nothing else.** A bar creeping
  across because last month was smaller says nothing anyone can act on.

**Lower is better** is a per-stat switch, not cosmetic: it decides whether a
fall is drawn green or red, and getting it backwards on *days to deliver*
turns an improvement into an alarm.

### Many targets, one axis

A gauge answers "how far to the target" using a quarter of a card and a
semicircle. That is fine for one metric and hopeless for eight — which is
what a review meeting actually has, and the question is which of the eight is
in trouble.

A **Bullet Chart** answers that. One horizontal line per metric: a bar for
what happened, a hard tick for what was promised, and shaded **poor / fair /
good** bands behind both. Eight of them stack into the height of two gauges
and scan in one pass, because every bar shares an axis and the ticks line up.

The bands do the work. Without them, 84% of target is a number; with them it
is *"comfortably inside fair, nowhere near good"*, which is a sentence a
meeting can act on. Bands are percentages of the target by default — so
moving the target moves them — or fixed numbers where the thresholds are the
real decision. A target can itself be **measured** from the rows, which is
what "beat last year" means.

The axis always runs past the target (**headroom**, 15% by default), because
a bar pinned to the right edge cannot be seen to have *overshot*, and
overshooting is the outcome everyone most wants to see.

### What changed, rather than what is big

A leaderboard answers "who is biggest". After the first week nobody reads it,
because the answer is the same every week and everybody already knows it.

**Top Movers** answers the question that stays interesting: what is
*different* from last time. Two windows on a date column (the last 30 days
against the 30 before), or two condition sets you write.

The trap is that percentage change is dominated by tiny numbers — a dealer
who went from one car to three is up 200% and will out-rank the branch that
went from 400 to 480 every single week. That is not a finding, it is
arithmetic noise. Two defences, both on by default:

- Ranked by **absolute change**, not percentage. +80 beats +2.
- A **floor**, checked against the *larger* side. Checking the smaller one
  would drop exactly the groups that collapsed to nothing, which are the most
  important movers on the list.

Risers and fallers are shown as two columns rather than one merged list: in a
good week a merged list shows nothing but gains, and *"nothing fell"* is then
a claim the widget never actually checked. Values that are **new** or that
have **gone** are labelled as such rather than shown as a percentage from
zero.

### A share you can count

A pie asks the reader to judge an angle, which people are famously bad at —
38% and 42% are the same wedge to almost everybody. A **Waffle** asks them to
count squares instead, and 38 out of 100 is not a judgement at all.

The arithmetic that matters is the rounding. Naive rounding of five shares to
a hundred squares routinely produces 99 or 101, and a waffle that does not
fill its own grid is a waffle nobody trusts. This uses **largest-remainder
apportionment** — the method parliaments use to turn vote shares into whole
seats — so the total lands exactly, every time.

Squares, rounded squares, dots, or emoji (❤️ ⭐ 🧍 🚗 ₹). Overflow **merges**
into one block at full weight rather than being dropped, and the card says
what one square is worth — a waffle without that is a proportion with its
units filed off.

### Three shapes a date column makes that a line chart cannot

A trend line over a year says whether the number went up. It cannot say that
nothing at all happens on Sundays, that one fortnight in June is missing
entirely, or that four deliveries were promised for the same week.

**Calendar Heat Map** — a span of days as a grid, either as one band of weeks
(every row is one weekday all the way across, which is the whole point) or as
twelve month blocks. Zero is drawn as *nothing*, never as the palest shade:
a faint tint on an empty day is how a calendar ends up looking uniformly busy
when half of it is nothing at all. Five countable steps rather than a smooth
ramp, because a legend of five swatches is a legend somebody uses. Click a
day to filter the page to it.

**Timeline / Gantt** — one bar per row, from a start date to an end date, a
duration column, or a fixed length. Overlap becomes a *shape*, which is how
anybody spots a capacity problem without arithmetic. Rows with no end date
are **not dropped** — an open job is usually the most interesting row on the
chart, so it gets a bar that runs to today, fades out at its right edge and
is counted as still open. A row whose end precedes its start is flagged
rather than drawn backwards. Optional lanes, a today marker, and colour by
any column.

**Cohort / Retention** — a sales sheet answers "how many did we sell in
March" easily and "did March's customers ever come back" not at all. Every
entity is pinned to the period it *first* appeared in — that is its cohort,
for good — and each column counts how many of that same cohort showed up
again N periods later. Reading down a column compares like with like; reading
across a row follows one group as it decays.

Two things it is careful about:

- **The bottom-right is not real.** A cohort from last month has not *had*
  six months to come back, and a 0% there invents a collapse that has not
  happened. Those cells are left blank, outlined in a dashed rule.
- **Period 0 is 100% by construction.** It is shown because its *size*
  matters, but the colour scale is never normalised on it — otherwise every
  grid is one dark column and a wash of nothing.

Periods are counted by stepping the calendar, not by dividing milliseconds:
months are not a fixed length, and dividing by 30 puts the same pair of
months three periods apart in one year and two in another.

### The shape of a column, not its total

Every other chart reduces a group of rows to **one** number. That is what a
bar chart is, and it is why a bar chart can say two branches are identical
when one sells forty steady cars a month and the other sells two and then
thirty-eight.

**Box Plot / Spread** shows the whole group at once: the middle half as a
box, the typical range as whiskers, and every row outside that range as its
own dot. The dots are not noise to be cleaned up — they are the deals worth
asking about. Tukey's convention throughout: a whisker stops at the last
*real* value within 1.5 interquartile ranges of the box, not at 1.5 IQR
itself, which would be a whisker pointing at nothing. A group with fewer rows
than the minimum is **listed rather than drawn**, because three numbers have
no meaningful quartiles.

**Sankey / Flow** — a pivot can tell you 340 enquiries came from Referral and
210 were Lost. What it cannot tell you, without the reader tracing a finger
across a grid, is how much of the Referral column *ended up* in the Lost row
— and that is the only question anybody was asking. A Sankey answers it by
making the quantity a **width**. Two stages, or as many as the story needs.
Only additive measures are offered (count, sum, count-where-filled), because
a node's height is the sum of the ribbons entering it and an average would
make the picture arithmetic nonsense.

**Word Cloud** — every sheet has one column nothing can chart: *Remarks*,
*Feedback*, *Reason for loss*. It holds the most specific information in the
file, and grouping by it produces four hundred bars of one. Counting **words**
instead makes it tractable: "waiting for finance approval" and "finance not
approved yet" are two distinct values and one recurring theme. Single words,
pairs of words, or whole phrases. Sizes are **square-rooted**, because type
is perceived by area and a linear map lets the top word swamp the card. The
stop-word list is visible and editable — every business has its own noise
words, and a hidden list would be a hidden edit to the finding. A word counts
once per row however often that row repeats it, or a single ranting remark
outvotes forty terse ones. Click a word to filter to the rows containing it.

**Column Profile** — the one widget whose subject is the **sheet** rather
than the business. Every dashboard here is downstream of a spreadsheet people
type into by hand, so the interesting failure is never a bug in a chart; it
is a column that is 40% blank, a date column with eleven values that are not
dates, and a Status column with both `Delivered` and `delivered ` in it. None
of those are visible from a chart — a bar chart of a column with a trailing
space just quietly grows a second bar.

Per column: fill rate, guessed type, distinct values, uniqueness, the
commonest values, numeric or date statistics, and the finding that catches
the most real problems — **values that differ only by case or whitespace**,
reported as groups so you know which spellings to merge. Findings are
sentences (*"Only 41% filled"*, *"Nothing newer than 94 days ago"*), each with
a severity, and *Problems only* turns a wall of green into a short list of
things to fix.

Typing a column is stricter here than everywhere else in the app on purpose.
The shared parsers are deliberately forgiving — they have to be, since one of
them turns `₹1,20,000` into a figure — but that forgiveness reports the order
reference `INV-4471` as the number 4471, and the amount `109` as a date in
the year 109. The profiler checks the *shape* first, which is what tells an
amount from an anniversary.

### Text on the canvas

A dashboard that cannot be annotated is a dashboard that gets explained in a
separate email. *"These figures exclude the Nagpur branch until the 15th"* is
the most important sentence on some pages.

A **Note** is text you write, in five kinds: a *section heading* (a rule and a
title, deliberately **not** a card — its whole job is to separate what is
below from what is above), a plain caption, a tinted *callout* with a tone,
a full-width *banner*, or a *quote*.

It understands a small amount of Markdown — headings, `**bold**`, `*italic*`,
`~~struck~~`, `` `code` ``, bullets, numbered lists, `- [ ]` checklists,
`> quotes`, `---` rules and `[links](url)`.

The obvious implementation — run the text through a Markdown library and hand
the HTML to `dangerouslySetInnerHTML` — is the one thing this must not do.
The text is written by an admin and read by everybody, so an admin who pasted
something they did not write would be injecting script into every other
user's session. Instead it parses to a **tree of tokens** which React renders
as real elements. Nothing is ever interpreted as HTML at any point, and links
are checked against a scheme allow-list, so a `javascript:` URL keeps its
label and loses its href rather than becoming a live link.

**Image / Media** puts a floor plan, a price list or a logo next to the
figures about it, through the same Drive-link handling as every other
admin-supplied image. Deliberately an *image* and not an embed: an `<iframe>`
would let any admin run another site's JavaScript inside every reader's
session, which is not a trade worth making for a widget that shows a
diagram.

**Countdown / Clock** — a month-end target is a different thing on the 3rd
and on the 28th. *68% of target* is comfortable with three weeks to go and an
emergency with two days. Counts down to a date, up from one ("days without an
incident"), or shows the time now. Colours shift as the deadline approaches —
the one place a colour change is information rather than decoration — and it
redraws only as often as a digit can actually change: once a minute at a day
out, once a day at a month out, rather than 86,400 times to change one digit.

A bare date means the **end** of that day, because a deadline of "the 31st"
is met by something done at five in the afternoon on the 31st — and it is
parsed as local midnight rather than UTC, or everybody east of Greenwich gets
a deadline that expires the evening before.

### Widgets that read no rows

A note, an image and a countdown carry no data of their own. They are still
sized, styled, ordered and arranged like everything else — but their editor
hides the tab picker, the blend, the per-widget controls and the row
conditions, because a filter attached to a heading is a setting that cannot
do anything, and offering it anyway is how somebody learns the panel does not
mean what it says.

They are also the only widgets that can be added to a page with **no
spreadsheet connected yet**, so a page can be given its headings before it
has its numbers.

### More ways to measure

Every widget that offers a calculation now offers the ones that describe a
**distribution** as well as the ones that describe a total. An average is the
wrong summary the moment a column has a tail — and in a sales sheet it always
does, because one fleet order drags the "typical" invoice somewhere no
invoice has ever been.

| Group | Measures |
|---|---|
| **Counting** | Count of rows · where filled · where empty · distinct · % filled · % empty |
| **Totals** | Sum · Average · Minimum · Maximum |
| **The middle** | **Median** · Most common value |
| **The tail** | 25th / 75th / 90th / 95th / 99th percentile |
| **The spread** | Interquartile range · Range · Standard deviation · Variance |
| **Position** | First value · Last value |

Percentiles **interpolate** between the two neighbouring observations rather
than snapping to the nearest: a p90 that leaps as one row is added reads as
noise, where an interpolated one moves smoothly. Standard deviation and
variance are population rather than sample, because a dashboard is describing
the rows it has and not inferring a wider population from a sample of them.

*Most common value* is deliberately numeric-only. Every aggregation has to
return a number — that is what a KPI, a bar and a gauge all consume — so a
column of names reports the same nothing that `sum` already reports for it,
rather than a plausible-looking `0` that secretly means "West".

### More ways to write a number

| Group | Formats |
|---|---|
| **Plain** | Plain · Thousands separator · One decimal · Two decimals |
| **Percent** | Percent · Percent to one decimal · Always-signed percent |
| **Rupees** | ₹1,23,456 · ₹1.2 Cr · ₹12.5 L · ₹1.25 Cr |
| **Other currencies** | $1,234 · $1.2M · €1,234 · £1,234 |
| **Deltas** | Always signed (+12 / −12) · Multiple (1.4×) |
| **Finance** | Accounting — negatives in brackets, no minus sign to miss |
| **Rank** | Ordinal (1st, 2nd, 3rd — and 11th, 12th, 13th) |
| **Duration** | From seconds / minutes / hours → `2h 14m`, `2d 6h` · Days |
| **Size** | File size (1.4 MB) |

Money is grouped the way its **own** currency groups it: a dollar figure
written `12,34,567` is a typo to everyone who reads dollars, and lakhs are
equally wrong in euros. Durations show **two units, never three** — `2h 14m`
is something you can hold in your head, `2h 14m 09s` is a stopwatch reading,
and the seconds cost the minutes their legibility.

### More colour ramps

Eighteen ramps for the heat map, the calendar and the cohort grid, which all
read from the same list so the same number is never two different colours on
one page. Thirteen stay inside one hue and move only in lightness — a ramp
that also changes hue reads as *categories* rather than as a quantity, which
is the opposite of what a heat map is for. Four long ones (*Sunset*, *Ocean*,
*Forest*, *Magma*) pass through a second hue, which is worth having where the
values span orders of magnitude and a single-hue ramp runs out of
distinguishable steps long before the numbers do.

Text on a shaded cell picks dark or light ink by **perceived** lightness, not
by a channel average — the eye is far more sensitive to green than to blue,
and an average calls pure blue "mid-bright" then puts dark text on something
almost black. Every step of every ramp is tested for contrast against the ink
it will be given.

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

### Every widget and every control has its own rule

A few widgets could already be told to count only some rows — a KPI, a gauge,
a leaderboard, a pipeline stage. Each applied its own conditions in its own
component, in its own field, at its own point in the chain, so the same
sentence meant four slightly different things and the other eleven widgets
couldn't say it at all.

Now every widget has a **Conditions** button, and every control has *Only
offer values from rows where*. Both use the same condition builder as
everything else, and both are marked with how many they hold, so you can see
which widgets carry a rule without opening any of them.

**On a widget it's a rule, not a filter.** It's part of what the widget *is*:
it runs before the widget's own controls, page filters and drill-downs narrow
what's left, and nobody looking at the page can switch it off. *"This table is
the overdue ones"* is a different widget from *"this table, filtered to
overdue"* — the first still says what it is when the page is reset.

**On a control it narrows what the control OFFERS**, not what it filters. A
control that changed the page while nothing was selected in it is one nobody
could account for. A `DSE` dropdown can list only the ones still employed
without hiding anybody's old rows from the page.

Four details:

- It runs in **one place** — where the page assembles a widget's rows — rather
  than inside fifteen components. That's what makes it available to all of
  them without any of them learning anything. Both the filtered and the
  unfiltered rows go through it, so a widget set to ignore page filters still
  obeys its own rule.
- It's a **separate field** from the `conditions` a KPI already had. Reusing
  that name would apply the old rule twice on the widgets that have it, and a
  filter that silently runs twice is only harmless while every operator is
  idempotent.
- A **half-written condition is ignored**, not failed. Somebody is mid-edit;
  emptying their widget while they pick a column is a fright, not feedback.
- **ALL or ANY**, your choice, in both places.

A widget's rule can only ask about its own tab — rows of one tab can't answer
a question about another, and treating an unanswerable question as *no* would
empty the widget. Buttons are the one thing without this: a button already
says what it wants in conditions and offers no values, so it has nothing to
narrow.

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

### Print, and Save as PDF

The people who decide things are not the people looking at the screen. A
dashboard that cannot leave the browser gets screenshotted into a slide — and
a screenshot has no record of what it was showing.

The **printer button** in the page header opens the browser's own print
dialogue, which is also its *Save as PDF*. That is deliberate: the export
**is** the page, so there is no second drawing of it to fall behind the first.

**What the paper gets that the screen does not** is a header naming the page,
the moment it was taken, and **every narrowing that was in force**:

```
Sales — August
Vehicles · Quotations — printed 29 Aug 2026, 10:05

Branch: Pune · Model: A, B · Amount: up to 500 ·
Dealer: B2D (fixed) · Drilled into: West · Ravi (drill)
```

A printed chart reading 412 is not a fact — it is a fact *about* a filter.
Print it without the filters and it is a number somebody quotes back at you in
six weeks, wrongly.

Three things make that header honest:

- It reads the **effective** values, so a control the admin **fixed** appears
  and says so. It is a rule of the page the reader never sees and cannot turn
  off, which is exactly what a printout has to disclose.
- A **drill** appears too, marked as one. It is the filter the reader made by
  clicking, and the only one nothing in the bar shows.
- Nothing applied says **"No filters applied — the whole dataset"** rather than
  leaving a blank, because a blank reads as *the filters did not print*.

**What the paper does not get** is the chrome: the sidebar, the tab strip, the
Add palette, the arrange banner, the header buttons and the edit split. They
exist to *change* the page, and on paper there is nothing to change. It is one
`no-print` marker put on the real elements — a stylesheet full of class names
guessed at from a distance is dead CSS that looks like a working rule.

Four details that decide whether a printout is right or merely short:

| | |
|---|---|
| **Pinned heights are released** | 320px is a decision about a screen; on paper the constraint is the sheet, and a pinned height prints a chart cut in half |
| **Everything that scrolled expands** | otherwise the sheet shows the first screenful and drops the rest, and a printed table is *wrong* rather than short |
| **No card is split across two sheets** | two halves of a chart, neither of which is a chart |
| **Colours print exactly** | a red bar *is* the finding, not decoration the browser may economise away |

The sheet is **landscape**, because the layout model is a row of widgets that
wraps and portrait turns every two-across row into two pages. The print
dialogue still lets anyone choose otherwise.

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
every widget type gets them without any widget knowing controls exist.

### The Analytics layer

A chart shows what happened. This is the pane that says what it **means** —
the direction under the noise, the range you meant to stay inside, how far
from typical the worst one is, where the running total gets to.

It sits with the reference lines in a chart's **Setup**, and everything in it
is worked out from the **bars the chart is drawing** — not from the rows
behind them. An average of rows a limited chart never showed would be an
average of numbers the reader cannot see.

#### Lines that move with the data

The four a chart always had — average, median, highest, lowest — plus a fixed
value, and now:

| | |
|---|---|
| **A percentile** | any, interpolated the way a spreadsheet's `PERCENTILE` does, so a number checked against the sheet agrees |
| **Average ± n σ** | negative is the lower side; the spread is the *population* one, because the bars **are** the population, not a sample of bars |
| **Total of the bars** | |
| **% of the average** | "120% of typical" as a target that keeps being true |

#### Bands, not two lines

"Between 80 and 120" is a different question from "at 100", and two lines make
the reader do the shading in their head. A band can be two values you choose,
**lowest-to-highest**, **average ± n σ**, the **middle half** (IQR) or the
**middle 80%** (10th–90th). It is drawn *under* the marks — a band is the
ground a bar stands on. Typed the wrong way round it still shades: nobody
means an empty range by entering 120 and then 80.

#### A trend line

**Straight line** is the least-squares fit — what a ruler laid across the
chart would say. **Moving average** follows the shape instead of replacing
it, for when the trend is not straight.

It trails rather than centring, so the line for March does not already know
about April, and the first bars have **no** value rather than an average of
fewer — a "3-month average" made of one month is not a 3-month average. A gap
breaks it rather than being skipped, and the line is not joined across the
break.

There is deliberately **no polynomial fit**. A cubic through fifteen points
fits the noise, looks authoritative and forecasts nonsense, and a chart that
makes a reader more confident than the data warrants is worse than no chart.

Two bars do not get a trend — that is the two bars joined up — and a moving
average longer than the chart draws nothing, so neither is offered.

#### A running total

Where the chart has got to, bar by bar, either as a **total** or as a **% of
everything**. The percentage gets its own right-hand axis: 100% beside 14,000
flattens the line onto the floor. The Pareto chart has always had one wired
into it; this is the same question anywhere the order means something.

#### Where it applies

A trend and a running total need a **series to run along**, so they are
offered on **bar, cylinder, arrow, line, step and area** and nowhere else. A
trend through a histogram is a line through a distribution; a running total
over a waterfall *is* the waterfall. Reference lines and bands apply wherever
there is an axis. The editor says which of these a style ignores rather than
accepting a setting and dropping it.

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

### A pipeline inside a pipeline

A real process is not one row of boxes. **Booked** is a stage of the sale
*and* a process of its own — documents, finance, insurance, RTO — and drawing
those four beside the six stages of the sale makes ten boxes that are not the
same kind of thing.

So a stage can own stages. **Add sub-stage** inside any stage in the editor,
up to four levels deep; it's the same form as a top-level stage, because a
sub-pipeline *is* a pipeline.

The editor lists stages **one line each** — colour, icon, name, and a summary
like `2 rules · 3 inside` — and opens **one at a time**. Six stages with their
conditions, KPIs and sub-stages all unrolled was a form with no visible end,
and the thing you actually do is find one stage, not read them all. Inside an
open stage the rest is a row of buttons: **Rules**, **Pop-up**, **Inside**.
Adding a stage opens it at Rules, which is the one moment you do want it
unrolled.

A stage with no conditions counts its *entire* tab, so the summary says
`every row` rather than `0 rules` — it looks like a half-finished stage
otherwise. And a stage with sub-stages isn't offered a **Pop-up** tab at all,
since that pop-up can never open.

**Pop-up** splits the same way, into **KPIs**, **Pivot** and **Leaderboard** —
three separate things that were two hundred stacked lines under one stage, and
a stage is already one of six. The KPIs are their own accordion inside it: one
line each (`Sum (numeric) · Amount · whole stage`), one open at a time, and a
new one opens as you add it. A KPI with no conditions measures the whole
stage, which is what the field under it has always promised, so that is what
the line says.

The **Pivot** and **Leaderboard** buttons carry a dot rather than a count —
each is set up or it isn't, and "1" would be a number that never changed.

#### A KPI that isn't about the stage

A pop-up is usually about the stage you clicked: 40 booked, of which 22
financed and 9 delivered. Everything in it narrows the same rows, which is
what makes the numbers agree with the box above.

But not every number worth putting there is about the stage. *"Booked this
month, against a target of 300"* needs the 300; *"12 of these, out of 4,000
enquiries all year"* needs the 4,000. Those are context, not contents, and
scoping them to the stage makes them **wrong**, not merely unhelpful.

So each KPI picks one:

| | |
|---|---|
| **Rows in this stage** | the default, and what every KPI did before this existed |
| **Its own rows — ignores the stage** | starts from a tab of its own (the stage's, unless you pick another) and only its own conditions |

An independent KPI announces itself: its caption reads `12 of 4,000 · own
rows` rather than a bare figure that would be read as the stage's. And
clicking it filters the dashboard by **its** conditions alone — filtering by
the stage as well would contradict the number that was clicked.

Changing its tab clears the conditions written against the old one. A column
name from another sheet matches nothing, silently, and looks exactly like a
condition that legitimately matches nothing.

On the page, a stage with stages inside it says so — `↳ 3 inside` along the
bottom, and nothing else; a chip in the corner saying the same number was the
same fact twice in one box — and clicking it **opens** them. Its *siblings*
step aside; **the stage itself stays on the row**, drawn first, with an
`↳ inside` divider and then its parts. A whole you cannot see is a sum with
nothing to check it against.

The parent keeps its own box: the same share and the
same count it had a click ago — measured against *its* level, not the one you
are now looking at. A number that changed on the way in would be saying the
descent had done something to the data. It is drawn by the same renderer as
every other box, with a dashed border to mark it as the one that is open.

Above it runs the trail — `All stages › Booked › RTO`, every crumb clickable —
for getting back, or for jumping several levels at once.

Opening a stage is navigation, not filtering, so nothing on the dashboard
moves. **Clicking the parent box filters**, which is the one thing descending
takes away (it cannot open what is already open).

**A sub-stage divides the rows its parent matched.** That's what makes it one
pipeline rather than two drawn in the same card: the numbers inside always add
up to the number you clicked to get there. "Finance done" under **Booked**
counts booked rows that are financed — not every financed row in the sheet.
Percentages follow the same rule, so *each stage's own tab total* means the
rows its level starts from.

Clicking a sub-stage filters the dashboard to the **whole chain**, because
that's the set the box counted. Where the chain can be written as one AND —
the usual case — it's one chip on the page and one thing to clear. Where a
link matches *any* of several conditions it can't be: `(booked or delivered)
and financed` is not one flat condition list, and flattening it anyway would
widen the filter to rows the stage never counted. Those links travel as their
own chips and stack, appearing and clearing together.

Two consequences worth knowing:

- **Sub-stages win the click.** A stage that has both sub-stages and KPIs is
  asking two things of one press, so the editor stops offering KPIs once a
  stage has stages inside it — they'd be a pop-up nobody could reach.
- **A sub-stage stays on its parent's tab**, and the editor pins it there.
  Rows from another sheet cannot be divided by these ones; that's a separate
  pipeline widget, not a sub-stage.

Deleting a stage while somebody has it open doesn't strand them — the trail
resolves as far as it can and puts them back at the last real level.

### What a stage box says

Top row: the stage's icon on the left, its **share** as a chip on the right.
Then the stage name, the count, the optional 30-day trend, and — only where a
stage has stages inside it — `↳ N inside`.

What the share is a percentage *of* is the **Percentages measured against**
setting: the first stage of its level (funnel conversion), or the rows that
level starts from.

There is no step number. A row of boxes is already ordered left to right, and
numbering it again cost the icon its corner.

### Stage boxes are sized by the admin

**Stage box width** and **stage box height** are on the pipeline editor. Width
is bounded 80–520px and height is optional — leave it blank and a box is as
tall as its contents, exactly as it always was.

The number inside steps down a size in a narrow box rather than being clipped,
and the trend sparkline is drawn to fit the width it's given. A box at the
default width looks exactly as it did before the setting existed.

### Sorting by a column that is neither the label nor the bar

A chart grouped by branch sorts by its bars or by its labels. Neither is
what you want when the order that matters lives in a **third column**: the
branches in the order head office lists them, the stages in the order the
process runs, the models by launch date.

**Sort by → Another column** adds two more questions, and only once it's
chosen — an unused option shouldn't put two dead boxes on every chart:

| | |
|---|---|
| **Order column** | The column that holds the order |
| **Read as** | A group is many rows, and many rows are many values. This says which one it sorts on: *its first row*, *the lowest / earliest*, *the highest / latest*, *the total*, *the average*. |

*Its first row* is the default and the commonest answer, because the usual
reason to sort by a column is that the column is **the same on every row of
the group** — a branch's region, a model's launch date. A total of that
would be nonsense; the first one is simply what it says.

The column is read as a number if it holds numbers, as a **date** if it
holds dates, and as text otherwise, so a date column orders by date without
anybody being asked which it is. (The two parsers are kept off each other's
values: `01/03/2020` is a date and not the number 1,032,020, and the
quantity `42` is a number and not a day in 2041.)

A group with **nothing** in that column sorts **last** — both ways round.
It isn't the smallest or the largest; it's the one that didn't answer.

It works on charts, stacked and grouped bars, combo charts and **every level
of a pivot** — the regions in head-office order with each region's branches
in their own. Choosing the mode and then leaving the column blank changes
nothing: a half-filled form leaves the chart exactly as it was.

**Controls order their values the same way**, with two differences. There is
no "highest first", because a control's options are values and have no bar
to be highest; and there is **the order they appear in the sheet**, which is
the only order that exists for a column somebody arranged by hand and cannot
be worked out from the values themselves. Left alone, a control keeps the
order it has always had — a bucketed one stays chronological, which putting
it through the alphabet would destroy.

Both the page's controls and a **single widget's** controls have it.

### A fixed value you can pick instead of type

Every rule in this app ends in somebody typing a value into a box, which
means knowing it, spelling it, and matching the case and the stray trailing
space the sheet happens to have. Get any of those wrong and the rule matches
nothing — silently, and looking exactly like a rule that matches nothing
legitimately.

So a **sync** now also collects the distinct values of every column it
reads, and the value boxes offer them: the condition builder's, and a
control's **fixed / default value**. It's a list you can pick from *or* type
past — a rule may legitimately name a value the column hasn't got yet
("Cancelled", on a sheet where nothing has been cancelled) and a dropdown
would make that impossible to say.

The list is the **whole column**, narrowed by nothing. Somebody writing a
rule is describing what the data *can* say, not what it happens to be saying
while they write it. It's collected during the sync that has just read every
row, so it costs no extra call to Google, and it lasts until the next
sync — the same lifetime as everything else on the screen.

A column with more distinct values than the cap is left **out** rather than
truncated: a list of the first two hundred VINs is worse than no list, since
it looks complete and the one being looked for almost certainly isn't in it.
Those boxes stay plain boxes.

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

### Every emoji, in every icon field

Every icon in this app — a widget's, a page's, a pipeline stage's, a KPI's, a
flow branch's, a saved view's — was a text box with an emoji as its
placeholder. Using one meant already knowing which you wanted, finding it
somewhere else and pasting it in. In practice everybody used the placeholder,
and a workspace of forty widgets was forty identical 📊.

All **1,898** of them are now behind a `▾` beside each of those boxes, in
thirteen places. It is still a text box — pasting one straight in has always
worked and still does — with a searchable grid next to it.

**Two sources, because one is not enough.**
[`emoji-test.txt`](https://unicode.org/Public/emoji/15.1/emoji-test.txt) says
which emoji exist, in what order and under which heading. CLDR's
[annotations](https://github.com/unicode-org/cldr-json) say what people
**call** them — and that second file is what makes the picker usable, because
Unicode's own name for 🚗 is *"automobile"*. A picker where searching "car"
returns a carrot is one nobody opens twice.

Search is ranked, not just filtered:

| | |
|---|---|
| **Every word must match** | "red heart" finds ❤️, not every red thing followed by every heart |
| **Words are matched at their start** | "art" finds 🎭, not ❤️ — a search that finds "heart" inside "art" feels broken |
| **An exact word beats a prefix** | "car" legitimately prefixes *cardio* and *carrot*, so without ranking you get 💓 and 🥕 first |
| **The name beats the keywords** | which keeps "bird" ahead of "birdie" |

Beyond that: **fully-qualified sequences only** (the minimally-qualified rows
are the same pictures missing a presentation selector, and they render as tofu
on half the devices that matter); **no skin-tone variants**, because one emoji
times five tones is five rows of the same picture and this is a picker for a
widget icon; and a **recently-used row**, per browser, because a set of 1,898
is only usable when most of the time you want one of six.

Pasting a whole line — which is what happens when you copy out of a chat —
keeps the picture and drops the sentence. That uses `Intl.Segmenter`, because
an emoji is not a character: a flag is two regional indicators, a family is
four people and three joiners, and `text[0]` on either is half a symbol.

The data file is **146KB behind a dynamic import** (35KB gzipped, its own
chunk), so a page that never opens a picker never downloads it — which is
every page except an admin's, and every admin session except the one where
they set an icon.

`src/lib/emojiData.js` is **generated**. Rerun the generator against newer
source files rather than editing it, or the next regeneration silently reverts
whatever was typed in.

### Themes

**Admin → Pages → Widget theme** restyles every widget on a page at once.
Each theme is a surface, a corner radius and an accent that go together, so
picking one is *one* decision rather than six. The accent is what colours a
filter panel's selected buttons, so the panel matches the page it sits on.

| | |
|---|---|
| **Surfaces** | Plain white · Soft tint · Outlined · Elevated · Flat |
| **Light looks** | Report (olive) · Soft product · Glass · Paper · Linen · Porcelain · Mint · Lavender · Blush · Sand · Cool slate |
| **Documents** | Newsprint — a rule and whitespace, no shadows · Blueprint |
| **Dark** | Dark · Midnight · Graphite · Carbon · Deep ocean · Plum · Forest · Espresso · Terminal · Smoked glass |
| **Accessibility** | High contrast — a hard 2px border and a near-black accent that survive a projector and a bright room |

Every light theme keeps its text on the near-black the widgets already use,
so contrast is never worse than the stock card. Every dark one sets `invert`,
which switches on the neutral-text remapping in `index.css` — widgets
hard-code Tailwind `slate-*` classes, and without the remapping they would be
unreadable on a dark surface.

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


### How the chart is drawn, not just what it says

The text settings above cover the writing *around* a chart. This covers the
chart itself — and one piece of writing the text settings deliberately never
reached: the label sitting **on** a mark.

That gap was real rather than theoretical. A value written inside a bar was
hard-coded white in five places, and a pie's labels were hard-coded slate in
a sixth, so an admin with a pale palette or a dark card had no way to make
their own chart readable. A pie label was the worst of them: it is drawn by
a custom renderer, so it arrived with no class at all and *no* rule could
see it — every other piece of chart text obeyed the colour setting and the
pie's quietly did not.

Find it under **Look → Chart drawing** on any chart widget, and under
**Design → Every chart on this page** for the whole page at once.

#### Start with a preset

Eight named looks, each a complete opinion rather than a tint. Most people
click one and are finished:

| | |
|---|---|
| **Clean** | Hairline horizontal rules, solid marks. The safe one. |
| **Minimal** | No grid, no axis lines. The data and nothing else. |
| **Bold** | Thick strokes, square corners, strong rules. For a wall screen. |
| **Soft** | Translucent fills, round corners, a dotted grid. |
| **Print** | Near-black axes, hairline rules, a square white tooltip. Survives a photocopier. |
| **Graph paper** | A full graticule, for reading exact values off the chart. |
| **On dark** | Pale rules, bright marks, and a **dark tooltip** — a preset that restyles only the bars leaves a white box floating over them. |

A preset is a starting point, not a cage: change one thing afterwards and
the rest of it stands.

#### Then change the one thing you want different

Four short tabs rather than one long form.

| Tab | What is in it |
|---|---|
| **Marks** | Fill opacity · line thickness · corner radius · bar gap · point size · the hairline between two pie slices |
| **Grid & axes** | Which rules are drawn (horizontal / vertical / both / none) · rule colour and style · axis colour · axis lines and tick marks |
| **Labels on marks** | The colour, size and weight of writing that sits **on** a bar or a slice |
| **Tooltip** | Background, text, border, corners, size, and the band that follows the pointer |

Everything starts at **inherit** and says so. Clearing a control hands it
back to the page, and clearing the page hands it back to the app — which is
not the same as setting it to whatever that happens to be today. A chart
nobody has touched stores nothing and emits no properties at all, so this
feature cannot drift the look of an existing dashboard by existing.

#### The label colour has a better default than a colour

"Labels on marks" opens on **Automatic**, and that is the point of it. A
fixed white is right on an indigo bar and invisible on a pale yellow one,
and an admin who picks a palette has not agreed to check the contrast of
every colour in it. Automatic works the ink out per mark from that mark's
own fill — by *perceived* lightness, not a channel average, so a saturated
blue is correctly treated as dark — and it keeps getting it right when the
palette changes later.

Pick **one colour I choose** when the chart needs to match something else
and you would rather it were consistent than legible.

#### A live preview, drawn by the real code

The sample chart above the controls is not a mock-up. It is wrapped in
exactly the class and the properties the page will put on the widget, and
its bars get their radius and gap from exactly the functions the page calls.
If the preview looks right, the chart looks right — and if the preview is
wrong, the bug is in the thing being previewed rather than in the picture of
it. The tooltip in the corner is a standing sample rather than something you
have to hover for, because a setting you can only see by holding the mouse
still in the right place is a setting nobody discovers.

#### How it reaches the chart

The same mechanism as the text settings, and for the same reason: Recharts
writes `fill`, `stroke` and `stroke-width` as presentation **attributes**,
which any CSS rule outranks. So the grid, the axes, the tooltip, the fills
and the on-mark labels are all custom properties on a wrapper plus one rule
per decision, and no chart component had to learn that theming exists.

Two settings are props instead, because CSS genuinely cannot reach them: a
bar's **corner radius** is baked into its path data, and a **bar gap** is a
layout the chart computes from the width it was given. Those are merged
page-then-widget in JavaScript so they behave the same way the cascade makes
everything else behave, rather than being the two that mysteriously ignore
the page.

Three things this is careful about, all of them tested:

- **A page and a widget merge field by field**, unlike a *theme*, which is
  one decision and is kept entire. Twenty separate decisions should combine:
  a page that set a grid colour and a widget that set a bar radius end up
  with both.
- **The hover band is excluded from the mark rules.** Recharts builds the
  tooltip cursor from the same `Rectangle` the bars are, so it carries
  `recharts-rectangle` too — and without the exclusion, turning a chart's
  fill down to 60% quietly faded the highlight with it.
- **A histogram never gets the bar gap.** Its bins are contiguous ranges,
  and air between them says the values in the gap did not happen. That is a
  different chart, not a restyled one.

One thing it does *not* promise: point size applies to the dots on a line or
an area, not to scatter marks. A scatter symbol is a `<path>` with its
geometry baked into the path data, so there is no radius to reach — and a
control that silently did nothing on the one chart made entirely of points
would be worse than not offering it.

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

#### Several value columns, in a grouped list

A grouped list invites a question the single number can't answer: not *"the
same number again"* but **"how many, worth how much, over how many days"** —
several *different* measurements of the same groups, side by side.

The **Values** button on a pivot takes a list. Each entry is an aggregation, a
column, a label and its own number format:

```
Model        SKU               Count   Sum of Amount   Average of Days
SPLENDOR +   HSPLMDRSCFIBHG      159      ₹18,42,300               4.2
             HSPUNIRSCFIBLA       63       ₹7,11,400              5.8
```

Four things worth knowing:

- **The list starts empty, and empty means the one calculation the pivot
  already had.** A pivot nobody has touched renders through exactly the same
  code path with a list of one — so this is invisible until it's used.
- **The first measure orders the rows**, and is the only one with the faint
  proportional bar behind it. A bar drawn from one scale under a number from
  another would be a lie about both.
- **The footer re-works each total out over the rows shown** rather than
  adding the column up, because a column of averages does not add up to an
  average. It counts only the rows behind the groups that survived the cap, so
  the total always matches the list it sits under.
- **Blank labels take a sensible name** — `Sum of Amount`, `Average of Days`.

**Only in the grouped list.** A full matrix already spends its width on the
column axis, and a second number in every cell of one isn't a table anybody
can read — so the Values panel says that, and offers the switch, rather than
hiding the button and leaving you to work out why.

The CSV export follows what's on screen: one column per grouping level, one
per measure.

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
  lib/pivotMeasures.js    Several value columns down one grouped list
  lib/rowConditions.js    "Only the rows where...", every widget and control
  lib/editMode.js         The unsaved edit, merged over the saved widget
  lib/editLayout.js       The editor on one side, the thing itself on the other
  lib/sidebarPeek.js      Hover the edge, the sidebar comes; it never reflows
  lib/pageOrder.js        Pick a page up, drop it where it belongs
  lib/newWidget.js        A new widget, from the page or the panel
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
  components/widgets/*        The thirty widget types
  pages/Dashboard.jsx     One canvas; resolves refs to labels and blends
  pages/Admin.jsx         Admin shell + admin/*Panel.jsx
```

The later widget families each keep their arithmetic in `lib/` and their
drawing in `components/widgets/`, so every decision below is testable
without a browser:

```
  lib/statGrid.js         Several numbers in one card, each against its own baseline
  lib/bullet.js           Actual against target, with poor / fair / good bands
  lib/movers.js           What changed between two periods, and by how much
  lib/waffleData.js       Largest-remainder apportionment into a grid of squares
  lib/calendarHeat.js     A span of days as weeks x weekdays, or as month blocks
  lib/ganttData.js        One bar per row, on a shared time axis
  lib/cohortData.js       Entities pinned to when they arrived, tracked after
  lib/boxplot.js          Five-number summaries, Tukey whiskers, outliers
  lib/sankeyData.js       Nodes, ribbons and the geometry that threads them
  lib/wordCloud.js        Word frequency, stop-words, area-true sizing
  lib/columnProfile.js    Fill rate, types, near-duplicates - is the sheet sound?
  lib/heatColor.js        One colour ramp, shared by every shaded cell
  lib/chartVisuals.js     How a chart is drawn: grid, axes, marks, tooltip, on-mark text
  components/ChartVisualFields.jsx  Its editor, with presets and a live preview
  lib/richText.js         The small Markdown a note needs, parsed to tokens
  lib/countdown.js        Time to a date, time since one, or the time now
  components/widgets/MetricWidgets.jsx        Stat grid, bullet, movers, waffle
  components/widgets/TimeWidgets.jsx          Calendar, timeline, cohort
  components/widgets/DistributionWidgets.jsx  Box plot, Sankey, word cloud, profile
  components/widgets/CanvasWidgets.jsx        Note, image, countdown
  pages/admin/MetricEditors.jsx        Their editors, one file per family
  pages/admin/TimeEditors.jsx
  pages/admin/DistributionEditors.jsx
  pages/admin/CanvasEditors.jsx
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
