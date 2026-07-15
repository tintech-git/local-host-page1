"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const railway = require("./railwayClient");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const MTG_PORT = 8443; // must match railway-mtproto/Dockerfile's MTG_PORT

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---- Onboarding -----------------------------------------------------

app.get("/api/state", (req, res) => {
  const state = loadState();
  if (!state) return res.json({ configured: false });
  // never send the raw token back to the browser
  const { token, ...safe } = state;
  res.json({ configured: true, hasToken: Boolean(token), ...safe });
});

app.post("/api/workspace", (req, res) => {
  const { workspaceId } = req.body || {};
  const state = loadState();
  if (!state?.token) return res.status(400).json({ error: "ابتدا توکن را وارد کنید." });
  if (!workspaceId) return res.status(400).json({ error: "شناسه Workspace لازم است." });
  if (!state.workspaces?.some((w) => w.id === workspaceId)) {
    return res.status(400).json({ error: "این Workspace متعلق به این حساب نیست." });
  }
  state.workspaceId = workspaceId;
  saveState(state);
  res.json({ ok: true });
});

app.post("/api/token", async (req, res) => {
  const { token, repo } = req.body || {};
  if (!token || !repo) {
    return res.status(400).json({ error: "توکن Railway و آدرس ریپو (owner/repo) هر دو لازم هستند." });
  }
  try {
    const me = await railway.verifyToken(token);
    const workspaces = await railway.getWorkspaces(token);

    const state = loadState() || {};
    state.token = token;
    state.repo = repo;
    state.account = me;
    state.workspaces = workspaces;
    // Railway requires a workspaceId when creating a project. Most accounts
    // only have one (their personal workspace), so pick it automatically;
    // if there's more than one, the UI asks the user to choose.
    if (workspaces.length === 1) {
      state.workspaceId = workspaces[0].id;
    } else {
      delete state.workspaceId;
    }
    saveState(state);
    res.json({ ok: true, account: me, workspaces, workspaceId: state.workspaceId || null });
  } catch (err) {
    res.status(400).json({ error: `توکن تایید نشد: ${err.message}` });
  }
});

app.post("/api/reset", (req, res) => {
  if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  res.json({ ok: true });
});

// ---- Deployment orchestration ----------------------------------------

/**
 * Idempotent: safe to call every time the panel starts.
 * - First run: creates project + service on Railway, sets env vars, deploys, opens a TCP proxy.
 * - Later runs: just re-checks status and returns the existing proxy info.
 */
app.post("/api/deploy", async (req, res) => {
  const state = loadState();
  if (!state?.token) return res.status(400).json({ error: "ابتدا توکن را وارد کنید." });
  if (!state.workspaceId) {
    return res.status(400).json({
      error: "workspace_required",
      workspaces: state.workspaces || [],
    });
  }

  const { token, repo, workspaceId } = state;

  try {
    // 1. Project + service (create once, reuse afterwards)
    if (!state.projectId) {
      const { projectId, environmentId } = await railway.createProject(token, "mtproto-proxy", workspaceId);
      state.projectId = projectId;
      state.environmentId = environmentId;
      saveState(state);
    }

    if (!state.serviceId) {
      const service = await railway.createServiceFromGithub(token, {
        projectId: state.projectId,
        name: "mtproto",
        repo,
      });
      state.serviceId = service.id;
      saveState(state);

      // Fixed secret is optional - if unset, the container generates and
      // logs one on first boot, which we scrape below.
      await railway.setVariables(token, {
        projectId: state.projectId,
        environmentId: state.environmentId,
        serviceId: state.serviceId,
        variables: {
          MTG_PORT: String(MTG_PORT),
          MTG_FAKE_DOMAIN: "www.google.com",
        },
      });

      await railway.deployService(token, {
        serviceId: state.serviceId,
        environmentId: state.environmentId,
      });
    }

    res.json({ ok: true, projectId: state.projectId, serviceId: state.serviceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status", async (req, res) => {
  const state = loadState();
  if (!state?.serviceId) return res.status(400).json({ error: "هنوز دیپلوی شروع نشده." });

  const { token, projectId, environmentId, serviceId } = state;

  try {
    const deployment = await railway.getServiceStatus(token, { serviceId, environmentId });
    const status = deployment?.status || "UNKNOWN";

    if (status !== "SUCCESS") {
      return res.json({ status, ready: false });
    }

    // Deployment succeeded - make sure a TCP proxy exists.
    if (!state.proxy) {
      let proxies = await railway.listTcpProxies(token, { environmentId, serviceId });
      let proxy = proxies[0];
      if (!proxy) {
        proxy = await railway.createTcpProxy(token, {
          environmentId,
          serviceId,
          applicationPort: MTG_PORT,
        });
      }
      state.proxy = { domain: proxy.domain, port: proxy.proxyPort };
      saveState(state);
    }

    // Pull the secret mtg printed on boot, if we don't have it cached yet.
    if (!state.secret && deployment.id) {
      const logs = await railway.getDeploymentLogs(token, { deploymentId: deployment.id });
      const line = logs.find((l) => l.includes("Secret:"));
      if (line) {
        const match = line.match(/Secret:\s*(\S+)/);
        if (match) {
          state.secret = match[1];
          saveState(state);
        }
      }
    }

    res.json({
      status,
      ready: Boolean(state.proxy && state.secret),
      proxy: state.proxy,
      secret: state.secret || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PANEL_PORT || 4000;
app.listen(PORT, () => {
  console.log(`Panel running: http://localhost:${PORT}`);
});
