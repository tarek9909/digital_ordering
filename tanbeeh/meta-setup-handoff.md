# Handoff: Meta setup for Tanbeeh (Facebook, Instagram, Business Suite, Ads)

Account: @tanbeeh.lb · Page: Tanbeeh · Start: Tue 27 Oct 2026 · Ads start Thu 5 Nov
All times are Beirut time (UTC+2).

Companion files:
- [content-calendar.md](content-calendar.md): every post, caption, time, and the ads plan.
- `pictures/` and the `tanbeeh/*.mp4` files: the assets (not in git).

---

## Blockers to clear first
1. **Payment card and business verification** (Phase 4). Ads can't run without them, and verification can take days.
2. **WhatsApp Business number** connected to the Page (Phase 3).
3. **Price answer** for the "How much is it?" auto-reply. The calendar has no number yet.
4. **Post 30 claim**: "Tanbeeh connects via our API" must be true before that post goes out (30 Nov).
5. **Poster 14 wording** ("are switching"): only use it once a real venue is live.

---

## Phase 1: Facebook Page
1. Log in to facebook.com with your personal account.
2. Go to **Pages → Create new Page**. Name: **Tanbeeh**. Category: **Software Company**.
3. Add the bio from calendar section 2 (tease version until Sun 1 Nov, launch version from Mon 2 Nov).
4. Upload `identity/social/profile-avatar-1080.png`.
5. Add the WhatsApp click-to-chat link (`wa.me/961XXXXXXXX`) as the Page button or website.

## Phase 2: Business account (business.facebook.com)
1. Click **Create account**. Business name: **Tanbeeh**.
2. Under **Accounts → Pages**, add the Tanbeeh Page.

## Phase 3: Connect Instagram and WhatsApp
1. In the Instagram app: **Settings → Account type and tools → Switch to professional account → Business**. Connect the Facebook Page.
2. In Business Suite: **Settings → Accounts → Instagram**. Confirm @tanbeeh.lb is listed.
3. In Business Suite: **Settings → Accounts → WhatsApp**. Connect the WhatsApp Business number.

## Phase 4: Ad account and payment
1. Business Suite: **Settings → Accounts → Ad accounts → Add → Create new ad account**.
2. Currency **USD**. Time zone **Beirut (UTC+2)**. This is hard to change later.
3. **Settings → Payments** (or Billing): add the card.
4. Complete business verification if Meta asks.

## Phase 5: Auto-replies and highlights
1. Business Suite: **Inbox → Automations**.
2. **Auto reply** (the second card, "Try it"): add the instant reply:
   `أهلا 👋 شكراً لتواصلك مع تنبيه! شو اسم محلّك وبأي منطقة؟ منرجعلك بأقل من ساعة. / Hi! What's your venue's name and area? We'll get back to you within the hour.`
3. **Frequently asked questions** (already in the list, switched off): click **Edit**, add these 4 questions, then switch it on. Turn Messenger off and keep Instagram on.
   1. `قدّيش بيكلّف؟ / How much is it?` · Answer: `التسعير بالدولار. [السعر] / Pricing is in US dollars. [PRICE]. ابعتلنا محلّك وبنحدّدلك الخطة المناسبة.` (fill in the price)
   2. `بدّي عرض لمحلّي / I want a demo` · Answer: `أكيد! شو اسم محلّك وبأي منطقة؟ منرتّبلك عرض قصير على الواتساب. / Sure! What's your venue's name and area? We'll set up a short demo on WhatsApp.`
   3. `لازم إشتري أجهزة؟ / Do I need to buy devices?` · Answer: `لأ، ولا جهاز. بيشتغل عتلفون الزبون وعالتابلت أو التلفزيون اللي عندك. / No devices needed. It runs on your customer's phone and the tablet or TV you already have.`
   4. `بيشتغل مع نظام الكاشير؟ / Does it work with my POS?` · Answer: `إذا عندك نظام كاشير، منقدر نربطه عبر الـAPI. شو نظامك؟ / If you have a POS system, we can connect it through our API. Which system do you use?` (only if the API integration is ready)
4. Week 2: create highlights `كيف بيشتغل`, `لصاحب المحل`, `أسئلة`, `Demo`.

