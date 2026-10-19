let apiKey = "";
let dashboardUsers = [];
let userPlans = [];

const $ = (id) => document.getElementById(id);

function setMessage(id, message, tone = "") {
  const element = $(id);
  element.textContent = message;
  element.className = `message ${tone}`.trim();
}

function setBusy(button, busy, busyLabel) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyLabel : button.dataset.label;
}

function setConnected(connected) {
  document.body.classList.toggle("connected", connected);
  $("connectionLabel").textContent = connected ? "Connected" : "Disconnected";
  $("connectionDot").classList.toggle("online", connected);
  $("connectButton").disabled = connected;
  $("disconnectButton").disabled = !connected;
  $("refreshButton").disabled = !connected;

  for (const id of [
    "newUserName",
    "newUserPlan",
    "createUserButton",
    "planName",
    "planAllowance",
    "planRequestLimit",
    "createPlanButton",
    "userSelect",
    "units",
    "consumeButton"
  ]) {
    $(id).disabled = !connected;
  }
}

async function api(path, options = {}) {
  const headers = {
    "x-api-key": apiKey,
    ...(options.headers || {})
  };
  if (options.body) headers["content-type"] = "application/json";

  const response = await fetch(`/api${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : {};

  if (!response.ok) {
    if (response.status === 401) {
      apiKey = "";
      setConnected(false);
    }
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function addRow(container, title, detail, className = "data-row") {
  const row = document.createElement("div");
  row.className = className;
  const first = document.createElement("span");
  first.textContent = String(title);
  const second = document.createElement("span");
  second.textContent = String(detail);
  row.append(first, second);
  container.append(row);
  return row;
}

function formatRejectionReasons(reasons) {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return "Quota or request limit exceeded.";
  }

  return reasons.map((reason) => {
    if (typeof reason === "string") return reason;
    if (!reason || typeof reason !== "object") return "Quota limit exceeded.";

    const subject = reason.subject || "quota";
    const rule = String(reason.rule || "limit").replaceAll("_", " ");
    if (reason.limit !== undefined && reason.actual !== undefined) {
      return `${subject} ${rule}: ${reason.actual} exceeds ${reason.limit}`;
    }
    return `${subject} ${rule}`;
  }).join("; ");
}

function formatNumber(value) {
  return Number(value).toLocaleString();
}

function fillPlanSelect(select, selectedId) {
  select.replaceChildren();
  for (const plan of userPlans) {
    const option = document.createElement("option");
    option.value = plan.id;
    option.textContent = `${plan.name} — ${formatNumber(plan.monthlyAllowance)}/month`;
    option.selected = plan.id === selectedId;
    select.append(option);
  }
}

function renderUsers() {
  const container = $("userList");
  const consumeSelect = $("userSelect");
  container.replaceChildren();
  consumeSelect.replaceChildren();
  $("userCount").textContent = String(dashboardUsers.length);

  if (dashboardUsers.length === 0) {
    container.className = "stack empty";
    container.textContent = "No users yet. Create the first user here.";
    return;
  }

  container.className = "stack";
  for (const user of dashboardUsers) {
    const row = document.createElement("div");
    row.className = "manage-row";

    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = user.name;
    const meta = document.createElement("span");
    meta.className = "muted small";
    meta.textContent = user.plan?.name || "Unknown plan";
    identity.append(name, meta);

    const controls = document.createElement("div");
    controls.className = "row-controls";
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Plan for ${user.name}`);
    fillPlanSelect(select, user.planId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary compact";
    button.textContent = "Assign";
    button.addEventListener("click", async () => {
      setBusy(button, true, "Saving…");
      try {
        await api(`/users/${user.id}/plan`, {
          method: "PUT",
          body: JSON.stringify({ planId: select.value })
        });
        setMessage("userResult", `Updated ${user.name}'s plan.`, "success");
        await loadDashboard();
      } catch (error) {
        setMessage("userResult", error.message, "error");
      } finally {
        setBusy(button, false, "Saving…");
      }
    });
    controls.append(select, button);
    row.append(identity, controls);
    container.append(row);

    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.name;
    consumeSelect.append(option);
  }
}

