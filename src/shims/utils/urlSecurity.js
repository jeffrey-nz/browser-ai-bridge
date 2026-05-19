/**
 * urlSecurity.js — URL safety checks for bridge route handlers.
 *
 * Blocks cloud/hypervisor metadata endpoints that could be reached via SSRF
 * (e.g. AWS/GCP/Azure instance metadata servers). Intentionally allows
 * localhost/127.x since the primary use-case is screenshotting local dev
 * servers on the developer's own machine.
 */

// Hostnames that are unambiguously metadata servers.
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.gce.internal",
  "metadata.internal",
  "169.254.169.254", // AWS/Azure/GCP IMDS IPv4 link-local
]);

// Prefix-based blocks (link-local and APIPA ranges).
const BLOCKED_PREFIXES = [
  "fd00:", // common RFC 4193 ULA prefix used by some hypervisors
];

const LINK_LOCAL_RE = /^169\.254\./;

/**
 * Returns a non-null error string if the URL should be blocked, otherwise null.
 * @param {string} url
 * @returns {string|null}
 */
export function checkUrlSafety(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http/https URLs are supported";
  }

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    return `Blocked: ${host} is a cloud metadata endpoint`;
  }

  if (LINK_LOCAL_RE.test(host)) {
    return `Blocked: link-local address (${host}) is not permitted`;
  }

  for (const prefix of BLOCKED_PREFIXES) {
    if (host.startsWith(prefix)) {
      return `Blocked: address prefix ${prefix} is not permitted`;
    }
  }

  return null;
}