## Phase 6: Schedule the posts (weekly, about 7 days ahead)
Captions: calendar section 3. Full schedule: calendar section 5.

For each post in Business Suite → **Create post**:
1. Choose **Instagram** (and **Facebook** if "Also share to Facebook" is wanted).
2. **Videos: choose Reel, not Post.** All 31 videos are 1080×1920 (9:16). Feed posts reject 9:16 with "Wrong aspect ratio", but Reels accept it. No conversion is needed.
3. **Posters: choose Post** (feed, 4:5). Use **Carousel** for the 07 how-it-works series.
4. Upload the file, keeping the original audio on videos.
5. Reel cover: pick the frame with the Arabic headline (e.g. 02 → "بلا تطبيق. بلا أجهزة. بس امسح.").
6. Paste the caption and hashtags. Add location **Beirut, Lebanon**.
7. Choose **Schedule**, check the time shows Beirut time, then confirm.

Manual steps the scheduler can't do:
- Share each feed post to stories within 1 hour.
- Pin posts marked 📌: Mon 2 Nov (02), Tue 3 Nov (07 carousel). On Mon 7 Dec, replace the third pin with poster 14.
- Poll stickers: Fri 30 Oct (`11-poll-story.png`) and the Friday poll stories.
- Reply to every comment in the first hour.
- Daily stories: Mon question box, Wed quiz, Fri poll, Sun behind-the-scenes.

## Phase 7: Cold ad campaign (starts Thu 5 Nov, submit by Tue 3 Nov)
Ads Manager → **Create**:
- Objective: **Engagement**. Name: `TNB | Cold | Messages | Nov26`. Special ad category: None. Advantage campaign budget: **Off**.
- Ad set: conversion location **Message destinations** (WhatsApp and Instagram; Messenger off). Goal: **Maximize number of conversations**. Budget **$8/day** (lean: $5). Schedule **5 Nov 10:00 → 5 Dec 23:59**.
- Location Lebanon. Age 23–55. All genders. Languages empty.
- Detailed targeting (match any): interests, job titles and behaviours from calendar section 4. Advantage+ audience expansion **Off**.
- Placements: **Manual**. On: Instagram Reels, Stories, Feed, Explore; Facebook Reels, Stories, Feed. Off: everything else.
- Ads (upload the file directly):
  - **A**: `05-ThirteenOrThirty.mp4`. Headline `بلا صريخ. التلفون بيرن.`
  - **B**: `23-CounterAt1pm.mp4`. Headline `لا تخسر طلبات ساعة الزحمة`.
  - **C**: `28-AlreadyOwnHardware.mp4`. Headline `أجهزة جديدة: $0`.
  - CTA on all: **Send message**. Copy: calendar section 4.

## Phase 8: Retargeting campaign (starts Mon 16 Nov)
1. **Audiences → Create custom audience**:
   1. Instagram account engagement, last 30 days.
   2. Video viewers (50%+) of 02, 05, 07, 22, 23, 28, last 30 days.
   3. Instagram people who sent a message, last 30 days (for exclusion).
2. Campaign: Engagement → Message destinations → Maximize conversations. Name `TNB | Retarget | Messages | Nov26`. Budget **$3/day**, 16 Nov → 5 Dec.
3. Include audiences 1 and 2, exclude 3. Lebanon, ages 21–60. Same placements as cold.
4. Ads: `02-TwentySeven.mp4` and `07-TenMinutes.mp4`, with the retargeting copy in calendar section 4.

## Phase 9: Running the ads
- Answer DMs within an hour, 10:00–22:00.
- Don't edit ads for the first 4 days.
- **Day 7 check (Thu 12 Nov):** pause any ad with about $10 spent and zero conversations, or a link CTR under 0.8%.
- Track cost per conversation from week 1.
- Log every conversation (name, venue, area, answer to "how much?") in a sheet.
- Don't use Boost on posts.

---

## Status
- [ ] Facebook Page
- [ ] Business account and Instagram connected
- [ ] WhatsApp connected
- [ ] Ad account, payment, verification
- [ ] Auto-replies and FAQ (with price)
- [ ] Highlights (week 2)
- [ ] Posts scheduled through 7 Dec
- [ ] Cold ads live 5 Nov
- [ ] Retargeting live 16 Nov
- [ ] Day 7 ad check 12 Nov
