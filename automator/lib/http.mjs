import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { contentTypes, publicDir } from "./config.mjs";
import { parseJson } from "./utils.mjs";

const MAX_JSON_BODY_BYTES = 1024 * 1024;

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

function methodNotAllowedResponse(res, allow) {
  const body = JSON.stringify({ ok: false, error: "Method not allowed.", detail: null }, null, 2);
  res.writeHead(405, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "allow": allow,
  });
  res.end(body);
}

async function readJsonBody(req) {
  const declaredLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    const error = new Error("Request body is too large.");
    error.status = 413;
    throw error;
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const size = buffer.length;
    if (totalBytes + size > MAX_JSON_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    totalBytes += size;
    chunks.push(buffer);
  }
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    methodNotAllowedResponse(res, "GET, HEAD");
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    errorResponse(res, 400, "Malformed URL path.");
    return;
  }
  const safePath = resolve(publicDir, `.${decoded}`);
  const rel = relative(publicDir, safePath);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
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
      "content-length": String(info.size),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
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
