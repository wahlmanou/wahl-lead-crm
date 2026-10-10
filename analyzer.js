function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/")
    .trim();
}

function extractTag(html, pattern) {
  const match = html.match(pattern);
  return match ? cleanText(decodeHtml(match[1].replace(/<[^>]+>/g, " "))) : "";
}

function detectCms(html) {
  const lower = html.toLowerCase();

  if (
    lower.includes("wp-content") ||
    lower.includes("wp-includes") ||
    lower.includes('content="wordpress')
  ) {
    return "WordPress";
  }

  if (lower.includes("/_next/") || lower.includes("__next_data__")) {
    return "Next.js";
  }

  if (lower.includes("wixstatic.com") || lower.includes("wix-code")) {
    return "Wix";
  }

  if (lower.includes("jimdo.com") || lower.includes("jimcdn.com")) {
    return "Jimdo";
  }

  if (lower.includes("squarespace.com")) {
    return "Squarespace";
  }

  if (lower.includes("shopify")) {
    return "Shopify";
  }

  if (lower.includes("typo3")) {
    return "TYPO3";
  }

  return "Nicht erkannt";
}

function calculateScore(checks) {
  let score = 0;

  if (checks.https) score += 15;
  if (checks.statusOk) score += 10;
  if (checks.responseTimeMs <= 1500) score += 15;
  else if (checks.responseTimeMs <= 3000) score += 8;
  if (checks.title) score += 10;
  if (checks.metaDescription) score += 10;
  if (checks.viewport) score += 10;
  if (checks.h1Count === 1) score += 10;
  else if (checks.h1Count > 1) score += 5;
  if (checks.impressum) score += 8;
  if (checks.datenschutz) score += 7;
  if (checks.contactPage) score += 5;

  return Math.min(100, score);
}

async function analyzeWebsite(website) {
  if (!website) {
    throw new Error("Für diesen Lead ist keine Website vorhanden.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const started = Date.now();

  try {
    const response = await fetch(website, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"
      }
    });

    const responseTimeMs = Date.now() - started;
    const html = await response.text();
    const lower = html.toLowerCase();

    const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescriptionMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
    ) || html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i
    );

    const h1Count = (html.match(/<h1\b/gi) || []).length;
    const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);

    const checks = {
      statusCode: response.status,
      statusOk: response.ok,
      finalUrl: response.url,
      https: response.url.startsWith("https://"),
      responseTimeMs,
      title,
      metaDescription: metaDescriptionMatch
        ? cleanText(decodeHtml(metaDescriptionMatch[1]))
        : "",
      viewport,
      h1Count,
      cms: detectCms(html),
      impressum:
        lower.includes("impressum") ||
        lower.includes("/imprint"),
      datenschutz:
        lower.includes("datenschutz") ||
        lower.includes("privacy"),
      contactPage:
        lower.includes("kontakt") ||
        lower.includes("contact")
    };

    const issues = [];

    if (!checks.https) issues.push("Website verwendet kein HTTPS.");
    if (!checks.statusOk) issues.push(`HTTP-Status ${checks.statusCode}.`);
    if (checks.responseTimeMs > 3000) {
      issues.push(`Langsame Serverantwort: ${checks.responseTimeMs} ms.`);
    }
    if (!checks.title) issues.push("Kein Seitentitel erkannt.");
    if (!checks.metaDescription) issues.push("Keine Meta Description erkannt.");
    if (!checks.viewport) issues.push("Keine mobile Viewport-Angabe erkannt.");
    if (checks.h1Count === 0) issues.push("Keine H1-Überschrift erkannt.");
    if (checks.h1Count > 1) {
      issues.push(`${checks.h1Count} H1-Überschriften erkannt.`);
    }
    if (!checks.impressum) issues.push("Impressum nicht eindeutig verlinkt.");
    if (!checks.datenschutz) issues.push("Datenschutzseite nicht eindeutig verlinkt.");

    return {
      analyzedAt: new Date().toISOString(),
      score: calculateScore(checks),
      ...checks,
      issues
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Websiteanalyse nach 20 Sekunden abgebrochen.");
    }

    throw new Error(`Website konnte nicht analysiert werden: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  analyzeWebsite
};
