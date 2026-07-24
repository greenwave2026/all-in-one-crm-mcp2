import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const MCP_API_KEY = process.env.MCP_API_KEY || "";

type CRM = "zigaflow" | "spruce" | "servicem8";

type CrmConfig = {
  label: string;
  baseUrl?: string;
  apiKey?: string;
  authHeader?: string;
  authScheme?: string;
  authLocation?: "header" | "query";
};

const crmConfig: Record<CRM, CrmConfig> = {
  zigaflow: {
    label: "Zigaflow",
    baseUrl: process.env.ZIGAFLOW_BASE_URL || "https://api.zigaflow.com",
    apiKey: process.env.ZIGAFLOW_API_KEY,
    authHeader: process.env.ZIGAFLOW_AUTH_HEADER || "api_key",
    authScheme: process.env.ZIGAFLOW_AUTH_SCHEME || "none",
    authLocation: (process.env.ZIGAFLOW_AUTH_LOCATION as "header" | "query") || "query"
  },
  spruce: {
    label: "Spruce",
    baseUrl: process.env.SPRUCE_BASE_URL,
    apiKey: process.env.SPRUCE_API_KEY,
    authHeader: process.env.SPRUCE_AUTH_HEADER || "Authorization",
    authScheme: process.env.SPRUCE_AUTH_SCHEME || "Bearer",
    authLocation: (process.env.SPRUCE_AUTH_LOCATION as "header" | "query") || "header"
  },
  servicem8: {
    label: "ServiceM8",
    baseUrl: process.env.SERVICEM8_BASE_URL,
    apiKey: process.env.SERVICEM8_API_KEY,
    authHeader: process.env.SERVICEM8_AUTH_HEADER || "Authorization",
    authScheme: process.env.SERVICEM8_AUTH_SCHEME || "Bearer",
    authLocation: (process.env.SERVICEM8_AUTH_LOCATION as "header" | "query") || "header"
  }
};

function checkAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_API_KEY) return next();

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (token !== MCP_API_KEY) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null
    });
  }

  next();
}

function mcpResult(id: any, result: any) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id: any, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function authValue(config: CrmConfig) {
  if (!config.apiKey) return "";

  if (!config.authScheme || config.authScheme.toLowerCase() === "none") {
    return config.apiKey;
  }

  return `${config.authScheme} ${config.apiKey}`;
}

async function apiGet(
  config: CrmConfig,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
) {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error(`${config.label} is missing base URL or API key in Render.`);
  }

  const url = new URL(path, config.baseUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (config.authLocation === "query") {
    url.searchParams.set(config.authHeader || "api_key", config.apiKey);
  } else {
    headers[config.authHeader || "Authorization"] = authValue(config);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${config.label} API error ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeList(data: any) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return data;
}

function containsText(value: any, query: string): boolean {
  return JSON.stringify(value || {})
    .toLowerCase()
    .includes(query.toLowerCase());
}

function filterLocally(data: any, query: string) {
  const list = normalizeList(data);

  if (!Array.isArray(list)) return data;

  return list.filter((item) => containsText(item, query));
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

const tools = [
  {
    name: "list_connected_crms",
    description: "List which CRM connectors are configured on the server.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    annotations: readOnlyAnnotations
  },
  {
    name: "search_crm_records",
    description: "Search read-only CRM records across Zigaflow, Spruce, ServiceM8, or all configured CRMs.",
    inputSchema: {
      type: "object",
      properties: {
        crm: {
          type: "string",
          enum: ["zigaflow", "spruce", "servicem8", "all"]
        },
        query: {
          type: "string",
          description: "Customer name, company, email, phone, job reference, quote reference, ticket keyword, or search text."
        },
        limit: {
          type: "number",
          default: 10
        }
      },
      required: ["crm", "query"]
    },
    annotations: readOnlyAnnotations
  },
  {
    name: "get_pipeline_summary",
    description: "Get a read-only pipeline or sales/work summary from configured CRMs.",
    inputSchema: {
      type: "object",
      properties: {
        crm: {
          type: "string",
          enum: ["zigaflow", "spruce", "servicem8", "all"]
        },
        period: {
          type: "string",
          default: "last_7_days"
        }
      },
      required: ["crm"]
    },
    annotations: readOnlyAnnotations
  },
  {
    name: "get_recent_activity",
    description: "Get recent customer, sales, job, note, task, ticket, quotation, or follow-up activity. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        crm: {
          type: "string",
          enum: ["zigaflow", "spruce", "servicem8", "all"]
        },
        limit: {
          type: "number",
          default: 25
        }
      },
      required: ["crm"]
    },
    annotations: readOnlyAnnotations
  },
  {
    name: "get_followups_due",
    description: "Get upcoming or overdue follow-ups, tasks, reminders, or jobs. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        crm: {
          type: "string",
          enum: ["zigaflow", "spruce", "servicem8", "all"]
        },
        window: {
          type: "string",
          default: "next_7_days"
        }
      },
      required: ["crm"]
    },
    annotations: readOnlyAnnotations
  },
  {
    name: "get_daily_digest",
    description: "Get raw CRM data for a daily digest across configured CRMs. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Optional YYYY-MM-DD date. Defaults to today."
        }
      },
      required: []
    },
    annotations: readOnlyAnnotations
  }
];

