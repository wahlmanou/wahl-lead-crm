const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  stringify
} = require("csv-stringify/sync");
const {
  parse
} = require("csv-parse/sync");
const config = require("./config");
const {
  scrapeLeads
} = require("./scraper");
const {
  analyzeWebsite
} = require("./analyzer");
const {
  DEFAULT_SUBJECT,
  DEFAULT_TEMPLATE,
  renderTemplate
} = require("./mailer");

const app = express();

app.use(
  express.json({
    limit: "5mb"
  })
);

app.use(
  express.text({
    type: "text/csv",
    limit: "5mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

const leadsFile = path.join(
  __dirname,
  "data",
  "leads.json"
);

const settingsFile = path.join(
  __dirname,
  "data",
  "settings.json"
);

const mailDir = path.join(
  __dirname,
  "mail-output"
);

let job = {
  running: false,
  message: "Bereit",
  current: 0,
  total: 100,
  warnings: []
};

function ensureFolders() {
  for (const folder of [
    path.dirname(leadsFile),
    mailDir
  ]) {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(
        folder,
        {
          recursive: true
        }
      );
    }
  }
}

function loadLeads() {
  ensureFolders();

  if (!fs.existsSync(leadsFile)) {
    return [];
  }

  return JSON.parse(
    fs.readFileSync(
      leadsFile,
      "utf8"
    )
  );
}

function saveLeads(leads) {
  ensureFolders();

  fs.writeFileSync(
    leadsFile,
    JSON.stringify(
      leads,
      null,
      2
    ),
    "utf8"
  );
}

function loadSettings() {
  ensureFolders();

  if (!fs.existsSync(settingsFile)) {
    const settings = {
      subject: DEFAULT_SUBJECT,
      template: DEFAULT_TEMPLATE
    };

    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        settings,
        null,
        2
      ),
      "utf8"
    );

    return settings;
  }

  return JSON.parse(
    fs.readFileSync(
      settingsFile,
      "utf8"
    )
  );
}

function saveSettings(settings) {
  ensureFolders();

  fs.writeFileSync(
    settingsFile,
    JSON.stringify(
      settings,
      null,
      2
    ),
    "utf8"
  );
}

function normalizeKey(value = "") {
  return value
    .toLowerCase()
    .replace(
      /[^a-z0-9äöüß]/g,
      ""
    );
}

function pick(row, names) {
  const entries =
    Object.entries(row);

  for (const name of names) {
    const wanted =
      normalizeKey(name);

    const found =
      entries.find(
        ([key]) =>
          normalizeKey(key) === wanted
      );

    if (
      found &&
      String(
        found[1] || ""
      ).trim()
    ) {
      return String(
        found[1]
      ).trim();
    }
  }

  return "";
}

app.get(
  "/api/status",
  (_req, res) =>
    res.json(job)
);

app.get(
  "/api/leads",
  (_req, res) =>
    res.json(loadLeads())
);

app.get(
  "/api/settings",
  (_req, res) =>
    res.json(loadSettings())
);

app.put(
  "/api/settings",
  (req, res) => {
    const settings = {
      subject: String(
        req.body.subject ||
        DEFAULT_SUBJECT
      ),
      template: String(
        req.body.template ||
        DEFAULT_TEMPLATE
      )
    };

    saveSettings(settings);
    res.json(settings);
  }
);

app.post(
  "/api/scrape",
  async (req, res) => {
    if (job.running) {
      return res.status(409).json({
        error:
          "Ein Suchlauf läuft bereits."
      });
    }

    const limit = Math.max(
      1,
      Math.min(
        500,
        Number(req.body.limit) ||
        100
      )
    );

    job = {
      running: true,
      message:
        "Lead-Suche wird gestartet",
      current: 0,
      total: limit,
      warnings: []
    };

    res.json({
      started: true
    });

    try {
      const newLeads =
        await scrapeLeads(
          limit,
          (event) => {
            if (event.warning) {
              job.warnings.push(
                event.warning
              );
            }

            if (event.message) {
              job.message =
                event.message;
            }

            if (
              event.current !== undefined
            ) {
              job.current =
                event.current;
            }

            if (
              event.total !== undefined
            ) {
              job.total =
                event.total;
            }
          }
        );

      const current =
        loadLeads();

      const byEmail =
        new Map(
          current.map(
            (lead) => [
              String(
                lead.email
              ).toLowerCase(),
              lead
            ]
          )
        );

      for (const lead of newLeads) {
        if (
          !byEmail.has(
            lead.email.toLowerCase()
          )
        ) {
          byEmail.set(
            lead.email.toLowerCase(),
            lead
          );
        }
      }

      const merged = [
        ...byEmail.values()
      ];

      saveLeads(merged);

      job.message =
        `${newLeads.length} neue Leads, ` +
        `${merged.length} insgesamt`;
    } catch (error) {
      job.message =
        `Fehler: ${error.message}`;

      job.warnings.push(
        error.stack ||
        error.message
      );
    } finally {
      job.running = false;
    }
  }
);

