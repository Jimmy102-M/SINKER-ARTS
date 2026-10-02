# WEB BIT Creator

The verification page requires the Node.js server. Do not open `in.html` directly as a `file://` URL; API requests need the same-origin server.

## Run locally

1. Install Node.js 20.6 or newer.
2. Copy `.env.example` to `.env`.
3. Add provider credentials to `.env` and set `DELIVERY_MODE=providers`.
4. Run `npm start` and open `http://127.0.0.1:3000`.

For email, configure a SendGrid API key and a verified sender address. For SMS, configure a Twilio Account SID, Auth Token, and sender number. Email addresses are checked by the server; phone numbers must use international E.164 format, for example `+14155552671`.

## Local flow testing

To test without sending messages, set `DELIVERY_MODE=console` and `NODE_ENV=development` in `.env`, then restart the server. The one-time code is written to the server terminal only. Never use console mode in production.

Codes expire after 10 minutes, allow up to five attempts, and request limits are held in memory. For a public deployment, use HTTPS, configure `HOST=0.0.0.0`, and move rate limits and challenges to a shared store before running multiple server instances.

Google sign-in is not wired to an OAuth provider; the button explains this and does not grant access. Configure Google OAuth separately before enabling it.