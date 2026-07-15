const $ = (id) => document.getElementById(id);

const screens = {
  setup: $("screen-setup"),
  workspace: $("screen-workspace"),
  deploy: $("screen-deploy"),
  result: $("screen-result"),
};

function showWorkspacePicker(workspaces) {
  const select = $("input-workspace");
  select.innerHTML = "";
  workspaces.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.name;
    select.appendChild(opt);
  });
  showScreen("workspace");
}

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.add("hidden"));
  screens[name].classList.remove("hidden");
}

function setPipeline(stage) {
  // stage: 'local' | 'railway' | 'telegram'
  const order = ["local", "railway", "telegram"];
  const idx = order.indexOf(stage);
  document.querySelectorAll(".node").forEach((n) => {
    n.classList.toggle("active", order.indexOf(n.dataset.node) <= idx);
  });
  document.querySelectorAll(".wire").forEach((w) => {
    const wireIdx = Number(w.dataset.wire); // 1 between local/railway, 2 between railway/telegram
    w.classList.toggle("active", wireIdx <= idx);
  });
}

function setStep(id, state) {
  // state: 'done' | 'active' | reset
  const el = $(id);
  el.classList.remove("done", "active");
  if (state) el.classList.add(state);
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "خطای ناشناخته");
  return data;
}

async function init() {
  setPipeline("local");
  try {
    const state = await api("/api/state");
    if (state.configured && !state.workspaceId && (state.workspaces || []).length > 1) {
      showWorkspacePicker(state.workspaces);
    } else if (state.configured) {
      showScreen("deploy");
      setPipeline("railway");
      runDeployFlow();
    } else {
      showScreen("setup");
    }
  } catch {
    showScreen("setup");
  }
}

$("btn-connect").addEventListener("click", async () => {
  const token = $("input-token").value.trim();
  const repo = $("input-repo").value.trim();
  const errorBox = $("setup-error");
  errorBox.classList.add("hidden");

  if (!token || !repo) {
    errorBox.textContent = "لطفا هر دو فیلد را پر کنید.";
    errorBox.classList.remove("hidden");
    return;
  }

  $("btn-connect").disabled = true;
  $("btn-connect").textContent = "در حال بررسی...";

  try {
    const data = await api("/api/token", { method: "POST", body: JSON.stringify({ token, repo }) });
    if (!data.workspaceId && (data.workspaces || []).length > 1) {
      showWorkspacePicker(data.workspaces);
    } else {
      showScreen("deploy");
      setPipeline("railway");
      runDeployFlow();
    }
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
    $("btn-connect").disabled = false;
    $("btn-connect").textContent = "تایید و اتصال";
  }
});

$("btn-workspace-confirm").addEventListener("click", async () => {
  const workspaceId = $("input-workspace").value;
  const errorBox = $("workspace-error");
  errorBox.classList.add("hidden");

  $("btn-workspace-confirm").disabled = true;
  try {
    await api("/api/workspace", { method: "POST", body: JSON.stringify({ workspaceId }) });
    showScreen("deploy");
    setPipeline("railway");
    runDeployFlow();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("hidden");
    $("btn-workspace-confirm").disabled = false;
  }
});

$("btn-reset").addEventListener("click", async () => {
  await api("/api/reset", { method: "POST" });
  location.reload();
});

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const src = $(btn.dataset.copy);
    navigator.clipboard.writeText(src.textContent).then(() => {
      const original = btn.textContent;
      btn.textContent = "کپی شد ✓";
      setTimeout(() => (btn.textContent = original), 1200);
    });
  });
});

async function runDeployFlow() {
  const statusLine = $("deploy-status-line");
  setStep("step-project", "active");

  try {
    await api("/api/deploy", { method: "POST" });
    setStep("step-project", "done");
    setStep("step-service", "done");
    setStep("step-build", "active");
    statusLine.textContent = "در حال build روی Railway... (ممکن است چند دقیقه طول بکشد)";

    await pollStatus();
  } catch (err) {
    if (err.message === "workspace_required") {
      const state = await api("/api/state");
      showWorkspacePicker(state.workspaces || []);
      return;
    }
    statusLine.textContent = `خطا: ${err.message}`;
  }
}

async function pollStatus() {
  const statusLine = $("deploy-status-line");

  const poll = async () => {
    try {
      const data = await api("/api/status");

      if (data.status === "FAILED" || data.status === "CRASHED") {
        statusLine.textContent = `دیپلوی ناموفق بود (status: ${data.status}). لاگ‌های Railway را بررسی کنید.`;
        return;
      }

      if (!data.ready) {
        statusLine.textContent = `وضعیت: ${data.status || "در حال اجرا"}...`;
        setTimeout(poll, 3000);
        return;
      }

      setStep("step-build", "done");
      setStep("step-proxy", "done");
      setStep("step-secret", "done");
      setPipeline("telegram");

      $("out-server").textContent = data.proxy.domain;
      $("out-port").textContent = data.proxy.port;
      $("out-secret").textContent = data.secret;
      $("out-link").textContent =
        `tg://proxy?server=${data.proxy.domain}&port=${data.proxy.port}&secret=${data.secret}`;

      showScreen("result");
    } catch (err) {
      statusLine.textContent = `خطا: ${err.message}`;
    }
  };

  poll();
}

init();
