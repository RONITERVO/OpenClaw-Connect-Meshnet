function sessionParts(key = "") {
  const parts = String(key).split(":");
  return {
    raw: key,
    agentId: parts[1] || "main",
    surface: parts[2] || "main",
    scope: parts[3] || "",
    target: parts.slice(4).join(":"),
  };
}

export {
  sessionParts,
};
