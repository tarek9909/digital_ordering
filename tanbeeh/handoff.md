# Handoff: Tanbeeh Instagram launch

Date: 26 Oct 2026 · Account: @tanbeeh.lb (0 followers, 0 posts at time of writing)
Companion file: [content-calendar.md](content-calendar.md), the full six-week calendar with every caption and all Meta ad settings.

---

## 1. Summary

Tanbeeh (تنبيه, "alert") is a digital order pager for restaurants and cafés in Lebanon. The customer scans a QR code at the counter, and their phone rings when staff tap Ready. A TV pickup screen calls the number in Arabic and English. There's no app, no sign-up and no hardware to buy; setup takes under 10 minutes, and it's sold as a subscription in US dollars. The code lives in this repo (`backend/`, `frontend/`); the marketing assets live in `tanbeeh/`.

This session did three things:
1. **Filled in an Instagram onboarding tool's profile form**, which had guessed the account was a "pre-launch teaser" with no product (answers in section 3).
2. **Reviewed every content asset** (29 videos and 15 posters) and built a six-week posting calendar with bilingual captions, posting times, and a small-budget Meta ads plan ([content-calendar.md](content-calendar.md)).
3. **Answered whether to run ads with 0 followers:** yes, with two changes to the plan (section 5). **These changes are not yet in content-calendar.md.**

---

## 2. The conversation

**Turn 1: User** shared a screenshot of an Instagram onboarding tool ("Reading your Instagram → Finding your niche → Studying creators like you → Picking your first reels"). It had a form with the fields What you sell, What makes you different, About you, Who it's for, Your voice, Brand name, Your look (colour), Products and Tools. The tool had guessed the niche as "Pre-launch teaser account" and the colour as `#C9A227`. The user asked: *"help me fill these based on the project."*

**Claude** read the README, the concept doc, the landing-page copy (`frontend/packages/i18n/locales/en/site.json`) and the brand skill (Ember theme), and wrote an answer for every field (section 3). It flagged that the niche should be changed so the tool studies the right creators, and that the colour should be the brand ember `#C2410C`, not `#C9A227`.

**Turn 2: User:** *"based on the tanbeeh file … give me which poster and which videos to post, when, and the captions under them, and which video to run ads on with a small amount, and the settings to place inside meta … give me a full calendar … md file."* Partway through, the user clarified that the content was local, in the workspace, not committed to the repo.

**Claude** used the `ffmpeg` bundled with Python's `imageio_ffmpeg` to read each video's length and turn its frames into a 12-frame contact sheet. It viewed every contact sheet and every poster, then wrote [content-calendar.md](content-calendar.md).

**Turn 3: User:** *"is there any video i should run the ads on? since i have 0 followers"*

**Claude:** Still `05-ThirteenOrThirty`. Ads reach the targeted audience regardless of followers, and these ads send owners straight to messages. 0 followers only hurts trust when someone visits the profile. Recommended starting the message ads on launch day (Mon 2 Nov) and adding a small campaign to bring in followers (section 5). It offered to update the calendar, and the user moved on to this handoff instead.

**Turn 4: User** asked for this file.

---

## 3. Profile form answers (Instagram onboarding tool)

| Field | Answer |
|---|---|
| Your niche | Restaurant & café tech: digital order pagers (SaaS) |
| What you sell | Tanbeeh, a digital order pager for restaurants and cafés. Customers scan a QR code at the counter, and their phone rings when staff tap Ready. There's no app to install and no buzzers to buy. It's a monthly, quarterly or yearly subscription priced in US dollars. |
| What makes you different | The customer's own phone is the buzzer. No hardware to buy, charge, lose or clean, and it's set up in 10 minutes with a QR poster. |
| About you | Tanbeeh (تنبيه, "alert") is a Lebanese startup replacing the plastic restaurant buzzer. Staff tap "New ticket", the customer scans a QR code, and when the order is ready their phone rings, even locked in a pocket. A TV by the counter shows the number and calls it out in Arabic and English. Each restaurant gets the page in its own logo and colours, plus reports on preparation, waiting and pickup times. |
| Who it's for | Owners and managers of busy quick-service restaurants, cafés, bakeries and food courts in Lebanon and the region, from single shops to multi-branch chains. |
| Your voice | Short, confident, a little playful. Talks like a counter regular, not a tech company. Bilingual Arabic/English, concrete, no jargon. |
| Brand name | Tanbeeh |
| Your look | `#C2410C` (ember orange), with charcoal `#1C1917` and white |
| Products | Customer order page, Staff board, Pickup TV screen, Admin dashboard and reports, POS integration API |
| Tools | Phone, tablet or PC browser, smart TV, POS / cashier system, QR posters |

---

## 4. Content creation

