const config = require("./config");

const DEFAULT_SUBJECT =
  "Eine Idee zur einfacheren Verwaltung Ihrer Ferienunterkunft";

const DEFAULT_TEMPLATE = `{{anrede}},

wir hoffen, unsere Nachricht ist in Ordnung.

Wir sind auf Ihre Ferienunterkunft aufmerksam geworden und möchten Ihnen eine Lösung vorstellen, die speziell für private Gastgeber und kleinere Vermietungsbetriebe entwickelt wurde.

Mit Ferienmanager verwalten Sie Buchungen, Gäste, Rechnungen und Zahlungen übersichtlich an einem Ort. Dadurch sparen Sie Zeit bei der täglichen Organisation und behalten Ihre Vermietung jederzeit im Blick.

Sie können Ferienmanager einen Tag kostenlos und unverbindlich testen, ohne Termin oder Rücksprache:

{{produktlink}}

Die Software wird kontinuierlich weiterentwickelt. Über ehrliches Feedback freuen wir uns sehr. Wenn Ihnen eine Funktion fehlt oder Sie eine Idee haben, prüfen wir gerne, wie wir diese in Ferienmanager integrieren können.

Vielleicht ist Ferienmanager genau die Unterstützung, die Ihnen im Alltag spürbar Zeit spart.

Freundliche Grüße

{{signatur}}`;

function salutation(lead) {
  const contact = String(lead.contact || "").trim();

  if (contact) {
    const surname = contact.split(/\s+/).filter(Boolean).at(-1);
    if (surname) {
      return `Hallo Familie ${surname}`;
    }
  }

  return "Guten Tag";
}

function signature() {
  return [
    config.sender.name,
    config.sender.company,
    "",
    config.sender.role,
    "",
    config.sender.city,
    "",
    `T: ${config.sender.phone}`,
    "",
    ...config.sender.websites
  ].join("\n");
}

function renderTemplate(template, lead) {
  return String(template)
    .replaceAll("{{anrede}}", salutation(lead))
    .replaceAll("{{name}}", lead.name || "")
    .replaceAll("{{ort}}", lead.city || "")
    .replaceAll("{{website}}", lead.website || "")
    .replaceAll("{{produktlink}}", config.productUrl)
    .replaceAll("{{signatur}}", signature());
}

module.exports = {
  DEFAULT_SUBJECT,
  DEFAULT_TEMPLATE,
  renderTemplate
};
