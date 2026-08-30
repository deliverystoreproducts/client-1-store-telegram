# Moving the Mini App: another channel, another URL

An operator runbook. **No code change is needed for anything in this
document** — everything here is a variable in the host dashboard or a setting
in BotFather.

Read it before changing either, because the two mistakes that cost the most
time are both invisible: a bot that is a *subscriber* instead of an
*administrator* silently refuses every customer, and a membership cookie
outlives the channel it was granted for.

---

## The three "links", and why they are separate

Changing one does **not** change the others. Most confusion here comes from
assuming it does.

| # | The thing | Where it lives | What it decides |
|---|---|---|---|
| ① | **Which chats gate access** | `CHANNEL_ID` env var (Railway) | Whose membership is checked |
| ② | **Which URL the Mini App opens** | BotFather → `/myapps` → Edit Web App URL | What the customer actually sees |
| ③ | **Which link is posted in the channel** | The inline button on the channel post | How they get in |

① is checked server-side on our side. ② and ③ live entirely on Telegram's
side and we cannot read them from the app — if they disagree with ①, the
customer opens the *wrong shop* and is refused by the *right gate*, which
looks like a bug in the gate.

---

## A. Move to a different channel

### A1. Add the bot to the new channel **as an administrator**

Not as a subscriber. **Administrator.**

Telegram answers `getChatMember` on a channel only for a bot that administers
it; otherwise it returns 400 and `isChannelMember` treats every non-OK answer
as "not a member" (`src/lib/telegram.ts` — `if (!res.ok) return false`, and the
`catch { return false }` under it). That is deliberate: a channel check that
opened whenever Telegram had a bad day would not be a check. But it means a
bot with the wrong role **refuses every customer**, and the customer sees the
ordinary "Open this store from the channel to continue." — no error, nothing
in the logs that names the real cause.

The bot needs no privileges beyond being listed as an admin. Untick everything
optional if you like; "member list" access is what it is there for.

### A2. Read the numeric channel id

With the bot already an admin, post any message in the channel, then:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" \
  | python3 -m json.tool | grep -A3 '"chat"'
```

Take `channel_post.chat.id`. It is negative and starts `-100`, e.g.
`-1003966870688`. **Keep the minus and the `-100`** — an id without them is a
different chat, or none.

Confirm you have the right one before you save it anywhere:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getChat?chat_id=-100XXXXXXXXXX"
```

Expect the channel's title back. `{"ok":false,…"chat not found"}` means the id
is wrong **or** the bot was never added — the two are indistinguishable in the
reply, so re-check A1 first.

### A2b. ADDING a chat rather than moving

`CHANNEL_ID` takes a **comma-separated list**, and membership in ANY chat on it
admits:

```
CHANNEL_ID=-1003966870688,-1004444444444,-1005555555555
```

So one deployment and one bot can serve several closed chats — a second
channel, a VIP group, a wholesale group. Spaces and a trailing comma are
tolerated; empty entries are dropped; a value that is only commas configures
nothing and refuses everyone.

**Adding a chat needs no secret rotation** — nobody loses access, nobody is
signed out. Do steps A1, A2 and A4 for the new chat and stop. §A3 below is for
MOVING or REMOVING, which is the case that bites.

The bot must be an ADMINISTRATOR of every chat listed. One where it is only a
subscriber answers 400 and silently admits nobody; `getChatMember` failures now
log the chat id and the HTTP status, so the failing chat is named rather than
guessed at (Railway → Deploy logs → `[telegram]`).

### A3. Set `CHANNEL_ID` — and rotate `JWT_SECRET` in the same edit

This is the step that is easy to miss, and skipping it means the move quietly
does not take effect.

The membership cookie `__Host-ybs_tg` carries `{ tg: <telegram user id>, exp }`
and nothing else (`src/lib/telegram-token.ts`, `TelegramClaim`). **It does not
record which channel it was granted for.** So every person who passed the check
against the *old* channel holds a cookie that is still valid for up to 7 days
(`TELEGRAM_MAX_AGE`), and they walk past the new gate without being
re-checked. If the point of moving channels is to change who gets in, that is
exactly the population you meant to exclude.

Rotating `JWT_SECRET` invalidates every outstanding membership cookie at once.
Everyone is sent back through the channel check on their next visit.

```bash
openssl rand -base64 32
```

Railway → the service → **Variables** → set `CHANNEL_ID` and `JWT_SECRET`
**together**, then deploy once. Two separate edits = two redeploys and a window
where the new channel is live with the old cookies still honoured.

> Rotating `JWT_SECRET` also signs customers out of the *storefront* session on
> some paths. That is expected and harmless — they sign back in by SMS.

### A4. Post the button in the new channel

See section C. The old channel's post does not follow you.

### A5. Verify

Section D. Do it before you tell anyone the shop has moved.

### What does **not** change when you move channels

No code, no rebuild, no BotFather change, no change to the storefront's API key
or tenant. Channel membership and customer identity are two independent checks
and moving one does not touch the other.

---

## B. Change the URL the Mini App opens

### B1. New domain for the same shop

1. **Railway** → service → Settings → Networking → add the domain. Telegram
   requires `https`; a Railway-provided domain already is.
2. **BotFather** → `/myapps` → pick the app → **Edit Web App URL** → the new
   origin. This is the setting that actually decides what opens. The Direct
   Link in section C resolves *through* it, so you do not need to re-post the
   channel button for a domain change — the same link now opens the new URL.
