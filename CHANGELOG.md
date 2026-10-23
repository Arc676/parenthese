# Changelog

Notable changes to Parenthèse. Dates are in YYYY-MM-DD format.

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
