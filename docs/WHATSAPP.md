# WhatsApp connector

## What it does

| Action | Behavior |
| --- | --- |
| `whatsapp.send_message` | Cloud API text message to a phone (`to`) |
| `whatsapp.send_image` | Cloud API image message (`to` + public `image_url`) |
| `whatsapp.share_status` | Stages a photo and returns a **Status helper** page (Meta Cloud API **cannot** publish Status) |

## Status photos (cross-platform)

1. Prompt e.g. `Post this photo to WhatsApp status https://example.com/pic.jpg`
2. Run the workflow → result includes `sharePageUrl`
3. Open `/share/whatsapp-status?m=…` on:
   - **Mobile:** Share / Add to Status (Web Share sheet → WhatsApp → Status)
   - **Desktop:** Download photo → WhatsApp Desktop/Web → Status
   - **Any device:** green **Open WhatsApp** button uses `wa.me` (app / desktop / web)

## Setup

1. Create a Meta app with WhatsApp Cloud API; copy **Temporary/permanent token** and **Phone number ID**.
2. In `.env.local`:
   ```bash
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_API_VERSION=v21.0
   ```
3. Run migration `012_whatsapp.sql`.
4. On execute page, **Connect** WhatsApp (stores the server token for your user).

## Shareable workflow links (mobile / desktop / web)

- Chat shows **Copy**, **WhatsApp**, and **Open**.
- WhatsApp share uses `https://wa.me/?text=…` (works on phone app, desktop app, and web.whatsapp.com).
- Links are built from the request host when possible (`x-forwarded-host` / `host`), so ngrok or a LAN IP works better than `localhost` for phones.
- Set `NEXT_PUBLIC_APP_URL` to a URL your phone can reach (HTTPS recommended).

## Example prompts

- `Send WhatsApp message to +919876543210 saying hello from shareAi`
- `Send WhatsApp image to +919876543210 with https://…/photo.jpg`
- `Add photo https://…/photo.jpg to my WhatsApp status`