app.post(
  "/api/import",
  (req, res) => {
    try {
      const raw = String(
        req.body || ""
      ).replace(
        /^\uFEFF/,
        ""
      );

      const delimiter =
        raw.includes(";")
          ? ";"
          : ",";

      const rows = parse(
        raw,
        {
          columns: true,
          skip_empty_lines: true,
          delimiter,
          relax_column_count: true,
          trim: true
        }
      );

      const current =
        loadLeads();

      const byEmail =
        new Map(
          current.map(
            (lead) => [
              String(
                lead.email
              ).toLowerCase(),
              lead
            ]
          )
        );

      let imported = 0;

      for (const row of rows) {
        const email = pick(
          row,
          [
            "E-Mail",
            "Email",
            "Mail"
          ]
        ).toLowerCase();

        if (
          !email ||
          !email.includes("@") ||
          byEmail.has(email)
        ) {
          continue;
        }

        const lead = {
          id:
            `${Date.now()}-` +
            Math.random()
              .toString(36)
              .slice(2, 9),
          name: pick(
            row,
            [
              "Name",
              "Firma",
              "Gastgeber"
            ]
          ),
          contact: pick(
            row,
            [
              "Ansprechpartner",
              "Kontakt"
            ]
          ),
          email,
          phone: pick(
            row,
            [
              "Telefon",
              "Phone"
            ]
          ),
          website: pick(
            row,
            [
              "Website",
              "Webseite",
              "Homepage"
            ]
          ),
          address: pick(
            row,
            [
              "Anschrift",
              "Adresse",
              "Address"
            ]
          ),
          zip: pick(
            row,
            ["PLZ"]
          ),
          city: pick(
            row,
            [
              "Ort",
              "Stadt"
            ]
          ),
          sourceUrl: pick(
            row,
            [
              "Quelle",
              "Source",
              "SourceUrl"
            ]
          ),
          status:
            pick(
              row,
              ["Status"]
            ) || "Neu",
          note: "",
          analysis: null,
          createdAt:
            new Date()
              .toISOString()
        };

        byEmail.set(
          email,
          lead
        );

        imported += 1;
      }

      saveLeads([
        ...byEmail.values()
      ]);

      res.json({
        imported,
        total: byEmail.size
      });
    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  }
);

app.post(
  "/api/leads/:id/analyze",
  async (req, res) => {
    const leads = loadLeads();
    const index = leads.findIndex(
      (lead) => lead.id === req.params.id
    );

    if (index < 0) {
      return res.status(404).json({
        error: "Lead nicht gefunden."
      });
    }

    try {
      const analysis = await analyzeWebsite(
        leads[index].website
      );

      leads[index] = {
        ...leads[index],
        analysis
      };

      saveLeads(leads);
      res.json(leads[index]);
    } catch (error) {
      res.status(400).json({
        error: error.message
      });
    }
  }
);

app.put(
  "/api/leads/:id",
  (req, res) => {
    const leads =
      loadLeads();

    const index =
      leads.findIndex(
        (lead) =>
          lead.id ===
          req.params.id
      );

    if (index < 0) {
      return res.status(404).json({
        error:
          "Lead nicht gefunden."
      });
    }

    leads[index] = {
      ...leads[index],
      status: String(
        req.body.status ??
        leads[index].status
      ),
      note: String(
        req.body.note ??
        leads[index].note
      )
    };

    saveLeads(leads);
    res.json(leads[index]);
  }
);

app.delete(
  "/api/leads/:id",
  (req, res) => {
    const leads =
      loadLeads();

    const filtered =
      leads.filter(
        (lead) =>
          lead.id !==
          req.params.id
      );

    saveLeads(filtered);

    res.json({
      deleted:
        leads.length -
        filtered.length
    });
  }
);

app.post(
  "/api/generate-mails",
  (_req, res) => {
    ensureFolders();

    const leads =
      loadLeads();

    const settings =
      loadSettings();

    const manifest = [];

    for (
      let index = 0;
      index < leads.length;
      index += 1
    ) {
      const lead =
        leads[index];

      const body =
        renderTemplate(
          settings.template,
          lead
        );

      const subject =
        renderTemplate(
          settings.subject,
          lead
        );

      manifest.push({
        id:
          String(index + 1)
            .padStart(3, "0"),
        lead,
        subject,
        body
      });
    }

    fs.writeFileSync(
      path.join(
        mailDir,
        "manifest.json"
      ),
      JSON.stringify(
        manifest,
        null,
        2
      ),
      "utf8"
    );

    res.json({
      count: manifest.length
    });
  }
);

app.get(
  "/api/mails",
  (_req, res) => {
    const file = path.join(
      mailDir,
      "manifest.json"
    );

    if (!fs.existsSync(file)) {
      return res.json([]);
    }

    res.json(
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      )
    );
  }
);

app.get(
  "/api/export/csv",
  (_req, res) => {
    const leads =
      loadLeads();

    const rows =
      leads.map(
        (lead) => ({
          Name: lead.name,
          Ansprechpartner:
            lead.contact,
          "E-Mail":
            lead.email,
          Telefon:
            lead.phone,
          Website:
            lead.website,
          Anschrift:
            lead.address,
          PLZ:
            lead.zip,
          Ort:
            lead.city,
          Quelle:
            lead.sourceUrl,
          Status:
            lead.status,
          WebsiteScore:
            lead.analysis?.score ?? "",
          CMS:
            lead.analysis?.cms ?? "",
          Notiz:
            lead.note
        })
      );

    const csv =
      "\uFEFF" +
      stringify(
        rows,
        {
          header: true,
          delimiter: ";"
        }
      );

    res.setHeader(
      "Content-Type",
      "text/csv; charset=utf-8"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="leadpilot-leads.csv"'
    );

    res.send(csv);
  }
);

app.listen(
  config.port,
  () => {
    ensureFolders();
    loadSettings();

    console.log(
      `LeadPilot läuft unter ` +
      `http://localhost:${config.port}`
    );
  }
);
