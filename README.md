# local-panel

A local web app (runs on your own machine) that deploys an MTProto
(Telegram) proxy to [Railway](https://railway.com) and shows you the
connection details — server, port, and secret — once it's live.

Pairs with the [`railway-mtproto`](../railway-mtproto) repo, which is the
actual proxy code that runs on Railway.

## How it works

1. You run this app locally (`npm start`) and open `http://localhost:4000`.
2. First screen: paste a Railway API token and the GitHub repo (your fork
   of `railway-mtproto`) you want deployed.
3. The panel talks to Railway's GraphQL API to:
   - create a project + service sourced from that GitHub repo
   - set a couple of env vars
   - trigger a build/deploy
   - open a **TCP Proxy** (not a regular domain — MTProto needs raw TCP)
   - read the auto-generated secret out of the deploy logs
4. You get a server / port / secret / `tg://proxy?...` link, with copy
   buttons.
5. The proxy itself keeps running on Railway independently — closing this
   local app does **not** stop it. Reopening the panel later just reads
   back the same deployment instead of creating a new one.

## Setup

### 1. Fork/push `railway-mtproto` to your own GitHub

Railway deploys from a GitHub repo you control, so push the sibling
`railway-mtproto` folder to a repo in your own account first.

### 2. Get a Railway API token

Railway dashboard → Account Settings → Tokens → create a token. An account
token (not scoped to one project) is easiest since this app creates a new
project for you.

### 3. Run the panel

```bash
npm install
npm start
```

Open `http://localhost:4000`, paste the token and your `owner/repo`, and
follow the on-screen progress.

## Where things are stored

State (token, project/service IDs, the deployed secret) is saved locally
in `data/state.json` — nothing leaves your machine except the calls to
Railway's API. That file is git-ignored; don't commit it, and don't share
it, since it contains your Railway token.

## Notes on the Railway API

Railway's public GraphQL API (`https://backboard.railway.app/graphql/v2`)
isn't strictly versioned, and mutation/field names have shifted before.
`lib/railwayClient.js` is written against the shape documented at
https://docs.railway.com/reference/public-api as of mid-2026. If a call
starts failing, the error text from Railway is surfaced directly in the
panel UI — check it against the current docs or Railway's GraphiQL
playground and adjust the query in `railwayClient.js` accordingly.

## Security notes

- Treat the Railway token like a password — it can create/delete resources
  on your account. This app only ever sends it to `backboard.railway.app`.
- The MTProto secret is sensitive too: anyone with the server, port, and
  secret can use your proxy. Don't post it publicly if you want it private
  to you/your contacts.
