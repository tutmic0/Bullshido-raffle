# Bullshido Raffle

A standalone partner-GTD raffle for Bullshido holders. **Completely
separate** from the Anya project -- its own GitHub repo, its own
Vercel project, its own Supabase project, its own secrets. Nothing in
here reads from or writes to Anya's database, and nothing in Anya's
code references this project.

How it works: a Bullshido holder connects + signs their wallet, gets a
number of raffle tickets equal to their **current on-chain Bullshido
balance** (checked server-side, never trusted from the browser), types
their X username, and enters. When the campaign's timer runs out, the
database itself automatically draws winners -- weighted by ticket
count -- with zero action from you. Winners can then generate a
branded "winner card" image and share it straight to X.

```
bullshido-raffle/
├── raffle.html              the public page holders use
├── admin.html               where YOU start/stop campaigns + export winners.csv
├── css/raffle.css           shared styling (Bullshido brand colors/fonts)
├── js/wallet-auth.js        connect + sign flow (independent copy, own session)
├── js/raffle.js             raffle.html's logic (entry form, countdown, winner card)
├── js/admin.js              admin.html's logic
├── img/_social_base.jpg     base portrait used for the generated winner card
├── api/auth/nonce.js        step 1 of wallet sign-in
├── api/auth/verify.js       step 2 of wallet sign-in
├── api/campaign.js          public: current campaign status
├── api/enter.js             enter the raffle (reads on-chain balance, locks ticket count)
├── api/status.js            your wallet's entry/winner status
├── api/admin/campaign.js    create/list/cancel campaigns (admin-secret protected)
├── api/admin/winners.js     JSON or CSV export of a campaign's winners
├── lib/                     shared server-side helpers
├── database/001_init.sql    the full Supabase schema + the auto-draw function
└── .env.example             every environment variable you need to set
```

## 1. Create a NEW GitHub repo

Same as before: a fresh, empty repo just for this project. Don't add
this folder to the Anya repo.

```
git init
git add .
git commit -m "Bullshido raffle"
```
Push it to the new GitHub repo you create.

## 2. Create a NEW Supabase project

Go to supabase.com -> New project. This must be a **different**
project from Anya's -- separate URL, separate keys, separate data.

Once it's created: `SQL Editor` -> paste in the entire contents of
`database/001_init.sql` -> `Run`.

Then enable the automatic draw:
1. In the left sidebar: `Database` -> `Extensions` -> search `pg_cron`
   -> toggle it on.
2. Back in the `SQL Editor`, run just this one line:
   ```sql
   select cron.schedule('bullshido-raffle-draw', '* * * * *', $cron$select perform_due_draws();$cron$);
   ```
   This runs every minute and only actually does anything for a
   campaign whose timer has already run out -- so draws happen
   automatically, typically within a minute of the deadline, with
   nothing for you to click.
3. Double check it's registered: `select * from cron.job;` should show
   one row named `bullshido-raffle-draw`.

Grab your keys for step 4: `Settings` -> `API` -> copy the **Project
URL** and the **service_role** key (NOT the anon key -- the service
role key is secret, never put it in any file that reaches the
browser).

## 3. Deploy to a NEW Vercel project

`vercel.com` -> `Add New` -> `Project` -> pick the new GitHub repo.
Vercel auto-detects the `api/` folder as serverless functions and the
rest as static files -- no build command needed.

Before the first deploy (or right after, then redeploy), set these
under `Settings` -> `Environment Variables`:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
| `ROBINHOOD_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` |
| `CONTRACT_ADDRESS` | `0xac549b9dfa78b3382fc437952da7752563d5064e` |
| `SESSION_JWT_SECRET` | a fresh random value -- run `openssl rand -hex 32` yourself, don't reuse Anya's |
| `ADMIN_SECRET` | a second, different fresh random value from `openssl rand -hex 32` |

Deploy. You'll get a `something.vercel.app` link -- `raffle.html` is
the page holders use, `admin.html` is yours only (share the link with
nobody).

## 4. Buy/connect a domain (optional, same as Anya/Bullshido)

Same process as before: buy a cheap domain (Porkbun/Cloudflare/Namecheap),
add it under `Settings` -> `Domains` in this Vercel project, add the
DNS records it shows you at your registrar.

## 5. Running a partner campaign

Open `admin.html` on your deployed site, type your `ADMIN_SECRET` at
the top (kept only in that browser tab's memory, never saved), then:

- **Start one**: fill in the partner's name, how many GTD spots
  they're giving, and the duration in hours (e.g. `24`) -> `Create
  campaign`. `raffle.html` picks it up immediately, no redeploy
  needed.
- **Only one campaign can be active at a time** -- the database itself
  enforces this, so you can't accidentally start a second one on top
  of a running one.
- **Cancel early** if you need to stop one (entries stay in the
  database, but no draw runs for it).
- **Export winners**: once a campaign is drawn, `Download
  winners.csv` on that page gets you wallet + X username for the most
  recently drawn campaign.

Nothing about starting the next partner requires touching code or
redeploying -- it's all through `admin.html`.

## Notes on the winner-card share flow

X's own "share" link can pre-fill text, but it cannot attach an image
automatically -- that's a platform limitation, not something we can
work around with a plain link. So the flow is: the winner clicks
**Share on X** (opens the compose window with the text and your
`@Bullshidooje` tag already filled in), clicks **Copy image** (copies
the generated winner card straight to their clipboard as an image),
then pastes it into that same window. Copying an image to the
clipboard works in Chromium-based browsers (Chrome, Edge, Brave, and
the browsers built into wallet extensions) -- if a holder's browser
doesn't support it, the page falls back to telling them to right-click
and save the image instead.

## Security notes

- Every raffle entry's ticket count is read live from the Bullshido
  contract server-side at the moment of entry -- the browser never
  reports its own balance, and nothing is trusted from the client.
- Wallet sign-in uses connect + `personal_sign` (no gas, no
  transaction) -- same pattern as Anya, but with its own JWT secret,
  its own nonce table, and its own session tokens. A session from one
  project is meaningless to the other.
- The random draw itself runs as a single SQL transaction inside your
  Supabase project (weighted, without replacement) -- there's no
  client-side "spin result" to intercept or manipulate.
- `admin.html` is protected by a single shared secret (`ADMIN_SECRET`)
  you type in yourself -- keep that link and key private, it's for you
  only, not for holders.
