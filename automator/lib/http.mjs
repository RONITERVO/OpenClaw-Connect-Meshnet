import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { contentTypes, publicDir } from "./config.mjs";
import { parseJson } from "./utils.mjs";

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function textResponse(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(String(body ?? ""));
}

function errorResponse(res, status, message, detail = null) {
  jsonResponse(res, status, { ok: false, error: message, detail });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  const parsed = parseJson(text, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Request body must be a JSON object.");
    error.status = 400;
    throw error;
  }
  return parsed;
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = resolve(publicDir, `.${decodeURIComponent(requested)}`);
  if (!safePath.startsWith(publicDir)) {
    errorResponse(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(safePath);
    if (!info.isFile()) throw new Error("not file");
    const type = contentTypes.get(extname(safePath)) || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store",
    });
    res.end(await readFile(safePath));
  } catch {
    errorResponse(res, 404, "File not found.");
  }
}

export {
  errorResponse,
  jsonResponse,
  readJsonBody,
  serveStatic,
  textResponse,
};
