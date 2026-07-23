import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const MCP_API_KEY = process.env.MCP_API_KEY || "";

type CrmName = "zigaflow" | "spruce" | "servicem8";

type CrmConfig = {
  name: CrmName;
  label: string;
  baseUrl?: string;
  apiKey?: string;
};

const crms: CrmConfig[] = [
  {
    name: "zigaflow",
    label: "Zigaflow",
    baseUrl: process.env.ZIGAFLOW_BASE_URL,
    apiKey: process.env.ZIGAFLOW_API_KEY
  },
  {
    name: "spruce",
    label: "Spruce",
    baseUrl: process.env.SPRUCE_BASE_URL,
    apiKey: process.env.SPRUCE_API_KEY
  },
  {
    name: "servicem8",
    label: "ServiceM8",
    baseUrl: process.env.SERVICEM8_BASE_URL,
    apiKey: process.env.SERVICEM8_API_KEY
  }
];

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_API_KEY) return next();

  const auth = req.header("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");

  if (token !== MCP_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function getCrm(name: CrmName): CrmConfig {
  const crm = crms.find((c) => c.name === name);
  if (!crm) throw new Error(`Unknown CRM: ${name}`);
  if (!crm.baseUrl) throw new Error(`${crm.label} base URL is missing`);
  if (!crm.apiKey) throw new Error(`${crm.label} API key is missing`);
  return crm;
}

async function crmGet(crm: CrmConfig, path: string, query?: Record<string, string>) {
  if (!crm.baseUrl || !crm.apiKey) {
    throw new Error(`${crm.label} is not configured`);
  }

  const url = new URL(path, crm.baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value) url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${crm.apiKey}`,
      "Accept": "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${crm.label} API error ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

const server = new McpServer({
  name: "all-in-one-crm-mcp",
  version: "1.0.0"
});

server.tool(
  "list_connected_crms",
  "List which CRM connectors are configured on the MCP server.",
  {},
  async () => {
    const configured = crms.map((crm) => ({
      crm: crm.name,
      label: crm.label,
      configured: Boolean(crm.baseUrl && crm.apiKey)
    }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(configured, null, 2)
        }
      ]
    };
  }
);

server.tool(
  "search_crm_records",
  "Search CRM records across Zigaflow, Spruce, ServiceM8, or all configured CRMs. Read-only.",
  {
    crm: z.enum(["zigaflow", "spruce", "servicem8", "all"]),
    query: z.string().describe("Search text, customer name, company, phone, email, job reference, or deal keyword."),
    limit: z.number().int().min(1).max(50).default(10)
  },
  async ({ crm, query, limit }) => {
    const targets = crm === "all" ? crms.filter((c) => c.baseUrl && c.apiKey) : [getCrm(crm)];

    const results = [];

    for (const target of targets) {
      try {
        // TODO: Replace `/search` with the real endpoint for each CRM.
        const data = await crmGet(target, "/search", {
          q: query,
          limit: String(limit)
        });

        results.push({
          crm: target.label,
          ok: true,
          data
        });
      } catch (error) {
        results.push({
          crm: target.label,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);

server.tool(
  "get_pipeline_summary",
  "Get a read-only pipeline or sales/work summary from configured CRMs.",
  {
    crm: z.enum(["zigaflow", "spruce", "servicem8", "all"]),
    period: z.string().default("today").describe("Example: today, yesterday, this_week, last_7_days, this_month")
  },
  async ({ crm, period }) => {
    const targets = crm === "all" ? crms.filter((c) => c.baseUrl && c.apiKey) : [getCrm(crm)];

    const results = [];

    for (const target of targets) {
      try {
        // TODO: Replace `/pipeline/summary` with each CRM's real endpoint.
        const data = await crmGet(target, "/pipeline/summary", { period });
        results.push({ crm: target.label, ok: true, data });
      } catch (error) {
        results.push({
          crm: target.label,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);

server.tool(
  "get_recent_activity",
  "Get recent customer, sales, job, note, task, or follow-up activity. Read-only.",
  {
    crm: z.enum(["zigaflow", "spruce", "servicem8", "all"]),
    limit: z.number().int().min(1).max(100).default(25)
  },
  async ({ crm, limit }) => {
    const targets = crm === "all" ? crms.filter((c) => c.baseUrl && c.apiKey) : [getCrm(crm)];

    const results = [];

    for (const target of targets) {
      try {
        // TODO: Replace `/activity/recent` with each CRM's real endpoint.
        const data = await crmGet(target, "/activity/recent", {
          limit: String(limit)
        });

        results.push({ crm: target.label, ok: true, data });
      } catch (error) {
        results.push({
          crm: target.label,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);

server.tool(
  "get_followups_due",
  "Get upcoming or overdue follow-ups, tasks, calls, reminders, or jobs. Read-only.",
  {
    crm: z.enum(["zigaflow", "spruce", "servicem8", "all"]),
    window: z.string().default("next_7_days")
  },
  async ({ crm, window }) => {
    const targets = crm === "all" ? crms.filter((c) => c.baseUrl && c.apiKey) : [getCrm(crm)];

    const results = [];

    for (const target of targets) {
      try {
        // TODO: Replace `/followups/due` with each CRM's real endpoint.
        const data = await crmGet(target, "/followups/due", { window });
        results.push({ crm: target.label, ok: true, data });
      } catch (error) {
        results.push({
          crm: target.label,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);

server.tool(
  "get_daily_digest",
  "Generate raw CRM data for a daily digest across configured CRMs. Read-only.",
  {
    date: z.string().optional().describe("Optional YYYY-MM-DD date. Defaults to today.")
  },
  async ({ date }) => {
    const configuredCrms = crms.filter((c) => c.baseUrl && c.apiKey);

    const results = [];

    for (const crm of configuredCrms) {
      try {
        // TODO: Replace `/digest/daily` with each CRM's real endpoint.
        const data = await crmGet(crm, "/digest/daily", date ? { date } : undefined);
        results.push({ crm: crm.label, ok: true, data });
      } catch (error) {
        results.push({
          crm: crm.label,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  }
);

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "all-in-one-crm-mcp",
    status: "ok",
    mcpEndpoint: "/mcp"
  });
});

app.post("/mcp", requireAuth, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, () => {
  console.log(`All-in-one CRM MCP server running on port ${PORT}`);
});
