# WEB BIT Creator

The verification page requires the Node.js server. Do not open `in.html` directly as a `file://` URL; API requests need the same-origin server.

## Run locally

1. Install Node.js 20.6 or newer.
2. Copy `.env.example` to `.env`.
3. Add provider credentials to `.env` and set `DELIVERY_MODE=providers`.
4. Run `npm run dev` and open `http://127.0.0.1:3000`.

For email, configure a SendGrid API key and a verified sender address. For SMS, configure a Twilio Account SID, Auth Token, and sender number. Email addresses are checked by the server; phone numbers must use international E.164 format, for example `+14155552671`.

## Local flow testing

To test without sending messages, set `DELIVERY_MODE=console` and `NODE_ENV=development` in `.env`, then restart the server. The one-time code is written to the server terminal only. Never use console mode in production.

Codes expire after 10 minutes, allow up to five attempts, and request limits are held in memory. For a public deployment, use HTTPS, configure `HOST=0.0.0.0`, and move rate limits and challenges to a shared store before running multiple server instances.

Google sign-in is not wired to an OAuth provider; the button explains this and does not grant access. Configure Google OAuth separately before enabling it.

## Deploy free on Render

The `render.yaml` blueprint deploys this Node app as a free web service. Push the project to GitHub, then in Render choose **New +** > **Blueprint** and connect the repository. Render will build with `npm install` and start with `npm start`. Add the SendGrid and Twilio credentials in the service's environment settings to enable verification delivery; never put provider secrets in `render.yaml` or Git.

Free Render services may spin down after inactivity, so the first request after a quiet period can be slow. The app keeps verification challenges and rate limits in memory; use a shared store before running multiple instances. After deploy, submit the public Render URL in Google Search Console and complete ownership verification before requesting indexing.

## Deploy to Google Cloud Run

Create or select a Google Cloud project, enable billing, and install the Google Cloud CLI. Then authenticate and deploy from this directory:

```sh
gcloud auth login
gcloud config set project PROJECT_ID
gcloud run deploy web-bit-creator --source . --region REGION --allow-unauthenticated --max 1 --set-env-vars NODE_ENV=production,DELIVERY_MODE=providers
```

Cloud Run supplies `PORT` and the app binds to its network interface automatically. Configure `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` as Cloud Run secrets or environment variables to enable verification delivery. Do not commit these values. The verification challenges and rate limits are held in memory, so a process restart clears them; use a shared store before scaling beyond one instance.

After deployment, use the public `run.app` URL in Google Search Console and complete its ownership verification before requesting indexing.