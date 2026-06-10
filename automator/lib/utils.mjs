import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const DEFAULT_TEXT_TAIL_BYTES = 4 * 1024 * 1024;

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return Math.floor(number);
  return fallback;
}

function compactText(value, max = 6000) {
  const text = String(value ?? "").replace(/\s+$/g, "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 18)}... [truncated]`;
}

async function readTextTail(file, maxBytes = DEFAULT_TEXT_TAIL_BYTES) {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    const totalSize = Number(info.size) || 0;
    const limit = positiveInteger(maxBytes, DEFAULT_TEXT_TAIL_BYTES);
    const size = Math.max(0, Math.min(totalSize, limit));
    const start = Math.max(0, totalSize - size);
    const readStart = start > 0 ? start - 1 : start;
    const readSize = size + (start > 0 ? 1 : 0);
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, readStart);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start === 0) return text;
    const previousByte = buffer[0];
    const body = buffer.subarray(1, bytesRead).toString("utf8");
    if (previousByte === 10) return body;
    if (previousByte === 13) return body.replace(/^\n/, "");
    return body.replace(/^[^\r\n]*(\r?\n)?/, "");
  } finally {
    await handle.close();
  }
}

function pathIsInside(base, target) {
  const rel = relative(resolve(base), resolve(target));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..\\`) && !rel.startsWith("../"));
}

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

function parseJson(text, fallback = null) {
  const raw = String(text).replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const extracted = extractFirstJsonValue(raw);
    if (extracted && extracted !== raw) {
      try {
        return JSON.parse(extracted);
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}

function extractFirstJsonValue(text) {
  const source = String(text || "");
  const start = source.search(/[\[{]/);
  if (start < 0) return "";
  const open = source[start];
  const close = open === "{" ? "}" : "]";
  const stack = [close];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      if (char !== stack[stack.length - 1]) return "";
      stack.pop();
      if (!stack.length) return source.slice(start, index + 1);
    }
  }
  return "";
}


function requireText(value, label, max = 12000) {
  const text = String(value ?? "").trim();
  if (!text) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
  if (text.length > max) {
    const error = new Error(`${label} is too long.`);
    error.status = 400;
    throw error;
  }
  return text;
}

function optionalText(value, max = 4000) {
  if (value == null) return "";
  return String(value).trim().slice(0, max);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export {
  compactText,
  extractFirstJsonValue,
  optionalText,
  pathIsInside,
  parseJson,
  readTextTail,
  requireText,
  stableJson,
};
