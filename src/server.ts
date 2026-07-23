import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MCP_API_KEY = process.env.MCP_API_KEY || "";

type CRM = "zigaflow" | "spruce" | "servicem8";

const crmConfig = {
  zigaflow: {
    label: "Zigaflow",
    baseUrl: process.env.ZIGAFLOW_BASE_URL,
    apiKey: process.env.ZIGAFLOW_API_KEY
  },
  spruce: {
    label: "Spruce",
    baseUrl: process.env.SPRUCE_BASE_URL,
    apiKey: process.env.SPRUCE_API_KEY
  },
  servicem8: {
    label: "ServiceM8",
    baseUrl: process.env.SERVICEM8_BASE_URL,
    apiKey: process.env.SERVICEM8_API_KEY
  }
};

function checkAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!MCP_API_KEY) return next();

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (token !== MCP_API_KEY) {
    return res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized"
      },
      id: null
    });
  }

  next();
}

function mcpResult(id: any, result: any) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function mcpError(id: any, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function getTargets(crm: CRM | "all") {
  if (crm === "all") {
    return Object.entries(crmConfig)
      .filter(([, config]) => config.baseUrl && config.apiKey)
      .map(([key, config]) => ({
        key: key as CRM,
        ...config
      }));
  }

  const config = crmConfig[crm];

  if (!config.baseUrl || !config.apiKey) {
    throw new Error(`${config.label} is not configured in Render environment variables.`);
  }

  return [
    {
      key: crm,
      ...config
    }
  ];
}

async function crmGet(
  crm: {
    label: string;
    baseUrl?: string;
    apiKey?: string;
  },
  path: string,
  query: Record<string, string> = {}
) {
  if (!crm.baseUrl || !crm.apiKey) {
    throw new Error(`${crm.label} is missing baseUrl or apiKey.`);
  }

  const url = new URL(path, crm.baseUrl);

  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${crm.apiKey}`,
      Accept: "application/json"
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

const tools = [
  {
    name: "list_connected_crms",
    description: "List which CRM connectors are configured on the server.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
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
          description: "Customer name, company, email, phone, job reference, deal keyword, or search text."
        },
        limit: {
          type: "number",
          default: 10
        }
      },
      required: ["crm", "query"]
    }
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
          default: "today",
          description: "Example: today, yesterday, this_week, last_7_days, this_month."
        }
      },
      required: ["crm"]
    }
  },
  {
    name: "get_recent_activity",
    description: "Get recent customer, sales, job, note, task, or follow-up activity. Read-only.",
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
    }
  },
  {
    name: "get_followups_due",
    description: "Get upcoming or overdue follow-ups, tasks, calls, reminders, or jobs. Read-only.",
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
    }
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
    }
  }
];

async function callTool(name: string, args: any) {
  if (name === "list_connected_crms") {
    return Object.entries(crmConfig).map(([key, config]) => ({
      crm: key,
      label: config.label,
      configured: Boolean(config.baseUrl && config.apiKey)
    }));
  }

  if (name === "search_crm_records") {
    const targets = getTargets(args.crm);
    const results = [];

    for (const crm of targets) {
      try {
        // TODO: Replace /search with each CRM's real search endpoint.
        const data = await crmGet(crm, "/search", {
          q: args.query,
          limit: String(args.limit || 10)
        });
        results.push({ crm: crm.label, ok: true, data });
      } catch (error) {
        results.push({ crm: crm.label, ok: false, error: String(error) });
      }
    }

    return results;
  }

  if (name === "get_pipeline_summary") {
    const targets = getTargets(args.crm);
    const results = [];

    for (const crm of targets) {
      try {
        // TODO: Replace /pipeline/summary with each CRM's real endpoint.
        const data = await crmGet(crm, "/pipeline/summary", {
          period: args.period || "today"
        });
        results.push({ crm: crm.label, ok: true, data });
      } catch (error) {
        results.push({ crm: crm.label, ok: false, error: String(error) });
      }
    }

    return results;
  }

  if (name === "get_recent_activity") {
    const targets = getTargets(args.crm);
    const results = [];

    for (const crm of targets) {
      try {
        // TODO: Replace /activity/recent with each CRM's real endpoint.
        const data = await crmGet(crm, "/activity/recent", {
          limit: String(args.limit || 25)
        });
        results.push({ crm: crm.label, ok: true, data });
      } catch (error) {
        results.push({ crm: crm.label, ok: false, error: String(error) });
      }
    }

    return results;
  }

  if (name === "get_followups_due") {
    const targets = getTargets(args.crm);
    const results = [];

    for (const crm of targets) {
      try {
        // TODO: Replace /followups/due with each CRM's real endpoint.
        const data = await crmGet(crm, "/followups/due", {
          window: args.window || "next_7_days"
        });
        results.push({ crm: crm.label, ok: true, data });
      } catch (error) {
        results.push({ crm: crm.label, ok: false, error: String(error) });
      }
    }

    return results;
  }

  if (name === "get_daily_digest") {
    const targets = getTargets("all");
    const results = [];

    for (const crm of targets) {
      try {
        // TODO: Replace /digest/daily with each CRM's real endpoint.
        const data = await crmGet(
          crm,
          "/digest/daily",
          args.date ? { date: args.date } : {}
        );
        results.push({ crm: crm.label, ok: true, data });
      } catch (error) {
        results.push({ crm: crm.label, ok: false, error: String(error) });
      }
    }

    return results;
  }

  throw new Error(`Unknown tool: ${name}`);
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
          capabilities: {
            tools: {}
          },
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
      return res.json(
        mcpResult(id, {
          tools
        })
      );
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