### What exists (`tanbeeh/`)
- **29 videos**, all vertical 1080×1920 with audio, 5–40s long. Mostly Arabic (Lebanese dialect) with English subtitles. They're flat illustration in the Ember palette and end on the bilingual logo lockup.
  - `01`–`11`: brand and relatable problems, ending on **"Contact us"**.
  - `10a`–`10h`: 5-second stings and loops (flip board, "بلا تطبيق/بلا أجهزة/بلا شحن", logo pulse, and phones buzzing in a pocket for shawarma, manoushe, coffee and burger).
  - `21`–`31`: aimed at owners, ending on **"Book a demo"**.
  - A one-line description and a strength rating for every video are in [content-calendar.md §1](content-calendar.md).
- **15 posters** in `pictures/`: 1080×1350 feed posts. `07-how-it-works-1…4` is one carousel, `11-poll-story.png` is a 1080×1920 story (add Instagram's poll sticker in the app), and `15-venue-spotlight-TEMPLATE.png` is a placeholder.
- **Identity kit** in `identity/`: logo in every format, avatar, cover banners, colours, and a 12-page brand guidelines PDF.

### How the assets were made
- Posters: built by `node scripts/build-posts.mjs`, run from a `content/` folder (per `pictures/README.md`). **That `content/` folder isn't in this repo**, and neither are the video sources. Find out where they live before editing any asset.
- Identity: `node identity/source/build-identity.mjs` regenerates the kit (in the repo's `identity/`). Geometry and colours must stay in step with `frontend/packages/ui/src/BrandMark.tsx` and `ember.css`.
- Brand rules: `.claude/skills/brand-console/SKILL.md`. One ember element per view, danger colour is rose (never red-orange), Arabic-first and RTL. Keep clear of Wi-Fi-arc or "smile" curve logos, because a competitor (Nadeeni) owns that look.

### Previewing the videos without playing them
```bash
FF="/c/Users/User/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe"
# length of each video
"$FF" -i tanbeeh/02-TwentySeven.mp4 2>&1 | grep Duration
# 12-frame contact sheet (fps = 12 / length in seconds)
"$FF" -i tanbeeh/02-TwentySeven.mp4 -vf "fps=0.3,scale=270:-1,tile=6x2" -frames:v 1 sheet.jpg
```
The audio wasn't checked, and it isn't known whether there's a voiceover or only music.

### Still to create
1. **A venue spotlight**: fill `15-venue-spotlight-TEMPLATE.png` with the first real venue's logo and quote, then post it as a Collab post.
2. **A softer version of poster 14**, in case no venue is live by 7 Dec ("Be one of the first venues in Lebanon" instead of "are switching").
3. **Highlight covers**: plain ember dot on charcoal, for كيف بيشتغل / لصاحب المحل / أسئلة / Demo.
4. **Next videos, based on the DMs**: log what owners ask, and turn the top questions (price, setup, internet outages, Arabic support) into new 15s reels in the same style.

---

## 5. Plan status

### Done
- [content-calendar.md](content-calendar.md): six weeks (27 Oct → 7 Dec). It covers:
  - the tease week, and launch on Mon 2 Nov with `02-TwentySeven` and the how-it-works carousel pinned
  - one theme per week: easy, reliable, makes money, objections
  - every caption, hashtag and posting time (Beirut, UTC+2)
  - the bio, DM autoreplies, highlights and a daily story routine
  - the Meta ads setup

### The ads plan in short
- **Main video:** `05-ThirteenOrThirty`, the shouted numbers and names that most Lebanese counters actually have. Challengers in the same ad set: `23-CounterAt1pm` and `28-AlreadyOwnHardware`.
- **Cold campaign:**
  - Objective: Engagement → Message destinations (WhatsApp + Instagram) → Maximize conversations
  - Budget: $8/day, or $5/day lean
  - Audience: Lebanon, ages 23–55, restaurant/owner interests and job titles, with Advantage+ expansion off
  - Placements: manual, Instagram and Facebook only
- **Retargeting:** from 16 Nov, $3/day, showing `02` and `07` to people who engaged or watched 50%, excluding people who already messaged.
- **Total:** about $310, or about $155 lean.

### Agreed in chat, NOT yet applied to content-calendar.md
1. Start the cold message ads on **Mon 2 Nov** (launch day) instead of Thu 5 Nov.
2. Add a campaign to bring in the first followers:
   - Objective: Traffic → Instagram profile (profile visits)
   - Video: `03-BuzzersLastShift`
   - Audience: Lebanon, ages 18–45, broad food interests
   - Budget: $3/day, 2–15 Nov (about $40)
3. Never buy followers.

### Open questions for the owner
- **What's the price?** Nothing in the content shows it, and it will be the first DM. The answer is needed before the ads go live.
- **Is any venue live yet?** This decides whether poster 14 can go out as it is (7 Dec) and when the spotlight can be posted.
- **Is Tanbeeh built in Lebanon?** The Independence Day story (22 Nov) can say "صُنع بلبنان" only if it is.
- **Who answers DMs, and on which WhatsApp number?** The ads assume a reply within an hour, 10:00–22:00.

### Before the first post (27 Oct)
Switch the account to Business, link it to a Facebook Page and Meta Business Suite, connect WhatsApp Business, set the tease bio, and turn on the DM instant reply and FAQ buttons. Details are in [content-calendar.md §2](content-calendar.md).