function renderPlans() {
  const container = $("planList");
  container.replaceChildren();
  $("planCount").textContent = String(userPlans.length);
  fillPlanSelect($("newUserPlan"));

  if (userPlans.length === 0) {
    container.className = "stack empty";
    container.textContent = "No user plans are available.";
    return;
  }

  container.className = "stack";
  for (const plan of userPlans) {
    const type = plan.isPredefined ? "Predefined" : "Custom";
    addRow(
      container,
      `${plan.name} · ${type}`,
      `${formatNumber(plan.monthlyAllowance)}/month · ${formatNumber(plan.maxUnitsPerRequest)}/request`
    );
  }
}

function renderHistory(history) {
  const container = $("historyList");
  container.replaceChildren();

  if (history.length === 0) {
    container.className = "stack empty";
    container.textContent = "No usage requests have been recorded.";
    return;
  }

  container.className = "stack";
  for (const item of history) {
    const row = document.createElement("div");
    row.className = "history-row";
    const top = document.createElement("div");
    top.className = "history-top";
    const title = document.createElement("strong");
    title.textContent = `${item.userName || "Historical user"} · ${formatNumber(item.requestedUnits)} credits`;
    const badge = document.createElement("span");
    badge.className = `decision ${item.decision}`;
    badge.textContent = item.decision;
    top.append(title, badge);

    const detail = document.createElement("span");
    detail.className = "muted small";
    const timestamp = new Date(item.createdAt).toLocaleString();
    const plan = item.userPlanName ? ` · ${item.userPlanName}` : "";
    detail.textContent = `${timestamp}${plan}`;
    row.append(top, detail);

    if (item.decision === "rejected") {
      const reasons = document.createElement("span");
      reasons.className = "reasons";
      reasons.textContent = formatRejectionReasons(item.rejectionReasons);
      row.append(reasons);
    }
    container.append(row);
  }
}

async function loadDashboard() {
  const [accountData, summary, usersData, historyData, predefined, custom] =
    await Promise.all([
      api("/accounts/me"),
      api("/usage/summary"),
      api("/users"),
      api("/usage/history"),
      api("/plans"),
      api("/plans/custom")
    ]);

  dashboardUsers = usersData.users;
  userPlans = [
    ...predefined.plans.filter((plan) => plan.scope === "user").map(
      (plan) => ({ ...plan, isPredefined: true })
    ),
    ...custom.plans
  ];

  $("accountName").textContent =
    `${accountData.account.name} · ${accountData.account.plan.name} plan`;
  $("monthStart").textContent = summary.monthStart;
  $("allowance").textContent = formatNumber(summary.account.monthlyAllowance);
  $("consumed").textContent = formatNumber(summary.account.consumed);
  $("remaining").textContent = formatNumber(summary.account.remaining);

  const percentage = summary.account.monthlyAllowance > 0
    ? (summary.account.consumed / summary.account.monthlyAllowance) * 100
    : 0;
  const bounded = Math.min(100, Math.max(0, percentage));
  $("progressBar").style.width = `${bounded}%`;
  $("progressText").textContent = `${bounded.toFixed(1)}%`;
  const progress = document.querySelector(".progress");
  progress.setAttribute("aria-valuenow", String(Math.round(bounded)));

  renderPlans();
  renderUsers();
  renderHistory(historyData.history);
}

function clearDashboard() {
  dashboardUsers = [];
  userPlans = [];
  $("accountName").textContent = "Connect an account to begin.";
  for (const id of ["allowance", "consumed", "remaining", "monthStart"]) {
    $(id).textContent = "—";
  }
  $("progressBar").style.width = "0%";
  $("progressText").textContent = "0%";
  $("userCount").textContent = "0";
  $("planCount").textContent = "0";
  $("userList").className = "stack empty";
  $("userList").textContent = "Connect to load users.";
  $("planList").className = "stack empty";
  $("planList").textContent = "Connect to load plans.";
  $("historyList").className = "stack empty";
  $("historyList").textContent = "Connect to load history.";
  $("userSelect").replaceChildren();
  $("newUserPlan").replaceChildren();
}

