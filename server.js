const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { randomInt, randomUUID, timingSafeEqual } = require("node:crypto");
const path = require("node:path");

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const challengeLifetimeMs = 10 * 60 * 1000;
const maxAttempts = 5;
const challenges = new Map();
const requestCounts = new Map();

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 8192) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request must contain valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function allowRequest(key) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const current = requestCounts.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    requestCounts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 5;
}

async function deliverCode(channel, destination, code) {
  const mode = process.env.DELIVERY_MODE || "providers";

  if (mode === "console" && process.env.NODE_ENV !== "production") {
    console.log(`[DEV] Verification code for ${destination}: ${code}`);
    return;
  }

  if (channel === "email" && (mode === "providers" || mode === "sendgrid")) {
    const apiKey = process.env.SENDGRID_API_KEY;
    const from = process.env.SENDGRID_FROM_EMAIL;
    if (!apiKey || !from) throw new Error("Email delivery is not configured on the server.");

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: destination }] }],
        from: { email: from },
        subject: "Your WEB BIT verification code",
        content: [{ type: "text/plain", value: `Your verification code is ${code}. It expires in 10 minutes.` }]
      })
    });
    if (!response.ok) {
      console.error("SendGrid delivery failed with status", response.status);
      throw new Error("Email delivery failed. Check the server's SendGrid configuration.");
    }
    return;
  }

  if (channel === "phone" && (mode === "providers" || mode === "twilio")) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      throw new Error("SMS delivery is not configured on the server.");
    }

    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const body = new URLSearchParams({
      To: destination,
      From: TWILIO_FROM_NUMBER,
      Body: `Your WEB BIT verification code is ${code}. It expires in 10 minutes.`
    });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    if (!response.ok) {
      console.error("Twilio delivery failed with status", response.status);
      throw new Error("SMS delivery failed. Check the server's Twilio configuration.");
    }
    return;
  }

  throw new Error("The selected delivery method is not configured on the server.");
}

function maskDestination(channel, destination) {
  if (channel === "email") {
    const [name, domain] = destination.split("@");
    return `${name.slice(0, 1)}${"*".repeat(Math.max(2, name.length - 1))}@${domain}`;
  }
  return `${"*".repeat(Math.max(0, destination.length - 4))}${destination.slice(-4)}`;
}

async function handleStart(request, response) {
  const { channel, to } = await readJson(request);
  const destination = typeof to === "string" ? to.trim() : "";
  const validEmail = channel === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination);
  const validPhone = channel === "phone" && /^\+[1-9]\d{7,14}$/.test(destination);
  if (!validEmail && !validPhone) {
    json(response, 400, { error: channel === "phone" ? "Enter a phone number in international format, such as +14155552671." : "Enter a valid email address." });
    return;
  }

  const ip = request.socket.remoteAddress || "unknown";
  if (!allowRequest(`ip:${ip}`) || !allowRequest(`destination:${channel}:${destination.toLowerCase()}`)) {
    json(response, 429, { error: "Too many code requests. Please wait 15 minutes and try again." });
    return;
  }

  const code = String(randomInt(100000, 1000000));
  await deliverCode(channel, destination, code);
  const challengeId = randomUUID();
  challenges.set(challengeId, {
    channel,
    destination,
    code,
    expiresAt: Date.now() + challengeLifetimeMs,
    attempts: 0
  });
  json(response, 200, {
    challengeId,
    destination: maskDestination(channel, destination),
    expiresInSeconds: challengeLifetimeMs / 1000
  });
}

async function handleVerify(request, response) {
  const { challengeId, code } = await readJson(request);
  const challenge = challenges.get(challengeId);
  if (!challenge || challenge.expiresAt < Date.now()) {
    challenges.delete(challengeId);
    json(response, 400, { error: "That code expired. Request a new one." });
    return;
  }

  challenge.attempts += 1;
  const submitted = typeof code === "string" ? Buffer.from(code) : Buffer.alloc(0);
  const expected = Buffer.from(challenge.code);
  const matches = submitted.length === expected.length && timingSafeEqual(submitted, expected);
  if (!matches) {
    if (challenge.attempts >= maxAttempts) challenges.delete(challengeId);
    json(response, 400, {
      error: challenge.attempts >= maxAttempts ? "Too many incorrect attempts. Request a new code." : "That code is incorrect. Please try again."
    });
    return;
  }

  challenges.delete(challengeId);
  json(response, 200, { verified: true, method: challenge.channel });
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  try {
    if (request.method === "POST" && pathname === "/api/verification/start") {
      await handleStart(request, response);
      return;
    }
    if (request.method === "POST" && pathname === "/api/verification/verify") {
      await handleVerify(request, response);
      return;
    }
    if (request.method === "GET" && (pathname === "/" || pathname === "/in.html")) {
      const html = await readFile(path.join(__dirname, "in.html"));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" });
      response.end(html);
      return;
    }
    json(response, 404, { error: "Not found." });
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    const status = error.message.includes("not configured") || error.message.includes("delivery failed") ? 503 : 400;
    json(response, status, { error: error.message || "The request could not be completed." });
  }
});

server.listen(port, host, () => {
  console.log(`WEB BIT is running at http://${host}:${port}`);
});