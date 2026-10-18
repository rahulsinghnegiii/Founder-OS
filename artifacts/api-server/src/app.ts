import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import router from "./routes";
import mcpRouter from "./mcp/router";
import { redactMcpPath } from "./mcp/auth";
import { logger } from "./lib/logger";
import { requireAuth } from "./lib/auth";

const app: Express = express();

app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // /mcp/<token> carries a secret in the path; never log it.
          url: redactMcpPath(req.url?.split("?")[0]),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", requireAuth, router);

// MCP endpoint for ChatGPT, Claude and other MCP clients. Guarded by MCP_TOKEN, not APP_PASSWORD.
app.use(mcpRouter);

// Production mode: serve the built frontend from the same process so one
// container (or one `node dist/index.mjs`) runs the whole app.
const staticDir = process.env.SERVE_STATIC_DIR;
if (staticDir) {
  const resolved = path.resolve(staticDir);
  const indexHtml = path.join(resolved, "index.html");
  if (!existsSync(indexHtml)) {
    logger.warn({ staticDir: resolved }, "SERVE_STATIC_DIR set but index.html not found; skipping static serving");
  } else {
    logger.info({ staticDir: resolved }, "Serving frontend from static dir");
    app.use(express.static(resolved, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      // Leave API, MCP and discovery probes (e.g. OAuth metadata lookups) to 404 instead of serving HTML.
      if (req.method !== "GET" || /^\/(api|mcp|\.well-known)(\/|$)/.test(req.path)) return next();
      res.sendFile(indexHtml);
    });
  }
}

export default app;
