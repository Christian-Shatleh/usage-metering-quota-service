
import express from "express";
import { fileURLToPath } from "node:url";

const app = express();

const PORT = Number(process.env.PORT || 8080);
const API_BASE_URL =
  process.env.API_BASE_URL || "http://localhost:3000";

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
  next();
});

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", async (req, res) => {
  try {
    if (!["GET", "HEAD", "POST", "PUT", "PATCH"].includes(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const target = new URL(req.originalUrl, API_BASE_URL);

    const headers = {};

    for (const name of [
      "content-type",
      "x-api-key",
      "idempotency-key",
      "x-bootstrap-token"
    ]) {
      const value = req.header(name);
      if (value) headers[name] = value;
    }

    const method = req.method;

    const body = (
      method === "GET" || method === "HEAD"
    ) ? undefined : req;

    const response = await fetch(target, {
      method,
      headers,
      body,
      duplex: body ? "half" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000)
    });

    res.status(response.status);

    const contentType = response.headers.get("content-type");

    if (contentType) {
      res.set("content-type", contentType);
    }

    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("API proxy failed:", error);

    res.status(502).json({
      error: "Backend unavailable"
    });
  }
});

const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));
app.use(express.static(publicDirectory, {
  etag: true,
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0
}));

app.listen(PORT, () => {
  console.log(`Frontend running on port ${PORT}`);
});