async function zigaflowSearch(query: string, limit: number) {
  const z = crmConfig.zigaflow;

  const results: any[] = [];

  if (query.includes("@")) {
    try {
      const contactByEmail = await apiGet(z, "/v1/contacts/getbyemail", { email: query });
      results.push({ type: "contact_by_email", data: contactByEmail });
    } catch (error) {
      results.push({ type: "contact_by_email", error: String(error) });
    }
  }

  try {
    const clientByName = await apiGet(z, "/v1/clients/getByName", { name: query });
    results.push({ type: "client_by_name", data: clientByName });
  } catch (error) {
    results.push({ type: "client_by_name", error: String(error) });
  }

  const top = Math.min(Math.max(limit * 5, 25), 100);

  const sources = [
    { type: "clients", path: "/v1/clients", query: { top } },
    { type: "contacts", path: "/v1/contacts", query: { top } },
    { type: "jobs", path: "/v1/jobs", query: { top, expand: true, includeComments: true } },
    { type: "tickets", path: "/v1/tickets", query: { top } },
    { type: "quotations", path: "/v1/quotations", query: { top } },
    { type: "events", path: "/v1/events", query: { top } }
  ];

  for (const source of sources) {
    try {
      const data = await apiGet(z, source.path, source.query);
      const filtered = filterLocally(data, query);
      results.push({
        type: source.type,
        data: Array.isArray(filtered) ? filtered.slice(0, limit) : filtered
      });
    } catch (error) {
      results.push({ type: source.type, error: String(error) });
    }
  }

  return results;
}

async function zigaflowPipelineSummary(period: string) {
  const z = crmConfig.zigaflow;
  const createdFrom = period === "today" ? `${todayIsoDate()} 00:00` : isoDaysAgo(7);

  const output: any = {};

  try {
    output.pipelineTypes = await apiGet(z, "/v1/pipeline");
  } catch (error) {
    output.pipelineTypesError = String(error);
  }

  try {
    output.jobs = await apiGet(z, "/v1/jobs", {
      createdFrom,
      top: 50,
      expand: true,
      includeLinkedOrders: true,
      includeComments: true
    });
  } catch (error) {
    output.jobsError = String(error);
  }

  try {
    output.quotations = await apiGet(z, "/v1/quotations", {
      createdFrom,
      top: 50
    });
  } catch (error) {
    output.quotationsError = String(error);
  }

  try {
    output.tickets = await apiGet(z, "/v1/tickets", {
      createdFrom,
      top: 50
    });
  } catch (error) {
    output.ticketsError = String(error);
  }

  return output;
}

