function compactText(value, max = 6000) {
  const text = String(value ?? "").replace(/\s+$/g, "");
  if (text.length <= max) return text;
  return `${text.slice(0, max - 18)}... [truncated]`;
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
  parseJson,
  requireText,
  stableJson,
};
