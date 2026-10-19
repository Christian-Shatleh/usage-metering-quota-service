import { usersRouter } from "./routes/users.js";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { accountsRouter } from "./routes/accounts.js";
import { pool } from "./db/index.js";
import { plansRouter } from "./routes/plans.js";
import { usageRouter } from "./routes/usage.js";
import { customPlansRouter } from "./routes/custom-plans.js";
import {
  errorHandler,
  notFoundHandler
} from "./middleware/error-handler.js";
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    });
    next();
  });
  app.use(express.json({ limit: "32kb" }));

  const skipRateLimit = () => process.env.NODE_ENV === "test";
  app.use("/api/accounts/bootstrap", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: skipRateLimit,
    message: {
      error: "Too many bootstrap attempts; try again later",
      code: "rate_limited"
    }
  }));
  app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: skipRateLimit,
    message: {
      error: "Too many requests; try again later",
      code: "rate_limited"
    }
  }));

  app.get("/api/healthz", async (req, res) => {
    await pool.query("SELECT 1");

    res.json({
      status: "ok"
    });
  });

  app.use("/api/plans/custom", customPlansRouter);
  app.use("/api/plans", plansRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/usage", usageRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