async function zigaflowRecentActivity(limit: number) {
  const z = crmConfig.zigaflow;
  const since = isoDaysAgo(7);
  const top = Math.min(Math.max(limit, 10), 100);

  const output: any = {};

  const reads = [
    ["clients", "/v1/clients", { createdFrom: since, top }],
    ["contacts", "/v1/contacts", { top }],
    ["jobs", "/v1/jobs", { lastUpdatedFrom: since, top, expand: true, includeComments: true }],
    ["events", "/v1/events", { createdFrom: since, top }],
    ["tickets", "/v1/tickets", { updatedFrom: since, top }],
    ["quotations", "/v1/quotations", { lastUpdatedFrom: since, top }]
  ] as const;

  for (const [key, path, query] of reads) {
    try {
      output[key] = await apiGet(z, path, query);
    } catch (error) {
      output[`${key}Error`] = String(error);
    }
  }

  return output;
}

async function zigaflowFollowupsDue(window: string) {
  const z = crmConfig.zigaflow;

  const output: any = { window };

  try {
    output.events = await apiGet(z, "/v1/events", { top: 100 });
  } catch (error) {
    output.eventsError = String(error);
  }

  try {
    output.jobs = await apiGet(z, "/v1/jobs", {
      top: 50,
      expand: true,
      includeComments: true
    });
  } catch (error) {
    output.jobsError = String(error);
  }

  try {
    output.tickets = await apiGet(z, "/v1/tickets", { top: 50 });
  } catch (error) {
    output.ticketsError = String(error);
  }

  return output;
}

async function zigaflowDailyDigest(date?: string) {
  const z = crmConfig.zigaflow;
  const targetDate = date || todayIsoDate();
  const from = `${targetDate} 00:00`;
  const to = `${targetDate} 23:59`;

  const output: any = { date: targetDate };

  const reads = [
    ["clientsCreated", "/v1/clients", { createdFrom: from, createdTo: to, top: 50 }],
    ["jobsCreated", "/v1/jobs", { createdFrom: from, createdTo: to, top: 50, expand: true, includeComments: true }],
    ["jobsUpdated", "/v1/jobs", { lastUpdatedFrom: from, lastUpdatedTo: to, top: 50, expand: true, includeComments: true }],
    ["events", "/v1/events", { createdFrom: from, createdTo: to, top: 50 }],
    ["ticketsCreated", "/v1/tickets", { createdFrom: from, createdTo: to, top: 50 }],
    ["ticketsUpdated", "/v1/tickets", { updatedFrom: from, updatedTo: to, top: 50 }],
    ["quotationsCreated", "/v1/quotations", { createdFrom: from, createdTo: to, top: 50 }],
    ["quotationsUpdated", "/v1/quotations", { lastUpdatedFrom: from, lastUpdatedTo: to, top: 50 }]
  ] as const;

  for (const [key, path, query] of reads) {
    try {
      output[key] = await apiGet(z, path, query);
    } catch (error) {
      output[`${key}Error`] = String(error);
    }
  }

  return output;
}

async function placeholderCrmCall(crm: CRM, action: string) {
  const config = crmConfig[crm];

  return {
    crm: config.label,
    ok: false,
    message: `${config.label} is still using placeholder MCP code for ${action}. Add that CRM's real API endpoints before this tool can return live data.`
  };
}