$("connectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("connectButton");
  apiKey = $("apiKey").value.trim();
  $("apiKey").value = "";

  if (!apiKey) {
    setMessage("message", "Enter an API key.", "error");
    return;
  }

  setBusy(button, true, "Connecting…");
  try {
    await loadDashboard();
    setConnected(true);
    setMessage("message", "Account connected successfully.", "success");
  } catch (error) {
    apiKey = "";
    setConnected(false);
    clearDashboard();
    setMessage("message", error.message, "error");
  } finally {
    setBusy(button, false, "Connecting…");
    button.disabled = Boolean(apiKey);
  }
});

$("disconnectButton").addEventListener("click", () => {
  apiKey = "";
  $("apiKey").value = "";
  setConnected(false);
  clearDashboard();
  for (const id of ["consumeResult", "userResult", "planResult"]) {
    setMessage(id, "");
  }
  setMessage("message", "Disconnected.");
});

$("refreshButton").addEventListener("click", async () => {
  const button = $("refreshButton");
  setBusy(button, true, "Refreshing…");
  try {
    await loadDashboard();
    setMessage("message", "Dashboard refreshed.", "success");
  } catch (error) {
    setMessage("message", error.message, "error");
  } finally {
    setBusy(button, false, "Refreshing…");
    button.disabled = !apiKey;
  }
});

$("createUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("createUserButton");
  const name = $("newUserName").value.trim();
  const planId = $("newUserPlan").value;

  if (!name || !planId) {
    setMessage("userResult", "Name and plan are required.", "error");
    return;
  }

  setBusy(button, true, "Creating…");
  try {
    await api("/users", {
      method: "POST",
      body: JSON.stringify({ name, planId })
    });
    $("newUserName").value = "";
    setMessage("userResult", `Created ${name}.`, "success");
    await loadDashboard();
  } catch (error) {
    setMessage("userResult", error.message, "error");
  } finally {
    setBusy(button, false, "Creating…");
    button.disabled = !apiKey;
  }
});

$("createPlanForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("createPlanButton");
  const name = $("planName").value.trim();
  const monthlyAllowance = Number($("planAllowance").value);
  const maxUnitsPerRequest = Number($("planRequestLimit").value);

  if (
    !name ||
    !Number.isSafeInteger(monthlyAllowance) || monthlyAllowance <= 0 ||
    !Number.isSafeInteger(maxUnitsPerRequest) || maxUnitsPerRequest <= 0 ||
    maxUnitsPerRequest > monthlyAllowance
  ) {
    setMessage("planResult", "Enter valid limits; the request limit cannot exceed the monthly allowance.", "error");
    return;
  }

  setBusy(button, true, "Creating…");
  try {
    await api("/plans/custom", {
      method: "POST",
      body: JSON.stringify({ name, monthlyAllowance, maxUnitsPerRequest })
    });
    $("createPlanForm").reset();
    setMessage("planResult", `Created ${name}.`, "success");
    await loadDashboard();
  } catch (error) {
    setMessage("planResult", error.message, "error");
  } finally {
    setBusy(button, false, "Creating…");
    button.disabled = !apiKey;
  }
});

$("consumeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("consumeButton");
  const userId = $("userSelect").value;
  const units = Number($("units").value);

  if (!userId || !Number.isSafeInteger(units) || units <= 0) {
    setMessage("consumeResult", "Select a user and enter positive whole credits.", "error");
    return;
  }

  setBusy(button, true, "Submitting…");
  try {
    const result = await api("/usage/consume", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ userId, units })
    });

    if (result.accepted) {
      setMessage(
        "consumeResult",
        result.replayed
          ? "Request already processed; no additional credits were consumed."
          : `Accepted ${formatNumber(units)} credits.`,
        "success"
      );
    } else {
      setMessage(
        "consumeResult",
        `Rejected: ${formatRejectionReasons(result.rejectionReasons)}`,
        "error"
      );
    }
    await loadDashboard();
  } catch (error) {
    setMessage("consumeResult", error.message, "error");
  } finally {
    setBusy(button, false, "Submitting…");
    button.disabled = !apiKey || dashboardUsers.length === 0;
  }
});

setConnected(false);