3. **Only if a reverse proxy or custom domain rewrites the `Host` header**, set
   `SITE_ORIGIN=https://<new-domain>`. The CSRF check (`src/lib/csrf.ts`)
   compares the browser's `Origin` against the host the app believes it is
   serving; when a proxy rewrites `Host` those stop matching and **every POST
   fails**, sign-in included. On a plain Railway domain, leave it unset.

`frame-ancestors` in `next.config.ts` allows `web.telegram.org` and
`telegram.org` and is about *who may frame us* — it does not vary with our own
domain and needs no edit.

### B2. Point the bot at a different storefront

Same as B1 step 2, then give that deployment its own `TELEGRAM_GATE=on`,
`BOT_TOKEN`, `CHANNEL_ID`, `JWT_SECRET`. All four or nothing:
`telegramEnv()` returns `null` when any of the three secrets is blank and the
endpoint then refuses everyone with `not_configured`, on purpose — a
half-configured gate is the dangerous state.

---

## C. The channel button must be a `url` button, not a `web_app` button

The one that costs an hour if nobody tells you. An inline `web_app` button is
**rejected in a channel post**:

```json
{"ok":false,"error_code":400,"description":"Bad Request: BUTTON_TYPE_INVALID"}
```

`web_app` buttons are valid in private chats and groups, not in channel posts.
Use a plain `url` button pointing at the Mini App **Direct Link**, which opens
the app exactly the same way:

```
https://t.me/<bot_username>/<app_short_name>
```

The short name is the one chosen in `/newapp`; `/myapps` lists them.

```bash
curl -s -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id=-100XXXXXXXXXX \
  -d text="The shop is open." \
  --data-urlencode 'reply_markup={"inline_keyboard":[[{"text":"Open the shop","url":"https://t.me/<bot_username>/<app_short_name>"}]]}'
```

Pin the message. A customer who scrolls past it has no other way in.

---

## D. Verify by fetching, not by looking

The failure modes here are all invisible from a screenshot, so check the wire.

```bash
HOST=https://your-deployment.up.railway.app

# 1. Gate is ON and fully configured.
curl -s -X POST "$HOST/api/auth/telegram" \
  -H "content-type: application/json" -H "origin: $HOST" \
  -d '{"initData":"x"}'
```

| Reply | Meaning |
|---|---|
| `403 {"error":"not_in_channel"}` | **Correct.** Gate on, all three secrets present, garbage rejected. |
| `404 {"error":"not_enabled"}` | `TELEGRAM_GATE` is not `on`. |
| `403 {"error":"not_configured"}` | One of `BOT_TOKEN` / `CHANNEL_ID` / `JWT_SECRET` is blank. |

```bash
# 2. The SDK is served as JavaScript — not as the gate page.
curl -sI "$HOST/telegram-web-app.js" | grep -i content-type
#    → application/javascript     ✓
#    → text/html                  ✗ the proxy is rewriting it; see the table below

# 3. Nothing leaks to a signed-out visitor.
curl -s "$HOST/" | grep -c 'site-header\|tile-name'
#    → 0
```

Then open it from the channel button, on a phone, as a real member.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A real channel member is told "Open this store from the channel" | Bot is a subscriber, not an **admin**, of the channel — `getChatMember` 400s and the gate fails closed | A1 |
| Same, and the bot *is* an admin | `CHANNEL_ID` wrong, or missing the `-100` / the minus | A2 |
| People you removed from the old channel still get in | Membership cookie is not channel-bound and lives 7 days | Rotate `JWT_SECRET` (A3) |
| Blocked identically in Telegram **and** a browser, no error anywhere | The Telegram SDK is not loading — the gate is rewriting `/telegram-web-app.js` to the sign-in page, and `nosniff` then refuses to execute HTML as JS | Every file in `public/` must be listed in the matcher exclusion in `src/proxy.ts`. Check `content-type` (D2) |
| `BUTTON_TYPE_INVALID` when posting the button | `web_app` button in a channel post | Use a `url` button + Direct Link (C) |
| `chat not found` from `getChat` | Wrong id, **or** bot never added — indistinguishable | Re-do A1, then A2 |
| Every POST fails after a domain change | CSRF origin check; a proxy is rewriting `Host` | Set `SITE_ORIGIN` (B1.3) |
| `429 rate_limited` | 20 attempts per 10 min per client, by design | Wait |

---

## Variables this document touches

| Variable | Secret | Notes |
|---|---|---|
| `TELEGRAM_GATE` | no | `on` enables the channel check. Anything else = off. |
| `BOT_TOKEN` | **yes** | HMAC key for every `initData` signature. Never `NEXT_PUBLIC_*`. A leaked token lets anyone mint `initData` for any user id and the gate becomes decorative. |
| `CHANNEL_ID` | no | One or more numeric chat ids, comma-separated, each with the leading `-100`. Membership in ANY admits. |
| `JWT_SECRET` | **yes** | Signs the membership cookie. Rotate to evict everyone. |
| `SITE_ORIGIN` | no | Only when a proxy rewrites `Host`. |

All of `BOT_TOKEN` / `CHANNEL_ID` / `JWT_SECRET` are required together.

---

## Rotating the bot token

BotFather → `/revoke` → pick the bot. Set the new value as `BOT_TOKEN` in
Railway.

Revoking invalidates **only the token**. The bot keeps its username, its
registered Mini Apps, and its admin rights in every channel — nothing in
section A or C has to be redone. A token that has appeared in a chat log, a
screenshot, or a commit should be revoked the moment testing no longer needs
it.