async function callTool(name: string, args: any) {
  if (name === "list_connected_crms") {
    return Object.entries(crmConfig).map(([key, config]) => ({
      crm: key,
      label: config.label,
      configured: Boolean(config.baseUrl && config.apiKey),
      authLocation: config.authLocation || "header",
      authHeader: config.authHeader || null
    }));
  }

  if (name === "search_crm_records") {
    const crm = args.crm as CRM | "all";
    const query = args.query;
    const limit = Number(args.limit || 10);

    const results: any[] = [];

    if (crm === "zigaflow" || crm === "all") {
      try {
        results.push({
          crm: "Zigaflow",
          ok: true,
          data: await zigaflowSearch(query, limit)
        });
      } catch (error) {
        results.push({ crm: "Zigaflow", ok: false, error: String(error) });
      }
    }

    if (crm === "spruce" || crm === "all") {
      results.push(await placeholderCrmCall("spruce", "search_crm_records"));
    }

    if (crm === "servicem8" || crm === "all") {
      results.push(await placeholderCrmCall("servicem8", "search_crm_records"));
    }

    return results;
  }

  if (name === "get_pipeline_summary") {
    const crm = args.crm as CRM | "all";
    const period = args.period || "last_7_days";
    const results: any[] = [];

    if (crm === "zigaflow" || crm === "all") {
      try {
        results.push({
          crm: "Zigaflow",
          ok: true,
          data: await zigaflowPipelineSummary(period)
        });
      } catch (error) {
        results.push({ crm: "Zigaflow", ok: false, error: String(error) });
      }
    }

    if (crm === "spruce" || crm === "all") {
      results.push(await placeholderCrmCall("spruce", "get_pipeline_summary"));
    }

    if (crm === "servicem8" || crm === "all") {
      results.push(await placeholderCrmCall("servicem8", "get_pipeline_summary"));
    }

    return results;
  }

  if (name === "get_recent_activity") {
    const crm = args.crm as CRM | "all";
    const limit = Number(args.limit || 25);
    const results: any[] = [];

    if (crm === "zigaflow" || crm === "all") {
      try {
        results.push({
          crm: "Zigaflow",
          ok: true,
          data: await zigafflowRecentActivitySafe(limit)
        });
      } catch (error) {
        results.push({ crm: "Zigaflow", ok: false, error: String(error) });
      }
    }

    if (crm === "spruce" || crm === "all") {
      results.push(await placeholderCrmCall("spruce", "get_recent_activity"));
    }

    if (crm === "servicem8" || crm === "all") {
      results.push(await placeholderCrmCall("servicem8", "get_recent_activity"));
    }

    return results;
  }

  if (name === "get_followups_due") {
    const crm = args.crm as CRM | "all";
    const window = args.window || "next_7_days";
    const results: any[] = [];

    if (crm === "zigaflow" || crm === "all") {
      try {
        results.push({
          crm: "Zigaflow",
          ok: true,
          data: await zigaflowFollowupsDue(window)
        });
      } catch (error) {
        results.push({ crm: "Zigaflow", ok: false, error: String(error) });
      }
    }

    if (crm === "spruce" || crm === "all") {
      results.push(await placeholderCrmCall("spruce", "get_followups_due"));
    }

    if (crm === "servicem8" || crm === "all") {
      results.push(await placeholderCrmCall("servicem8", "get_followups_due"));
    }

    return results;
  }

  if (name === "get_daily_digest") {
    const date = args.date;
    const results: any[] = [];

    try {
      results.push({
        crm: "Zigaflow",
        ok: true,
        data: await zigaflowDailyDigest(date)
      });
    } catch (error) {
      results.push({ crm: "Zigaflow", ok: false, error: String(error) });
    }

    results.push(await placeholderCrmCall("spruce", "get_daily_digest"));
    results.push(await placeholderCrmCall("servicem8", "get_daily_digest"));

    return results;
  }

  throw new Error(`Unknown tool: ${name}`);
}

// Kept separate so a typo is less likely to break the whole server.
async function zigafflowRecentActivitySafe(limit: number) {
  return zigaflowRecentActivity(limit);
}

app.get("/", (_req, res) => {
  res.json({
    name: "all-in-one-crm-mcp",
    status: "ok",
    mcpEndpoint: "/mcp"
  });
});

app.post("/mcp", checkAuth, async (req, res) => {
  const { id, method, params } = req.body || {};

  try {
    if (method === "initialize") {
      return res.json(
        mcpResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: "all-in-one-crm-mcp",
            version: "1.0.0"
          }
        })
      );
    }

    if (method === "notifications/initialized") {
      return res.status(204).send();
    }

    if (method === "tools/list") {
      return res.json(mcpResult(id, { tools }));
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const result = await callTool(toolName, toolArgs);

      return res.json(
        mcpResult(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        })
      );
    }

    return res.json(mcpError(id, -32601, `Method not found: ${method}`));
  } catch (error) {
    return res.json(
      mcpError(id, -32000, error instanceof Error ? error.message : String(error))
    );
  }
});

app.listen(PORT, () => {
  console.log(`All-in-one CRM MCP server running on port ${PORT}`);
});
