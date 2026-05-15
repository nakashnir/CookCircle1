import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ─── Single-origin static frontend (production deploy on Render etc.) ────────
//
// The compiled bundle runs from artifacts/api-server/dist/index.mjs.
// The Vite frontend output lives at artifacts/cookcircle/_static (per its
// vite.config.ts `build.outDir`). Both source and dist sit one level deep
// inside artifacts/api-server/, so the same relative path resolves correctly
// in either ts-source or bundled-mjs runtime. esbuild's build.mjs banner
// already provides `import.meta.url` semantics in the bundle.
//
// Behavior:
//   - GET /api/* → already handled by the router above.
//   - GET /assets/foo.js, /favicon, etc. → served by express.static.
//   - GET /, /profile, /donations/123, /my-donations, … → SPA fallback to
//     index.html so the React Router (state-based currentScreen) can boot.
//   - POST/PATCH/DELETE non-/api → falls through to the default 404 handler
//     (correct: only GETs should fall back to the SPA shell).
//
// In local Windows dev the user runs Vite separately on :5173 with the
// /api proxy to :8080, so the backend never serves the frontend directly.
// If _static doesn't exist at runtime (e.g. backend-only dev), all static
// requests get a clean 404 via the sendFile callback instead of a 500.
const FE_STATIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "cookcircle",
  "_static",
);
const FE_INDEX_FILE = path.join(FE_STATIC_DIR, "index.html");
const HAS_FE_BUILD = existsSync(FE_INDEX_FILE);
logger.info(
  { feStaticDir: FE_STATIC_DIR, hasFeBuild: HAS_FE_BUILD },
  HAS_FE_BUILD
    ? "Serving frontend static bundle on same origin"
    : "Frontend bundle not found at runtime — running backend-only (this is expected in local dev when Vite serves the FE separately)",
);

if (HAS_FE_BUILD) {
  app.use(
    express.static(FE_STATIC_DIR, {
      index: false,
      maxAge: "1h",
      etag: true,
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(FE_INDEX_FILE, (err) => {
      if (err) {
        res.status(404).type("text/plain").send("Not found");
      }
    });
  });
}

export default app;
