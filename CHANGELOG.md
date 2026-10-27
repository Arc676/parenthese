# Changelog

Notable changes to Parenthèse. Dates are in YYYY-MM-DD format.

## 1.5.5 (2026-10-27)

### Undo instead of confirm

- Deleting a person no longer asks for confirmation. A bar with "Undo" stays for 6 seconds, and Ctrl+Z works too (#169).
- Same for a memory and for a moment in the Life tab. Two fixes to #169 on the way: an open profile no longer closes when the deletion starts, and the tree's internal lists are up to date after an undo (#172).

### Motion

- Profile card: it appears at once on a computer, with no fade or blur. On a phone it still rises as a sheet in 240 ms, resists when pulled up, and has continuous corners where the browser supports `corner-shape` (#170).
- A memory grows from its thumbnail when it opens (280 ms, transform only). The viewer now respects reduced motion (#171).
- On a phone, dragging a memory's photo down closes it, like the profile card (#176).
- Opening a tree for the first time, the camera starts on the start person and pulls back to the family in 1.1 s while the tree draws. After an edit or a tab change, the tree shows without animation. With reduced motion, a plain fade (#181).

### Faces on photos

- Face markers are hidden by default. They show on hover with a mouse, when a name is hovered in the list, in tagging mode, or after a tap on the photo. The circles are thinner (#173).

### Phone

- Edit mode: the family tabs move to the top so the "You suggest" bar no longer covers them. The exit button reads "Done", at the height of the "+", and the bar's own close button is gone (#175).
- The family bar only moves aside when the profile card reaches it (#180).
- Tap targets of at least 44 px on touch screens, with no visible change (#182).

### Loading

- Big trees open faster with the same placement, and the list of family tabs is computed in a worker. A 3,010-person tree is usable in 1.6 s instead of 8.7 s. Tools in `tools/layout-bench` (`layout-time.mjs`, `load-probe.mjs`) (#179).
- Blurred previews (BlurHash) of photos and portraits while they load. Migration `20261027_001_apercus_flous` adds two optional columns, and a background task fills them for existing photos when the API starts (#177).
- Grey blocks while loading, instead of "Loading…" or a false empty state: the Life tab of a person with no known date, and the tree's panels (#178).

### Reliability

- Uploads from the family no longer create duplicates on a weak connection, through an `Idempotency-Key` header (#174).

### Landing

- Pages are prefetched when a link is hovered (`speculationrules`). The landing CSP in `deploy/nginx.conf` gets a second script hash for it (#183).

## 1.5.4 (2026-10-26)

### A link per family tab (#167)

- `?famille=<hinge person id>` opens the tree on that family's tab. The tab opens once the tree and its tabs are known, and again if the start person arrives later (as it does for a visitor), unless the person already picked a tab. With tabs turned off in that browser, the whole tree opens framed on the hinge person. An unknown key is ignored.
- The page address follows the open tab. In the share panel, the link to send and the invitation message follow it too, and the title names the family ("The link to send to the Garnier family").
- Same password and same access: the link picks the landing tab and restricts nothing.

## 1.5.3 (2026-10-26)

### Videos in Safari (#162)

- Media files are streamed and answer byte-range requests (`Accept-Ranges: bytes`, `206` with `Content-Range`, `416` outside the file). Safari on iOS, iPadOS and macOS needs this to play a video. Before, the whole file was read into memory and sent in one block.

### Accounts

- A password account on an OIDC instance can link its provider identity from its account ("Also sign in with …"), through a two-minute, single-use ticket (`POST /auth/oidc/link`, then `/auth/oidc/start?link=`). The identity joins that account whatever its email, and an identity already linked to another account is never moved. This is the way to switch an instance to `PASSWORD_LOGIN=false` without locking out password accounts. `/auth/me` returns `oidcLinked` (#161).
- Signing out, or deleting the account, now survives an API restart: closed sessions are kept in the `revoked_sessions` table until their token expires, and the API refuses to start if it can't load them. Migration `20261026_001_deconnexions` (#163).

### Security

- A media waiting for review is readable only by a tree admin or by the account that uploaded it. Anyone else gets the same 404 as a missing media (#160).
- Passwords are hashed with native bcrypt (`@node-rs/bcrypt`) off the event loop. Existing hashes keep working, no migration (#160).
- Frontend lockfile: zod 4.6.7, a dev dependency (#166).

### Under the hood

- Prisma 7 with the pg driver adapter. The client is generated in `backend/src/generated` and `backend/prisma.config.ts` holds the database URL for the CLI. Without Docker, Node must be ^20.19, ^22.12 or 24+, and `deploy/deploy.sh` stops early on an older Node (#164).
- Tailwind 4 for the app and the landing, through the Vite plugin. The v3 base styles the app relied on are kept, and nothing changes on screen (#165).

## 1.5.2 (2026-10-26)

### Dates follow the browser's region (#152)

- Dates follow the browser's regional variant of the interface language (en-US, en-AU, fr-CA…), falling back to fr-FR or en-GB. Before, English always used the British format. This covers every date and time shown in the app, e.g. `10/26/2026, 10:57 AM` in the review panel on an en-US browser.
- Typed dates follow the region's order and separator: `06/12/1924` in en-US, `1924-06-12` in fr-CA, `12/06/1924` in France and the UK. A year-first date is read everywhere.
- The date field also accepts a written month, in French or English: `12 juin 1924`, `1er août 1950`, `June 12, 1924`, `3 sept. 1901`. An ambiguous month (`jui`) is refused.

### Names in non-Latin scripts

- Initials for scripts without capital letters (Chinese, Japanese, Korean, Arabic, Hebrew…) are a single character: the family name for Chinese, Japanese and Korean, the first name for Arabic and Hebrew. Latin and Cyrillic keep two initials. This applies to profiles, suggestion cards, the first-photos panel and the tree.
- A birth place or a nickname in a right-to-left script no longer flips the order of the line under the name.

### Suggestion cards

- The action label (New, Edit, Delete) sits on the top edge of the card, so the name keeps the full width and both buttons stay inside the card on a phone.
- A change whose profile changed after the suggestion was sent shows "Needs checking" in place of "Edit". Any other action keeps its word ("Delete, needs checking").

### Fixes

- The quick buttons to add a parent, partner, child or sibling in a profile's Info tab are dashed chips, like "+ Nickname" in edit mode (#154).
- The notice after adding someone or sending changes takes the width it needs on a phone, instead of four lines in a pill, and appears without animation (#156).
- The counter of pending suggestions on the account picture is round for a single digit.
- Backend dependencies: ip-address 10.7.4 (#144) and fast-uri (#155), for known security issues.

### For self-hosters

- No database change.

## 1.5.1 (2026-10-25)

### Suggestions show on the tree

- A suggestion waiting for review now shows on the tree, where it will go: a suggested person is drawn faded, with a dotted circle and a "Suggested" tag, and their links are dotted. Words, drawings and photos placed on the tree show see-through. A person with a suggested change gets a small dot.
- Whoever manages the tree opens a suggested person to see who suggested it and what else the suggestion holds, and accepts or rejects it right there. A person with a suggested change shows the fields in their profile, with the same buttons. "See details" opens the review panel to sort change by change.
- The family sees what they are adding as a "Draft" before sending it, then as "Waiting" until it is reviewed. This is kept in their browser only, and cleared once the suggestion is reviewed.
- After adding a person, the send window no longer opens by itself. The family can add several people, then send once with Send.

### Photos placed on the tree by the family

- A family member can now place a photo on the tree. Before, the upload was refused without a word and the photo never showed. The photo waits for review: it is kept if accepted, deleted if rejected, and an upload never sent is deleted after 7 days. At most 50 photos wait on a tree at once.
- Accepted words, drawings and photos are now placed by the server when the suggestion is accepted. Before, the reviewer's browser placed them afterwards and could lose them, and none appeared when the family's changes apply directly.

### Adding relatives from a profile

- "Someone elsewhere": relatives can add a person found in public records too. It goes into their changes and the tree manager reviews it, like any other proposal. Places, the "needs checking" mark and the source link now travel with a proposed new person.
- In a profile's Links tab, searching for a parent, child or partner who is not in the tree yet now offers "Create …", which opens the add panel already filled in.
- Profiles have a Siblings section, with "Add a sibling".
- The Info tab has quick buttons to add a parent, partner, child or sibling without going into edit mode first.
- The add panel opened from a profile comes with the link already set, and suggests the family name for a child or a sibling.
- Adding someone whose first and last name match a person already in the tree shows a warning, with a button to open that person's profile.

### Fixes

- The "needs checking" mark sits on the corner of the portrait, half outside, so it no longer covers the face.
- "Update the tree" no longer clears your changes when part of them fails to save: what failed stays in your edits, with a message.
- A suggestion already reviewed elsewhere (another tab, a co-manager) now says so, instead of a message about emails, and the tree updates.
- After the family sends their changes, the tree reloads: a photo just sent no longer looks accepted.
- Zooming with the mouse wheel no longer logs an error in the browser console.

### For self-hosters

- New table `annotation_photo_uploads` (migration `20261025_003`, additive).
- New route `GET /trees/:id/contributions/sessions/:sessionId/status`, which returns only the status of a suggestion to someone who can read the tree.
- Anonymous counters for editing (person added and from where, suggestion sent or reviewed, edits saved), with no content from the tree. As before, nothing is sent without `VITE_POSTHOG_KEY`.

## 1.5.0 (2026-10-25)

### Several managers for one tree

- The owner can invite co-managers from the tree settings, in a new Managers tab. Parenthèse sends no email: the owner gets a link to pass on. The link works once, lasts 14 days, and can be cancelled. Copying it again creates a new link and the old one stops working (#145, asked by @milan616).
- A co-manager edits the tree and reviews the family's suggestions like the owner. Only the owner invites or removes a co-manager and deletes the tree. A co-manager can leave from the Advanced tab.
- Immich stays with the owner. Its key opens the owner's whole library, so co-managers do not see it or change it.
- With a password account, the link is needed and the account must use the invited address. With OIDC, a co-manager whose provider marks the invited address as verified is added at sign-in, without the link. An unverified address is never matched.
- An invitation opens an account even when `ALLOW_REGISTRATION=false`, at the invited address only.
- Removing a co-manager takes effect on their next request, and also drops any access they had saved with the sharing password. The settings then offer to change that password, since they may have seen it.
- Deleting your account now names the co-managers of the trees you own, which are deleted for them too.
- In the tree menu, "Admin" is now "Co-manager".

### Search for someone elsewhere

- "Someone elsewhere" in the bottom-right menu opens a panel on the right of the tree: type a name, birth year and place, and search public records. Links to Gallica (old newspapers), FranceArchives (military registers), Mémoire des hommes, Léonore, Geneanet, Open Archives, WikiTree, FreeBMD and FamilySearch open in the browser with the name typed in when the site allows it.
- The server can query deaths in France since 1970 (INSEE records via matchID) and WikiTree, once listed in `SEARCH_SOURCES`. Each source says what it covers and what is sent. The owner adds a result to a person in the tree: empty fields only, marked as needing checking, source kept in the note.

### Trees

- A tree can have an icon, picked from fifteen emoji in Settings > Your tree. It replaces the first letter in the tree menu, on the account page and on the invitation page.
- For whoever manages the tree, the button at the bottom right now reads Edit, with a pencil. The family keeps Add.
- A tree name starting with an emoji no longer shows a broken letter in the menus.

### Fixes

- An admin can switch a person's profile to edit mode from a new Edit button on the profile.
- The "?" of "needs checking" shows whole on round portraits. It was cut by the frame.
- On iPad, the tree no longer stops short of the bottom of the screen. The canvas follows its real size instead of the window height read at load.

## 1.4.0 (2026-10-23)

### Family tabs

- In another family's tab, the person you marked as "That's me" stays on screen, linked to that family by their direct line (the shortest kinship path, both parents at each step, no siblings around), drawn faded. Without a choice, the tree's starting person is used (#138).
- Visitors without an account can say who they are in the tree from their menu. The choice is kept in their browser for that tree (#138).

### Notes on the tree

- A note is attached to the nearest person when it is placed. It only shows in the tabs where that person is drawn, and stays next to them when the layout changes. Notes placed before this version are attached the first time the tree opens (#141).
- A placed text can be edited again. With the select tool, click it twice (#141).

### People

- A person can be marked as needing checking, for a date or a link you are not sure of. A "?" shows on the portrait and a pill on the profile, the family can propose it like any other field, and searching for "à vérifier" lists them (French only for now) (#140).

### Fixes and maintenance

- Memory thumbnails around a portrait are cropped instead of stretched to a square (#142).
- DOMPurify 3.4.17, pulled in by posthog-js, for a critical advisory published on 2026-10-23 (GHSA-cg2g-xh64-v4q7) (#139).
- Minor dependency updates for the app, the API and the landing page (#133, #134, #136).

## 1.3.0 (2026-10-21)

### Memories from Immich

- Admins with Immich configured can add photos and videos from their library, from a person's memories or when adding a moment. Search by context, filter by photos or videos or by face, open a larger preview and pick several at once (#103 by @Askrosm, #128).
- Photos come in as Immich's preview, so iPhone HEIC pictures work, and downloads stop as soon as they pass the size limit (#103).
- Several memories picked at once are added in one go, each titled from its file name (#128).

## 1.2.1 (2026-10-21)

### Fixes

- Clicking a person without a photo opens their profile again. The file picker only opens from "+ photo" in edit mode (#124, reported by @coutadeurf, #125).
- GEDCOM export stays valid 5.5.1. Sex "other" is written as `SEX U`, and `SEX X` is still read on import (#126).

### Self-hosting

- With `PASSWORD_LOGIN=false`, an account that had a password and was linked to OIDC can delete itself by retyping its email after a recent sign-in (#126).
- An email already linked to an OIDC identity can't be claimed by a different subject at the provider (#126).
- HEIC and AVIF files are recognised as images instead of video, and are refused cleanly until they can be converted (#126).

## 1.2.0 (2026-10-20)

### Tree layout

- Rows follow the kinship generation from the tree's starting person: spouses on the same row, parents one row up, children one row down. A shorter branch married into a deeper one no longer sits several rows too high (#67, reported by @SpaceOptimist, #111).
- One tree, never islands. An in-law family attaches to its child at the end of the sibling row, never between two siblings, and each union of a remarriage sits above its own children (#105, #116).
- In-law families wider than a screen open in their own tab, the same tree drawn from the spouse. A pill above the spouse leads there and back, and tabs with the same name show the couple's first names. Search opens the tab holding the person. Tree settings can turn tabs off (#116, #81 reported by @coutadeurf).
- Lines between families are full lines when they cross no other family, with one trunk per sibling row (#83, #90).

### People

- Sex can be set to female, male or other, and is unspecified by default. Relationship names follow it in French and English, with neutral or double forms when unknown. GEDCOM `SEX X` is read and written (#114, suggested by @Arc676, #118).
- Nicknames show under the name in the tree and the profile (#85). The last name is optional and an unknown first name can be ticked (#87, #89).
- Profiles: pills for facts, place of death, adoption, autosave when leaving, a cleared field stays cleared, close by swiping down on phones (#91, #93, #98, #101, #106).
- Portraits can be cropped with the full photo kept, in a round or square frame, and "+ photo" opens the picker right away (#95, #108, #109). Admins can edit a memory (#94).

### Sharing and family

- Guests can propose changes with the pencil, and the owner sees pending proposals on their avatar as soon as the tree opens (#96, #121).
- A simpler start page with two choices, one door for shared trees, and a clearer login (#86, #88, #92).
- The bottom bar is one pill with Add or correct and the account menu (#100, #104, #107). Search results can be tapped in edit mode on phones (#110).

### Self-hosting

- `ALLOW_REGISTRATION=false` closes sign-up. Existing accounts log in and the first account of an empty instance is still allowed (#113, suggested by @milan616, #117).
- OIDC login (experimental) with `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_REDIRECT_URI`. An existing account is linked by verified email only, and never an account that has a password (sign-up does not verify the address). `PASSWORD_LOGIN=false` turns passwords off (#115, suggested by @Arc676, #122).

### Fixes and maintenance

- GEDCOM import in transactions and much faster on large files, backups restore tested in CI, and other points from the 18/10 audit (#97). A union without a date sits at its logical place in the Life tab (#102).
- Mobile: separated parents drawn as a dotted line, lighter edit bar, dates on the number pad (#82).
- Eleven unused interface modules removed (#119).

## 1.1.0 (2026-10-17)

### Life tab

- Each profile has a new Life tab, a timeline of the person's life. Birth, marriages and death are the milestones, other events sit between them with their place and the person's age, and the close family the tree already knows (children and siblings born, parents, partner or a child dying) shows in grey. A profile with no recorded event still gets a timeline. Sources stay folded until clicked.
- Admins add a moment from the bottom of the tab with what, when (a year, "about"), where, and files. Tapping a moment edits or deletes it.
- A moment can carry several files of any kind, photos, videos, recordings or documents such as a birth record as a PDF. New files join the person's memories, and existing memories can be picked instead.
- Birth, marriage and death accept their own documents, source and note.
- Family members with the sharing link can propose a moment. It waits for the owner's review with its files, in the same proposal, and shows once accepted.

### Dates

- Date fields take a year alone (1950) or a full date, and a year alone reads "1950" instead of "1 January 1950" (#77, reported by @Akasiek).
- A person can be marked as deceased without a date. The tree shows "1908–?" and the profile "Date unknown" (#77).
- Dates imported as "about", "before", "between" or "from … to" keep their wording, and editing a date by hand drops it.

### GEDCOM import and export

- A zip holding the .ged file and its photos (or a GEDZIP .gdz) imports in one go. Portraits and other files are matched with the paths the GEDCOM cites, with no folder to pick.
- Life events are imported and exported (baptism, occupations, residences, military service, custom events, divorce…), with place, notes and sources. Republican calendar dates, adoptions (`PEDI adopted`), nicknames and `1 DEAT Y` are read too. An import then an export keeps them.
- Files cited by the GEDCOM, under a person, an event, a source or a family, become memories with their title and source (#59, reported by @zycker). Heredis places ("Town,INSEE code,département,…") are cleaned up, at import and for trees already imported.
- All notes are kept, shared notes included, and dates are read in full instead of by year.

### Family

- Immich face recognition can fill portraits from an Immich server, set up in Settings > Advanced (#58 by @coutadeurf).
- Siblings can be reordered by dragging one past another in edit mode, or with the arrows on the profile (#60 by @py5932). A new child goes after its siblings.

### First photos

- Tree creation offers "I already have a tree": the .ged file is imported right away, without creating a "you" entry that would end up duplicated.
- GEDCOM import reads the photos each person had in the original software (`OBJE` / `FILE`, inline or by reference, primary photo first). After an import, the owner picks the folder where those photos live and Parenthèse places each portrait by file name. Paths stay on the device, nothing is stored on the server.
- After an import, a window suggests five faces to start with: the close family of the person marked "Me", otherwise the most recent generations.
- For the owner, an empty portrait invites a photo: the empty frame on a profile is a button outside edit mode, and hovering an empty portrait in the tree shows "+ photo".
- Phone photos over 5 MB are scaled down to 2000 px before upload instead of being refused.
- Owner portrait uploads are limited to 120 per minute (was 30), still within the tree's storage quota.
- Anonymous events: `gedcom_imported`, `portraits_bulk_placed`, `portrait_added` (rounded counts, no names, paths or tree address).

### Fixes

- Docker: on a first `docker compose up`, the API now gets 120 s to run its migrations before its health check counts (was 30 s). The web container waits for a healthy API and used to give up, so it had to be started again by hand.
- Children of a family with only one known parent (common in GEDCOM files) are linked to that parent, under a single "Unknown" partner, instead of floating in the tree without a link.
- Importing a GEDCOM file into a tree that already holds it no longer duplicates everyone: people with the same first name, last name, birth and death dates are reused, and existing unions and parent links are kept.
- Parents no longer show "(null)" next to their names when the union has no type.

### Dependencies

- Grouped minor and patch updates for the app, the API and the landing, and GitHub Actions upload-artifact 7 and setup-node 7.

## 1.0.3 (2026-10-10)

### Self-hosting

- Single-container image `ghcr.io/iliesallali/parenthese-aio` (PostgreSQL, API and front end), for Unraid and NAS systems that install one container per app. It needs no configuration: the database, its password and the session key are created in `/data` on first start. Tested in CI by a fresh start, a restart and the smoke test.
- The `parenthese-web` image reads the API address from `API_UPSTREAM` (`api:4000` by default, unchanged for existing installs). Set it when the name `api` is already taken on the Docker network, for example on Umbrel where apps share one network.

## 1.0.2 (2026-10-09)

### Self-hosting

- Docker images for the API and the front end are published on GitHub's registry, for amd64 and arm64: `ghcr.io/iliesallali/parenthese-api` and `ghcr.io/iliesallali/parenthese-web`. `docker-compose.yml` and `.env` are enough, no clone needed. `PARENTHESE_VERSION` in `.env` pins a version (`latest` follows main). Each publication is tested by an install in an empty folder with those two files only.
- Creating a tree works on an instance served over plain HTTP on a local network. The browser only offers `crypto.randomUUID` over HTTPS or on localhost, and the sharing password now falls back to `crypto.getRandomValues` (#44, fixed in #45 by @coutadeurf).

### Security

- fast-jwt 6.3.4: its verifier cache could accept an expired token that has no `iat` claim.
- Build tools only, nothing that runs in the browser or on the server: source-map-js 1.2.2 and postcss-selector-parser 7.1.6 (CPU exhaustion on crafted input).

### Dependencies

- Landing on Vite 8 and @vitejs/plugin-react 6, with the same target browsers as before, like the app.
- Minor and patch updates (lucide, posthog-js, ESLint, PostCSS).

## 1.0.1 (2026-10-01)

Security release, from an independent review of 1.0.0.

### Security

- A crafted video file could block the whole API for hours (the location-scrubbing pattern ran in quadratic time). It now runs in linear time.
- Account sessions issued before 2026-10-01 are no longer accepted, so every user signs in again once. Until 1.0.0, a session could end up in photo annotations and in server logs. `SESSIONS_NOT_BEFORE` moves this date without rotating `JWT_SECRET`.
- In a contribution, the "before" state shown to the owner now comes from the database, not from the contributor. A relative could previously label a deletion with another person's name.
- Deleting a person through an approved contribution now removes their unions, links, memories and portrait, exactly like the owner's own deletion. Their files are erased from disk on both paths.
- Sharing-password attempts are counted before the check, so a burst of parallel requests can no longer go past the per-tree limit. Password checks run one at a time, so password guessing cannot saturate the API.
- Changing the sharing password and linking an account now run in a single transaction, and an unlock started just before the change can no longer keep access.
- The storage quota counts the actual disk usage of a tree, portraits and annotation photos included. An account can own at most 10 trees.
- Size limits: request bodies are capped at 1 MB outside upload routes; contributions, annotations (number per tree, batch size, style size) and GEDCOM imports (lines, links, one import at a time) are bounded.
- GIF files are re-encoded, which bounds their size and strips their metadata.
- Old annotation contributions no longer return a stored image address.
- The server refuses to start with a published example `JWT_SECRET` when `NODE_ENV` is not set.

### Deployment and self-hosting

- Production deploys the exact commit the CI validated, never an older one, and stops if the SSH host key is not pinned.
- nginx: `X-Forwarded-For` is set to the connecting address instead of being appended to; the version is hidden; the production access log drops query strings, which carried media tokens.
- The PostHog script no longer loads anything from PostHog's servers, and the dashboard can no longer turn on click, heatmap or error capture. The CSP now names the two PostHog hosts instead of `*.posthog.com`.
- `deploy/backup.sh` no longer uploads unencrypted backups unless `BACKUP_ALLOW_PLAINTEXT=1` is set.

Correction to 1.0.0: not every fix listed there came with an automated test.

## 1.0.0 (2026-09-30)

First public release. The code has been public since 2026-09-14; this version marks the app as ready to self-host.

### The family tree

- One tree per family, laid out automatically, explored like a map (drag, zoom, search by name).
- A profile for each person: dates and places, occupation, notes, family links.
- Memories on each person: photos, videos (file or YouTube link), audio recordings, quotes, documents, GPS tracks.
- Free annotations on the tree: drawings, stickers, text, photos.
- GEDCOM import and export.

### Sharing with the family

- One link and one sharing password per tree. Relatives look around without an account and suggest additions.
- A welcome screen and a guided flow for relatives who arrive through the link, with a step-by-step guide on parenthese.io.
- Reviewed contributions: the owner applies the family's changes right away or reviews each one.
- A visit log for the owner.

### Interface

- English and French. The app follows the browser's language, with a switch in the app; `?lang=en` or `?lang=fr` forces one.
- Demo tree with a fictional family and real, freely licensed photos (see `frontend/public/demo/CREDITS.md`).

### Self-hosting and data

- `docker compose up` runs the database, the API and the web front end; the CI builds and tests this setup on every push.
- Users can delete a tree or their account from the app; media files are erased with them.
- No analytics on a self-hosted instance unless a PostHog key is provided at build time.

### Security and privacy

Reviewed before release; every fix below comes with a test.

- Uploaded files are identified by their content, not by the type the browser declares. Only real images, audio, video, PDF, Word, text, GeoJSON and GPX files are accepted, and every file is served with `nosniff` and a sandboxed Content-Security-Policy.
- Photos are re-encoded without their metadata (GPS location, device, date taken); the phone's rotation is applied to the pixels. Location data is also removed from phone videos.
- Image addresses carry a short-lived, read-only media token instead of the account session.
- Tree annotations are only readable by people who can open the tree.
- Password attempts are limited per client and per tree. The API only trusts the address set by its own reverse proxy (`TRUST_PROXY`).
- Changing a tree's sharing password closes every session opened with the old one, including those linked to an account.
- Deleted or rejected media are erased from disk; a per-tree storage quota applies.
- GEDCOM import and export are hardened against oversized or malformed files.
- The web server sends HSTS and a Content-Security-Policy. Fonts are served by the app itself, with no call to Google.
- Analytics (only when a PostHog key is set) never include the tree's address, and session recording is off.

### License

- [PolyForm Noncommercial 1.0.0](LICENSE): free to read, modify and self-host for non-commercial use.
