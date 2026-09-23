import {
  createMarkdownRenderer,
  createEventDecoder,
  copyMarkdown,
  entityMap,
  actionState,
  actionEligibility,
  clientQuestionChoices,
  replyRequest,
} from "./rendering.mjs";
import {
  createProgress,
  advanceProgress,
  elapsedTime,
  progressDetail,
} from "./progress.mjs";
("use strict");
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  connected: false,
  csrf: $('meta[name="csrf-token"]').content,
  client: "",
  conversation: null,
  inventory: null,
  evidence: [],
  busy: false,
  controller: null,
  mode: "read",
  modeChanging: false,
  choosingReply: false,
  actions: new Map(),
  executingActions: new Set(),
  reviewActionId: null,
  reviewLoading: false,
  progress: null,
  contextRequest: 0,
};
let progressTimer = null;
let lastProgressLog = null;
function renderProgress() {
  const progress = state.progress;
  if (!progress) return;
  const root = $("#stream-status");
  root.classList.remove("hidden");
  root.dataset.phase = progress.phase;
  const title = $("#progress-title");
  const titleText =
    progress.phase === "running" && Date.now() - progress.updated >= 30000
      ? "Waiting for an update"
      : progress.title;
  if (title.textContent !== titleText) title.textContent = titleText;
  $("#progress-time").textContent = elapsedTime(
    (progress.ended ?? Date.now()) - progress.started,
  );
  $("#progress-detail").textContent = progressDetail(progress);
  $("#progress-icon").textContent =
    progress.phase === "done" ? "✓" : progress.phase === "running" ? "" : "!";
  $("#progress-evidence").textContent =
    `${progress.sources.length} ${progress.sources.length === 1 ? "source" : "sources"} collected`;
  if (lastProgressLog !== progress.log) {
    $("#progress-log").replaceChildren(
      ...progress.log.map((entry) => {
        const row = node("li");
        row.append(
          node("span", "", entry.text),
          node("time", "", entry.elapsed),
        );
        return row;
      }),
    );
    lastProgressLog = progress.log;
  }
  $("#progress-edit").classList.toggle(
    "hidden",
    !["error", "stopped"].includes(progress.phase),
  );
}
function resetProgress() {
  clearInterval(progressTimer);
  state.progress = null;
  $("#stream-status").classList.add("hidden");
  $("#progress-activity").open = false;
  document.title = "Slide Chat";
}
const paths = {
  chat: "M4 4h16v12H9l-5 4V4Z",
  runbook:
    "M5 3h12a2 2 0 0 1 2 2v16H7a3 3 0 0 1-3-3V5a2 2 0 0 1 1-2ZM8 7h7M8 11h7M4 17h15",
  plug: "M8 3v4M16 3v4M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v4",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  shield: "M12 3 3 7v6c0 4 9 8 9 8s9-4 9-8V7l-9-4ZM8 12l3 3 5-6",
  link: "m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  receipt: "M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 7h8M8 11h8M8 15h4",
  refresh: "M20 7a9 9 0 1 0 1 7M20 3v5h-5",
  plus: "M12 5v14M5 12h14",
  search: "M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm6-2 6 6",
  lock: "M6 10h12v11H6V10ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
  monitor: "M3 4h18v12H3V4ZM8 21h8M12 16v5",
  server: "M4 3h16v7H4V3ZM4 14h16v7H4v-7ZM7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6",
  building: "M5 21V3h14v18M3 21h18M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-6h4v6",
  archive: "M3 3h18v5H3V3ZM5 8v13h14V8M9 12h6",
  alert: "m12 3 10 18H2L12 3ZM12 9v5M12 17h.01",
};
function icons(root = document) {
  $$("[data-icon]", root).forEach((el) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[el.dataset.icon] || paths.chat);
    svg.append(path);
    el.replaceChildren(svg);
  });
}
function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.add("hidden"), 6500);
}
async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": state.csrf,
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || "Request failed.");
  return body;
}
function openDialog(name) {
  if (!state.connected && name !== "login") name = "login";
  $(`#${name}-dialog`).showModal();
}
function setBusy(busy) {
  state.busy = busy;
  $("#send").classList.toggle("hidden", busy);
  $("#stop").classList.toggle("hidden", !busy);
  $("#client-select").disabled =
    busy || state.choosingReply || !state.connected;
  $("#new-chat").disabled = busy;
  $("#messages").setAttribute("aria-busy", String(busy));
  if (busy) hideEntity();
  renderMode();
  syncReplyButtons();
  renderEvidence();
}
function closeNavigation() {
  $(".sidebar").classList.remove("mobile-open");
  $("#mobile-menu").setAttribute("aria-expanded", "false");
}
function newConversation(fromChoice = false) {
  if (
    state.busy ||
    (state.choosingReply && fromChoice !== true) ||
    state.executingActions.size
  )
    return;
  closeNavigation();
  resetProgress();
  state.conversation = null;
  state.evidence = [];
  hideEntity();
  $("#messages").replaceChildren();
  $("#welcome").classList.remove("hidden");
  renderEvidence();
  renderHistory();
  $("#chat-scroll").scrollTop = 0;
  $("#message").focus({ preventScroll: true });
  updateScrollAffordance();
}
async function loadSession() {
  const data = await api("/api/session");
  Object.assign(state, data);
  state.csrf = data.csrf;
  $("#connection-count").textContent = data.connected
    ? 1 + data.connectors.length
    : 0;
  $("#openai-status").textContent = data.openai_configured
    ? "API key configured · Responses API"
    : "Add a key to enable GPT-6 Astra";
  $("#disconnect").classList.toggle("hidden", !data.connected);
  if (data.connected) {
    $("#account-label").textContent = "Slide workspace";
    $("#account-detail").textContent = "Private, encrypted session";
    $("#composer-scope").textContent = data.openai_configured
      ? "GPT-6 Astra · Read-only tools"
      : "Add an OpenAI key in Connections";
    renderHistory();
    renderConnections();
    renderEvidence();
  }
  renderMode();
  return data;
}
async function loadContext() {
  if (!state.connected) return;
  const request = ++state.contextRequest;
  const status = $("#context-status");
  status.textContent = "Loading client context…";
  status.classList.remove("hidden", "error");
  $("#refresh-context").disabled = true;
  $("#refresh-context").classList.add("refreshing");
  $("#slide-dot").classList.add("inactive");
  $("#slide-status").textContent = "Refreshing…";
  ["clients", "devices", "agents"].forEach((name) => {
    $("#stat-" + name).textContent = "—";
  });
  $("#context-sources").replaceChildren();
  const requestedClient = state.client;
  let data;
  try {
    data = await api(
      "/api/context?client_id=" + encodeURIComponent(requestedClient),
    );
  } catch (error) {
    if (requestedClient !== state.client || request !== state.contextRequest)
      return;
    $("#slide-status").textContent = "Context unavailable";
    status.textContent =
      "Client context could not load. Use Refresh to try again.";
    status.classList.add("error");
    throw error;
  } finally {
    if (request === state.contextRequest) {
      $("#refresh-context").disabled = false;
      $("#refresh-context").classList.remove("refreshing");
    }
  }
  // The initial inventory can arrive after the user reopens a client conversation.
  // Keep its selector options, but never replace that client's context with stale counts.
  if (!requestedClient) {
    state.inventory = data.inventory;
    renderClientOptions();
  }
  if (request !== state.contextRequest) return;
  status.classList.add("hidden");
  if (requestedClient !== state.client) return;
  state.context = data;
  $("#stat-clients").textContent = data.counts.clients;
  $("#stat-devices").textContent = data.counts.devices;
  $("#stat-agents").textContent = data.counts.agents;
  $("#slide-status").textContent =
    "Updated " +
    new Date(data.observed_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  $("#slide-dot").classList.remove("inactive");
  $("#client-select").disabled = state.busy || state.choosingReply;
  const sources = $("#context-sources");
  sources.replaceChildren();
  data.sources.forEach((c) => {
    const row = node("div", "context-source");
    row.append(
      node(
        "span",
        "source-letter",
        c.kind === "stripe" ? "$" : c.kind === "ninjaone" ? "N" : c.kind === "speckrmm" ? "S" : "{}",
      ),
    );
    const label = node("div");
    label.append(
      node("strong", "", c.name),
      node(
        "small",
        "",
        c.kind === "import" ? "Imported snapshot" : "Available on demand",
      ),
    );
    row.append(label);
    sources.append(row);
  });
}
function renderClientOptions() {
  const selected = state.client;
  const options = [
    ["", "All clients"],
    ...(state.inventory?.clients || []).map((c) => [
      c.client_id,
      c.name || c.client_id,
    ]),
  ];
  const select = $("#client-select");
  select.replaceChildren(
    ...options.map(([value, title]) => {
      const o = node("option", "", title);
      o.value = value;
      return o;
    }),
  );
  select.value = selected;
  const sourceSelect = $("#connector-form [name=client_id]");
  sourceSelect.replaceChildren(
    ...options
      .filter(([id]) => id)
      .map(([value, title]) => {
        const o = node("option", "", title);
        o.value = value;
        return o;
      }),
  );
  if ($("#connector-form [name=kind]").value === "speckrmm") {
    const all = node("option", "", "All clients (all-sites token only)");
    all.value = "";
    sourceSelect.append(all);
  }
  if (selected) sourceSelect.value = selected;
}
function renderHistory() {
  const history = $("#history");
  history.replaceChildren();
  (state.conversations || []).forEach((c) => {
    const row = node(
      "div",
      "history-item" + (c.id === state.conversation ? " active" : ""),
    );
    const button = node("button", "history-title", c.title);
    button.title = c.title;
    button.onclick = () => loadConversation(c.id);
    const remove = node("button", "history-delete", "×");
    remove.setAttribute("aria-label", "Delete " + c.title);
    remove.onclick = async () => {
      if (state.busy || state.choosingReply || state.executingActions.size)
        return;
      try {
        await api("/api/conversations/" + c.id, { method: "DELETE" });
        if (state.conversation === c.id) newConversation();
        await loadSession();
      } catch (e) {
        toast(e.message);
      }
    };
    row.append(button, remove);
    history.append(row);
  });
  if (!history.children.length)
    history.append(node("p", "muted empty-history", "No conversations yet."));
}
async function loadConversation(id) {
  if (state.busy || state.choosingReply || state.executingActions.size) return;
  state.choosingReply = true;
  renderMode();
  syncReplyButtons();
  hideEntity();
  resetProgress();
  try {
    const data = await api("/api/conversations/" + id);
    closeNavigation();
    state.conversation = id;
    state.client = data.client_id;
    $("#client-select").value = state.client;
    $("#welcome").classList.add("hidden");
    $("#messages").replaceChildren();
    state.evidence = [];
    data.messages.forEach((m, index) => {
      addMessage(
        m.role,
        m.content,
        m.evidence || [],
        m.usage,
        m.entities || [],
        m.actions || [],
        m.choices?.length
          ? m.choices
          : clientQuestionChoices(m.content, m.entities),
        m.reply_context || data.messages[index - 1]?.content || "",
      );
      state.evidence = m.evidence || state.evidence;
    });
    syncReplyButtons();
    renderEvidence();
    renderHistory();
    await loadContext();
    renderMode();
    scrollBottom();
  } catch (e) {
    toast(e.message);
  } finally {
    state.choosingReply = false;
    renderMode();
    syncReplyButtons();
  }
}
function renderConnections() {
  const list = $("#connection-list");
  list.replaceChildren();
  (state.connectors || []).forEach((c) => {
    const row = node("div", "connection-row");
    const label = node("div");
    label.append(
      node("strong", "", c.name),
      node("small", "", c.kind + " · " + (c.client_id || "All clients")),
    );
    const remove = node("button", "text-button", "Remove");
    remove.onclick = async () => {
      if (state.busy || state.choosingReply || state.executingActions.size)
        return;
      try {
        await api("/api/connectors/" + c.id, { method: "DELETE" });
        await loadSession();
        await loadContext();
        toast("Source disconnected.");
      } catch (e) {
        toast(e.message);
      }
    };
    row.append(label, remove);
    list.append(row);
  });
}
function connectorFields() {
  const kind = $("#connector-form [name=kind]").value;
  const root = $("#connector-fields");
  const sourceSelect = $("#connector-form [name=client_id]");
  sourceSelect.querySelector('option[value=""]')?.remove();
  sourceSelect.required = kind !== "speckrmm";
  if (kind === "speckrmm") {
    const all = node("option", "", "All clients (all-sites token only)");
    all.value = "";
    sourceSelect.append(all);
  }
  root.replaceChildren();
  const field = (name, label, type = "text", hint = "") => {
    const l = node("label", "", label);
    const i = node("input");
    i.name = name;
    i.type = type;
    i.required = true;
    i.autocomplete = "off";
    l.append(i);
    root.append(l);
    if (hint) root.append(node("p", "field-hint", hint));
  };
  if (kind === "ninjaone") {
    const l = node("label", "", "NinjaOne region");
    const select = node("select");
    select.name = "region";
    [
      ["us", "United States"],
      ["eu", "Europe"],
      ["oc", "Oceania"],
    ].forEach(([value, title]) => {
      const o = node("option", "", title);
      o.value = value;
      select.append(o);
    });
    l.append(select);
    root.append(l);
    field("organization_id", "NinjaOne organization ID");
    field("ninja_client_id", "OAuth client ID");
    field(
      "client_secret",
      "OAuth client secret",
      "password",
      "Create a machine-to-machine application with Monitoring scope and Client credentials grant. Read inventory, hardware, software, volumes, and services for this organization.",
    );
  } else if (kind === "speckrmm") {
    field(
      "site", "Speck site", "text",
      "Enter the exact site for one client, or * with All clients for a full network overview. Account-wide data is unavailable in single-client conversations.",
    );
    field(
      "api_key", "Speck read-only integration token", "password",
      "In speckrmm.com → Settings → Slide Chat, create an integration token for this site. For diagrams, also grant the relevant Proxmox connections when creating the token. Reads hosts, guests, inventory and health; no commands or remote access.",
    );
  } else if (kind === "stripe") {
    field(
      "customer_id",
      "Stripe customer ID",
      "text",
      "Use the exact cus_… ID for this Slide client. Chat will never guess customer mappings.",
    );
    field(
      "api_key",
      "Restricted Stripe API key",
      "password",
      "Grant read access to invoices and subscriptions. No payment or account modification tools are exposed.",
    );
  } else {
    field(
      "file",
      "JSON or CSV file",
      "file",
      "Up to 2 MB and 5,000 records. Bind exports from your RMM, PSA, billing, or other system to this client. Imported records are dated snapshots, not a live connection.",
    );
    $("#connector-fields [name=file]").accept =
      ".json,.csv,application/json,text/csv";
  }
}
function renderMode() {
  state.mode = state.mode === "write" ? "write" : "read";
  const write = state.mode === "write";
  $("#client-select").disabled =
    state.busy ||
    state.choosingReply ||
    state.executingActions.size > 0 ||
    !state.connected;
  $("#new-chat").disabled =
    state.busy || state.choosingReply || state.executingActions.size > 0;
  $("#send").disabled =
    state.modeChanging ||
    state.choosingReply ||
    state.executingActions.size > 0;
  $$("[data-prompt], .history-title, .history-delete").forEach((button) => {
    button.disabled =
      state.busy ||
      state.choosingReply ||
      state.modeChanging ||
      state.executingActions.size > 0;
  });
  $("#message").placeholder = state.busy
    ? "Draft a follow-up while the answer finishes…"
    : state.client
      ? "Ask about this client…"
      : "Ask about your clients…";
  document.body.classList.toggle("write-mode", write);
  $$("[data-mode]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.mode === state.mode),
    );
    button.disabled =
      state.busy ||
      state.choosingReply ||
      state.modeChanging ||
      state.executingActions.size > 0 ||
      !state.connected;
  });
  $("#mode-description").textContent = write
    ? state.client
      ? "Review each change before it runs."
      : "Select a client to prepare changes."
    : "Read only · No system changes";
  $("#context-mode").textContent = write
    ? "Write · Review required"
    : "Read · No changes";
  $("#tool-safety-label").textContent = write
    ? "Credentials stay encrypted. Every system change needs your explicit review."
    : "Credentials stay encrypted. Read mode cannot change client systems.";
  $("#composer-scope").textContent = state.openai_configured
    ? "GPT-6 Astra"
    : "Add an OpenAI key in Connections";
  if ($("#action-dialog").open && state.reviewActionId)
    renderActionReview(state.actions.get(state.reviewActionId));
}
async function changeMode(mode) {
  if (
    state.busy ||
    state.choosingReply ||
    state.modeChanging ||
    state.executingActions.size ||
    mode === state.mode
  )
    return;
  if (!state.connected) {
    openDialog("login");
    return;
  }
  if (mode === "write" && !state.client) {
    toast("Select a client before enabling Write mode.");
    $("#client-select").focus();
    return;
  }
  state.modeChanging = true;
  renderMode();
  try {
    const result = await api("/api/mode", { method: "POST", body: { mode } });
    state.mode = result.mode === "write" ? "write" : "read";
    toast(
      state.mode === "write"
        ? "Write mode enabled. Every change requires review."
        : "Read mode enabled. Tools only read data.",
    );
  } catch (error) {
    toast(error.message);
  } finally {
    state.modeChanging = false;
    renderMode();
  }
}
function nearBottom() {
  const el = $("#chat-scroll");
  return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
}
function updateScrollAffordance() {
  $("#latest-message").classList.toggle(
    "hidden",
    nearBottom() || !$("#messages").children.length,
  );
}
function preserveReadingPosition(update, follow = nearBottom()) {
  update();
  if (follow) scrollBottom();
  else updateScrollAffordance();
}
const entityTypeLabels = {
  agent: "Agent",
  device: "Slide device",
  client: "Client",
  backup: "Backup",
  snapshot: "Snapshot",
  alert: "Alert",
};
const entityTypeIcons = {
  agent: "monitor",
  device: "server",
  client: "building",
  backup: "archive",
  snapshot: "layers",
  alert: "alert",
};
function humanText(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}
function fieldValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value ?? "Not reported");
}
function entityTone(entity) {
  const status = String(entity.status || "").toLowerCase();
  if (["failed", "error", "offline", "critical", "unhealthy"].includes(status))
    return "danger";
  if (
    ["warning", "paused", "pending", "open", "unresolved"].includes(status) ||
    (entity.type === "alert" && status === "active")
  )
    return "warning";
  if (
    [
      "success",
      "succeeded",
      "completed",
      "online",
      "healthy",
      "resolved",
      "running",
    ].includes(status)
  )
    return "success";
  return "neutral";
}
let activeEntity = null,
  entityHideTimer,
  entityShowTimer;
const entityPanel = $("#entity-popover");
function hideEntity({ restoreFocus = false } = {}) {
  clearTimeout(entityHideTimer);
  clearTimeout(entityShowTimer);
  if (!activeEntity) return;
  const anchor = activeEntity.anchor;
  anchor?.setAttribute("aria-expanded", "false");
  activeEntity = null;
  entityPanel.getAnimations().forEach((animation) => animation.cancel());
  if (
    typeof entityPanel.hidePopover === "function" &&
    entityPanel.matches(":popover-open")
  )
    entityPanel.hidePopover();
  entityPanel.classList.add("hidden");
  if (restoreFocus && anchor?.isConnected) {
    anchor.dataset.suppressPreview = "true";
    anchor.focus({ preventScroll: true });
  }
}
function positionEntity() {
  if (!activeEntity?.anchor?.isConnected) {
    hideEntity();
    return;
  }
  const rect = activeEntity.anchor.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth,
    viewportHeight = window.innerHeight;
  entityPanel.style.width = `${Math.min(350, viewportWidth - 24)}px`;
  const height = Math.min(entityPanel.offsetHeight || 280, viewportHeight - 24);
  entityPanel.style.maxHeight = `${viewportHeight - 24}px`;
  entityPanel.style.left = `${Math.max(12, Math.min(rect.left, viewportWidth - entityPanel.offsetWidth - 12))}px`;
  const below = rect.bottom + height + 9 < viewportHeight;
  entityPanel.dataset.side = below ? "below" : "above";
  entityPanel.style.top = `${Math.max(12, below ? rect.bottom + 8 : rect.top - height - 8)}px`;
}
function showEntity(entity, anchor, pinned = false) {
  clearTimeout(entityHideTimer);
  if (activeEntity?.pinned && !pinned) return;
  const entering = activeEntity?.anchor !== anchor;
  activeEntity?.anchor?.setAttribute("aria-expanded", "false");
  activeEntity = {
    entity,
    anchor,
    article: anchor.closest(".message"),
    pinned,
  };
  entityPanel.replaceChildren();
  const head = node("div", "entity-popover-heading");
  const title = node("div");
  title.append(
    node("span", "eyebrow", entityTypeLabels[entity.type]),
    node("strong", "", entity.label),
  );
  const close = node("button", "icon-button", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close entity details");
  close.onclick = () => hideEntity({ restoreFocus: true });
  head.append(title, close);
  entityPanel.append(head);
  const meta = node("div", "entity-popover-meta");
  meta.append(node("code", "", entity.id));
  if (entity.status)
    meta.append(
      node(
        "span",
        `entity-status ${entityTone(entity)}`,
        humanText(entity.status),
      ),
    );
  entityPanel.append(meta);
  const fields = node("dl", "entity-fields");
  (Array.isArray(entity.fields) ? entity.fields : []).forEach((field) => {
    if (!field || typeof field.label !== "string") return;
    fields.append(
      node("dt", "", field.label),
      node("dd", "", fieldValue(field.value)),
    );
  });
  if (!fields.children.length)
    fields.append(
      node("dt", "", "Details"),
      node("dd", "", "No additional fields were returned."),
    );
  entityPanel.append(fields);
  const footer = node("div", "entity-popover-footer");
  if (entity.observed_at)
    footer.append(
      node(
        "small",
        "muted",
        "Observed " + new Date(entity.observed_at).toLocaleString(),
      ),
    );
  if (Array.isArray(entity.source_ids) && entity.source_ids.length)
    footer.append(
      node("small", "muted", "Evidence " + entity.source_ids.join(", ")),
    );
  const copy = node("button", "text-button", "Copy ID");
  copy.type = "button";
  copy.onclick = () =>
    navigator.clipboard
      .writeText(entity.id)
      .then(() => toast("ID copied."))
      .catch(() =>
        toast("Clipboard unavailable. Select and copy the displayed ID."),
      );
  footer.append(copy);
  entityPanel.append(footer);
  entityPanel.classList.remove("hidden");
  if (
    typeof entityPanel.showPopover === "function" &&
    !entityPanel.matches(":popover-open")
  )
    entityPanel.showPopover();
  anchor.setAttribute("aria-expanded", "true");
  positionEntity();
  if (entering) {
    entityPanel.getAnimations().forEach((animation) => animation.cancel());
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const offset = entityPanel.dataset.side === "below" ? -4 : 4;
      entityPanel.animate(
        [
          { opacity: 0, transform: `translateY(${offset}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 160, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
  }
  if (pinned) entityPanel.focus({ preventScroll: true });
}
function createEntityChip(entity) {
  const button = node("button", `entity-chip entity-${entity.type}`);
  button.type = "button";
  button.dataset.entityRef = entity.ref;
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", "entity-popover");
  button.setAttribute(
    "aria-label",
    `${entityTypeLabels[entity.type]} ${entity.label}. Show details.`,
  );
  const icon = node("span", "entity-icon");
  icon.dataset.icon = entityTypeIcons[entity.type] || "layers";
  icon.setAttribute("aria-hidden", "true");
  button.append(icon, node("span", "entity-label", entity.label));
  icons(button);
  if (entity.status) {
    const dot = node("span", `entity-dot ${entityTone(entity)}`);
    dot.setAttribute("aria-hidden", "true");
    button.append(dot);
  }
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch" && !state.busy) {
      clearTimeout(entityShowTimer);
      entityShowTimer = setTimeout(() => {
        if (button.isConnected && !state.busy) showEntity(entity, button);
      }, 400);
    }
  });
  button.addEventListener("pointerleave", () => {
    clearTimeout(entityShowTimer);
    if (!activeEntity?.pinned)
      entityHideTimer = setTimeout(() => hideEntity(), 180);
  });
  button.addEventListener("focus", () => {
    if (button.dataset.suppressPreview) {
      delete button.dataset.suppressPreview;
      return;
    }
    showEntity(entity, button);
  });
  button.addEventListener("blur", () => {
    if (!activeEntity?.pinned)
      entityHideTimer = setTimeout(() => {
        if (!entityPanel.contains(document.activeElement)) hideEntity();
      }, 100);
  });
  button.addEventListener("click", () => {
    if (activeEntity?.anchor === button && activeEntity.pinned) hideEntity();
    else showEntity(entity, button, true);
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hideEntity();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      showEntity(entity, button, true);
    }
  });
  return button;
}
const renderMarkdown = createMarkdownRenderer({
  document,
  onEvidence: showEvidence,
  createEntityChip,
});
function paintAnswer(
  article,
  content,
  evidence = [],
  entities = [],
  streaming = false,
) {
  const focused = document.activeElement;
  // Do not replace a table/chip currently being read with the keyboard. A queued paint runs after focus leaves.
  if (
    $(".message-body", article).contains(focused) &&
    focused !== document.body
  ) {
    article.pendingPaint = () =>
      paintAnswer(article, content, evidence, entities, streaming);
    return;
  }
  article.pendingPaint = null;
  const activeRef =
    activeEntity?.article === article ? activeEntity.entity.ref : null;
  renderMarkdown($(".message-body", article), content, evidence, entities, {
    streaming,
  });
  if (activeRef && activeEntity) {
    const replacement = $$(".entity-chip", article).find(
      (chip) => chip.dataset.entityRef === activeRef,
    );
    if (replacement) {
      activeEntity.anchor = replacement;
      replacement.setAttribute("aria-expanded", "true");
      positionEntity();
    } else hideEntity();
  }
}
function addMessage(
  role,
  content,
  evidence = [],
  usage = null,
  entities = [],
  actions = [],
  choices = [],
  replyContext = "",
) {
  const article = node("article", "message " + role);
  if (role === "assistant") {
    const label = node("div", "message-label"),
      img = node("img");
    img.src = "/static/slide-mark.svg";
    img.alt = "";
    label.append(img, document.createTextNode("Slide Chat"));
    article.append(label);
  }
  const body = node("div", "message-body");
  article.append(body);
  if (role === "user") body.textContent = content;
  else paintAnswer(article, content, evidence, entities);
  article.addEventListener("focusout", () =>
    setTimeout(() => {
      if (article.pendingPaint && !body.contains(document.activeElement)) {
        const paint = article.pendingPaint;
        article.pendingPaint = null;
        preserveReadingPosition(paint);
      }
    }, 0),
  );
  if (role === "assistant") {
    const proposals = node("div", "action-proposals");
    article.append(proposals);
    registerActions(actions);
    renderArticleActions(article, actions);
    renderReplies(article, choices, replyContext);
    if (content) addAnswerFooter(article, content, entities, usage);
  }
  $("#messages").append(article);
  return article;
}
function syncReplyButtons() {
  const latest = $$(".message.assistant").at(-1);
  $$(".reply-button").forEach((button) => {
    button.disabled =
      state.busy ||
      state.choosingReply ||
      state.modeChanging ||
      state.executingActions.size > 0 ||
      button.closest(".message") !== latest;
  });
}
async function answerChoice(choice, original) {
  if (
    state.busy ||
    state.choosingReply ||
    state.modeChanging ||
    state.executingActions.size
  )
    return;
  state.choosingReply = true;
  renderMode();
  syncReplyButtons();
  try {
    // Use the complete workspace inventory, not a previous client's filtered view.
    if (
      choice.client_id &&
      !state.inventory?.clients?.some(
        (client) => client.client_id === choice.client_id,
      )
    ) {
      const context = await api("/api/context");
      state.inventory = context.inventory;
      renderClientOptions();
    }
    const request = replyRequest(
      choice,
      original,
      state.client,
      state.inventory?.clients || [],
    );
    if (request.restart) {
      newConversation(true);
      state.client = request.client;
      $("#client-select").value = state.client;
      await loadContext();
      renderMode();
    }
    $("#message").value = "";
    await sendMessage(request.message, true);
  } catch (error) {
    toast(error.message);
  } finally {
    state.choosingReply = false;
    renderMode();
    syncReplyButtons();
  }
}
function renderReplies(article, choices = [], original = "") {
  $(".reply-options", article)?.remove();
  if (!Array.isArray(choices) || !choices.length) return;
  const group = node("div", "reply-options");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Answer this question");
  choices.slice(0, 8).forEach((choice) => {
    if (typeof choice?.label !== "string") return;
    const button = node("button", "button reply-button", choice.label);
    button.type = "button";
    button.onclick = () => answerChoice(choice, original);
    group.append(button);
  });
  article.append(group);
  syncReplyButtons();
}

const clientPicker = node("dialog", "client-picker");
clientPicker.id = "client-picker";
clientPicker.setAttribute("aria-labelledby", "client-picker-title");
document.body.append(clientPicker);
async function startPrompt(button) {
  if (
    state.busy ||
    state.choosingReply ||
    state.modeChanging ||
    state.executingActions.size
  )
    return;
  if (!state.connected) return openDialog("login");
  const prompt = button.dataset.prompt;
  if (state.client || button.dataset.clientRequired !== "true")
    return sendMessage(prompt);
  state.choosingReply = true;
  renderMode();
  try {
    if (!state.inventory?.clients?.length) await loadContext();
    const clients = state.inventory?.clients || [];
    if (clients.length === 1) {
      state.choosingReply = false;
      return await answerChoice(
        { client_id: clients[0].client_id, label: clients[0].name },
        prompt,
      );
    }
    clientPicker.replaceChildren();
    const head = node("div", "dialog-head"),
      title = node("h2", "", "Choose a client"),
      close = node("button", "icon-button", "×");
    title.id = "client-picker-title";
    close.type = "button";
    close.setAttribute("aria-label", "Close client picker");
    close.onclick = () => clientPicker.close();
    head.append(title, close);
    const filter = node("input", "client-filter");
    filter.type = "search";
    filter.placeholder = "Find a client";
    filter.setAttribute("aria-label", "Find a client");
    const options = node("div", "client-options");
    function paintClients() {
      options.replaceChildren();
      clients
        .filter((client) =>
          (client.name || client.client_id)
            .toLowerCase()
            .includes(filter.value.toLowerCase()),
        )
        .forEach((client) => {
          const pick = node(
            "button",
            "button",
            client.name || client.client_id,
          );
          pick.type = "button";
          pick.onclick = () => {
            clientPicker.close();
            answerChoice(
              {
                label: client.name || client.client_id,
                client_id: client.client_id,
              },
              prompt,
            );
          };
          options.append(pick);
        });
      if (!options.children.length)
        options.append(node("p", "muted", "No matching clients."));
    }
    filter.oninput = paintClients;
    paintClients();
    clientPicker.append(head, filter, options);
    clientPicker.showModal();
  } catch (error) {
    toast(error.message);
  } finally {
    state.choosingReply = false;
    renderMode();
    syncReplyButtons();
  }
}
function addAnswerFooter(article, content, entities, usage) {
  $(".message-actions", article)?.remove();
  const footer = node("div", "message-actions");
  const copy = node("button", "text-button", "Copy answer");
  copy.type = "button";
  copy.onclick = () =>
    navigator.clipboard
      .writeText(copyMarkdown(content, entities))
      .then(() => toast("Answer copied with readable entity names."))
      .catch(() =>
        toast("Clipboard unavailable. Select the answer to copy it."),
      );
  footer.append(copy);
  if (state.conversation) {
    const link = node("a", "text-button", "Export with evidence");
    link.href =
      "/api/conversations/" +
      encodeURIComponent(state.conversation) +
      "/export";
    footer.append(link);
  }
  if (usage)
    footer.append(
      node(
        "span",
        "text-button",
        (
          (usage.input_tokens || 0) + (usage.output_tokens || 0)
        ).toLocaleString() + " tokens",
      ),
    );
  article.append(footer);
}
function registerActions(actions = [], fresh = false) {
  actions.forEach((action) => {
    if (!action || typeof action.id !== "string") return;
    const known = state.actions.get(action.id);
    if (
      !fresh &&
      known &&
      ["succeeded", "failed", "unknown", "cancelled", "canceled"].includes(
        known.status,
      ) &&
      action.status === "pending"
    )
      return;
    state.actions.set(action.id, action);
  });
}
const actionLabels = {
  pending: "Review required",
  succeeded: "Request accepted",
  failed: "Failed",
  unknown: "Outcome unconfirmed",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  expired: "Expired",
  running: "Submitting",
  executing: "Submitting",
};
function renderActionCard(action) {
  const status = actionState(action),
    card = node("section", "action-card");
  card.dataset.actionId = action.id;
  const top = node("div", "action-card-heading");
  top.append(
    node("strong", "", action.label || "Proposed change"),
    node(
      "span",
      `action-status status-${status}`,
      actionLabels[status] || humanText(status),
    ),
  );
  card.append(top);
  const target = node("div", "action-target");
  target.append(
    node("span", "muted", entityTypeLabels[action.target?.type] || "Target"),
    node(
      "strong",
      "",
      action.target?.label || action.target?.id || "Unknown target",
    ),
  );
  card.append(target);
  card.append(
    node(
      "p",
      "action-summary",
      action.result?.message ||
        action.summary ||
        "Review the exact effect before proceeding.",
    ),
  );
  const controls = node("div", "action-card-controls");
  const review = node(
    "button",
    "button small",
    status === "pending" ? "Review action" : "View status",
  );
  review.type = "button";
  review.onclick = () => openActionReview(action.id);
  controls.append(review);
  if (status === "pending") {
    const cancel = node("button", "text-button", "Cancel proposal");
    cancel.type = "button";
    cancel.disabled = state.executingActions.has(action.id);
    cancel.onclick = () => cancelAction(action.id);
    controls.append(cancel);
    controls.append(node("small", "muted", "Nothing has run yet."));
  }
  card.append(controls);
  return card;
}
function renderArticleActions(article, actions) {
  const proposals = $(".action-proposals", article);
  if (!proposals) return;
  proposals.replaceChildren(
    ...actions.map((action) =>
      renderActionCard(state.actions.get(action.id) || action),
    ),
  );
}
function refreshActionCards(id) {
  $$(".action-card")
    .filter((card) => card.dataset.actionId === id)
    .forEach((card) =>
      card.replaceWith(renderActionCard(state.actions.get(id))),
    );
}
function actionFields(title, data) {
  const section = node("section", "action-values");
  section.append(node("h3", "", title));
  const list = node("dl");
  if (data && typeof data === "object" && !Array.isArray(data))
    Object.entries(data).forEach(([key, value]) => {
      list.append(
        node("dt", "", humanText(key)),
        node("dd", "", fieldValue(value)),
      );
    });
  else
    list.append(
      node("dd", "", data === undefined ? "Not reported" : fieldValue(data)),
    );
  if (!list.children.length)
    list.append(node("dd", "", "No existing value to change."));
  section.append(list);
  return section;
}
function renderActionReview(action) {
  if (!action) return;
  const status = actionState(action),
    eligible = actionEligibility(action, {
      mode: state.mode,
      clientId: state.client,
      busy: state.busy || state.choosingReply,
      executing: state.executingActions.has(action.id) || state.reviewLoading,
    });
  $("#action-title").textContent = action.label || "Review proposed change";
  $("#action-review-status").textContent =
    actionLabels[status] || humanText(status);
  $("#action-review-status").className = `action-status status-${status}`;
  $("#action-target-label").textContent =
    action.target?.label || action.target?.id || "Unknown target";
  $("#action-target-id").textContent = action.target?.id || "";
  $("#action-client-label").textContent =
    state.inventory?.clients?.find((c) => c.client_id === action.client_id)
      ?.name ||
    action.client_id ||
    "Unknown client";
  $("#action-summary").textContent = action.summary || "";
  $("#action-comparison").replaceChildren(
    actionFields("Before", action.before),
    actionFields("After", action.after),
  );
  const result = $("#action-result");
  result.replaceChildren();
  result.classList.toggle(
    "hidden",
    !action.result && !["unknown", "failed", "expired"].includes(status),
  );
  if (action.result?.message)
    result.append(node("p", "", action.result.message));
  else if (status === "expired")
    result.append(
      node(
        "p",
        "",
        "This proposal expired. Ask Chat to prepare a fresh action using current data.",
      ),
    );
  else if (status === "unknown")
    result.append(
      node(
        "p",
        "",
        "The result is not confirmed. Refresh the action status before taking another step.",
      ),
    );
  if (action.result?.data) {
    const details = node("details");
    details.append(
      node("summary", "", "Returned evidence"),
      node("pre", "", JSON.stringify(action.result.data, null, 2)),
    );
    result.append(details);
  }
  $("#action-expiry").textContent =
    status === "pending" && action.expires_at
      ? "Review expires " + new Date(action.expires_at * 1000).toLocaleString()
      : "";
  $("#action-review-note").textContent = eligible.reason;
  $("#action-execute").disabled = !eligible.allowed;
  $("#action-execute").classList.toggle("hidden", status !== "pending");
  $("#action-execute").textContent = state.executingActions.has(action.id)
    ? "Submitting…"
    : action.label || "Execute action";
  $("#action-execute").setAttribute(
    "aria-label",
    `${action.label || "Execute action"} for ${action.target?.label || action.target?.id || "the reviewed target"}`,
  );
  $("#action-cancel").classList.toggle("hidden", status !== "pending");
  $("#action-cancel").disabled = state.executingActions.has(action.id);
  $("#action-refresh").disabled = state.executingActions.has(action.id);
}
async function openActionReview(id) {
  hideEntity();
  state.reviewActionId = id;
  state.reviewLoading = true;
  if (!$("#action-dialog").open) $("#action-dialog").showModal();
  $("#action-error").textContent = "";
  $("#action-execute").disabled = true;
  $("#action-refresh").disabled = true;
  const known = state.actions.get(id);
  if (known) renderActionReview(known);
  $("#action-execute").disabled = true;
  $("#action-review-note").textContent =
    "Refreshing the target and current action status…";
  try {
    const response = await api("/api/actions/" + encodeURIComponent(id));
    const action = response.action || response;
    if (action.id !== id)
      throw Error("The action returned an unexpected identity.");
    registerActions([action], true);
    refreshActionCards(id);
    if (state.reviewActionId === id && $("#action-dialog").open) {
      state.reviewLoading = false;
      renderActionReview(action);
    }
  } catch (error) {
    if (state.reviewActionId === id) {
      $("#action-error").textContent = error.message;
      $("#action-execute").disabled = true;
    }
  } finally {
    if (state.reviewActionId === id) $("#action-refresh").disabled = false;
  }
}
async function executeAction() {
  const id = state.reviewActionId,
    action = state.actions.get(id);
  if (
    state.reviewLoading ||
    !action ||
    !actionEligibility(action, {
      mode: state.mode,
      clientId: state.client,
      busy: state.busy || state.choosingReply,
      executing: state.executingActions.has(id),
    }).allowed
  )
    return;
  state.executingActions.add(id);
  $("#action-error").textContent = "";
  renderMode();
  renderActionReview(action);
  try {
    const response = await api(
      "/api/actions/" + encodeURIComponent(id) + "/execute",
      {
        method: "POST",
        body: { confirmation: action.confirmation, client_id: state.client },
      },
    );
    const current = response.action || response;
    if (current.id !== id)
      throw Error("Could not confirm this action’s result.");
    registerActions([current], true);
    toast(
      current.result?.message ||
        actionLabels[actionState(current)] ||
        "Action status updated.",
    );
  } catch (error) {
    registerActions([
      {
        ...action,
        status: "unknown",
        result: {
          message:
            "The outcome could not be confirmed. Refresh status before taking another step.",
        },
      },
    ]);
    $("#action-error").textContent = error.message;
  } finally {
    state.executingActions.delete(id);
    renderMode();
    refreshActionCards(id);
    if (state.reviewActionId === id) renderActionReview(state.actions.get(id));
  }
}
async function cancelAction(id) {
  if (state.executingActions.has(id)) return;
  state.executingActions.add(id);
  renderMode();
  refreshActionCards(id);
  if (state.reviewActionId === id) renderActionReview(state.actions.get(id));
  try {
    const response = await api(
      "/api/actions/" + encodeURIComponent(id) + "/cancel",
      { method: "POST", body: {} },
    );
    const action = response.action || response;
    if (action.id !== id)
      throw Error("Could not confirm this proposal’s status.");
    registerActions([action], true);
    toast("Proposal status updated.");
  } catch (error) {
    toast(error.message);
  } finally {
    state.executingActions.delete(id);
    renderMode();
    refreshActionCards(id);
    if (state.reviewActionId === id) renderActionReview(state.actions.get(id));
  }
}

function renderEvidence() {
  $("#evidence-count").textContent = state.evidence.length;
  $("#mobile-evidence-count").textContent = state.evidence.length;
  for (const list of [$("#evidence-list"), $("#sources-list")]) {
    const focusedSource = list.contains(document.activeElement)
      ? document.activeElement.dataset.sourceId
      : null;
    list.replaceChildren();
    if (!state.evidence.length) {
      list.append(
        node(
          "p",
          "muted evidence-empty",
          state.busy
            ? "Waiting for the first source. Evidence will appear as it is read."
            : "Run a workflow or ask a question to collect evidence.",
        ),
      );
      continue;
    }
    [...state.evidence].reverse().forEach((source) => {
      const card = node("button", "evidence-card");
      card.dataset.sourceId = source.id;
      card.append(
        node("strong", "", source.id + " · " + source.label),
        node("small", "", new Date(source.observed_at).toLocaleTimeString()),
      );
      card.onclick = () => showEvidence(source);
      list.append(card);
    });
    if (focusedSource) {
      $$(".evidence-card", list)
        .find((card) => card.dataset.sourceId === focusedSource)
        ?.focus({ preventScroll: true });
    }
  }
}
function showEvidence(source) {
  $("#evidence-title").textContent = source.id + " · " + source.label;
  $("#evidence-time").textContent =
    "Observed " + new Date(source.observed_at).toLocaleString();
  $("#evidence-data").textContent = JSON.stringify(source.data, null, 2);
  $("#evidence-dialog").showModal();
}
function scrollBottom() {
  const el = $("#chat-scroll");
  el.scrollTop = el.scrollHeight;
  updateScrollAffordance();
}
async function sendMessage(message, fromChoice = false) {
  if (
    state.busy ||
    (state.choosingReply && fromChoice !== true) ||
    state.modeChanging ||
    state.executingActions.size
  )
    return;
  if (!state.connected) {
    openDialog("login");
    return;
  }
  if (!state.openai_configured) {
    openDialog("connections");
    return;
  }
  if (state.mode === "write" && !state.client) {
    toast("Select a client for Write mode, or switch to Read.");
    $("#client-select").focus();
    return;
  }
  const follow = nearBottom();
  $("#welcome").classList.add("hidden");
  addMessage("user", message);
  const article = addMessage("assistant", ""),
    body = $(".message-body", article);
  state.evidence = [];
  setBusy(true);
  state.controller = new AbortController();
  if (follow) scrollBottom();
  else updateScrollAffordance();
  $("#answer-announcement").textContent = "";
  state.progress = createProgress();
  $("#progress-activity").open = false;
  $("#progress-edit").onclick = () => {
    if (!$("#message").value.trim()) $("#message").value = message;
    $("#message").focus();
  };
  renderProgress();
  clearInterval(progressTimer);
  progressTimer = setInterval(renderProgress, 1000);
  document.title = "Working · Slide Chat";
  let answer = "",
    completed = false,
    evidence = [],
    entities = [],
    actions = [],
    renderFrame = null;
  function paintNow() {
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = null;
    preserveReadingPosition(() =>
      paintAnswer(article, answer, evidence, entities, !completed),
    );
  }
  function schedulePaint() {
    if (renderFrame === null) renderFrame = requestAnimationFrame(paintNow);
  }
  function receive(event) {
    state.progress = advanceProgress(state.progress, event);
    renderProgress();
    if (event.type === "conversation") state.conversation = event.id;
    else if (event.type === "delta") {
      answer += event.text || "";
      schedulePaint();
    } else if (event.type === "evidence") {
      evidence = [
        ...evidence.filter((item) => item.id !== event.evidence.id),
        event.evidence,
      ];
      state.evidence = evidence;
      renderEvidence();
      schedulePaint();
    } else if (event.type === "entities") {
      entities = [
        ...entityMap([
          ...entities,
          ...(Array.isArray(event.entities) ? event.entities : []),
        ]).values(),
      ];
      schedulePaint();
    } else if (event.type === "action") {
      const action = event.action;
      if (!action?.id) return;
      registerActions([action]);
      actions = [...actions.filter((item) => item.id !== action.id), action];
      preserveReadingPosition(() => renderArticleActions(article, actions));
    } else if (event.type === "error")
      throw Error(event.error || "The response could not finish.");
    else if (event.type === "done") {
      completed = true;
      answer = event.content ?? answer;
      $("#answer-announcement").textContent =
        "Slide Chat finished its response.";
      document.title = "Answer ready · Slide Chat";
      evidence = Array.isArray(event.evidence) ? event.evidence : evidence;
      entities = Array.isArray(event.entities) ? event.entities : entities;
      actions = Array.isArray(event.actions) ? event.actions : actions;
      state.evidence = evidence;
      renderEvidence();
      registerActions(actions);
      paintNow();
      preserveReadingPosition(() => {
        renderArticleActions(article, actions);
        renderReplies(
          article,
          event.choices || clientQuestionChoices(answer, entities),
          event.reply_context || message,
        );
        addAnswerFooter(article, answer, entities, event.usage);
      });
    }
  }
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": state.csrf,
      },
      body: JSON.stringify({
        message,
        client_id: state.client,
        conversation_id: state.conversation,
      }),
      signal: state.controller.signal,
    });
    if (!response.ok) {
      const error = await response.json();
      throw Error(error.error || "The message could not be sent.");
    }
    if (!response.body)
      throw Error("This browser could not open the response stream.");
    const reader = response.body.getReader(),
      decoder = new TextDecoder(),
      feed = createEventDecoder(receive);
    while (true) {
      const { done, value } = await reader.read();
      feed(decoder.decode(value || new Uint8Array(), { stream: !done }), done);
      if (done) break;
    }
    if (!completed) throw Error("The response ended before completion.");
    await loadSession();
  } catch (error) {
    paintNow();
    const detail =
      error.name === "AbortError"
        ? "Stopped receiving this answer. In-flight API work may still finish."
        : error.message;
    if (!completed) {
      state.progress = advanceProgress(state.progress, {
        type: error.name === "AbortError" ? "stopped" : "error",
        error: detail,
      });
      renderProgress();
      document.title = "Response interrupted · Slide Chat";
    }
    if (!completed)
      preserveReadingPosition(() =>
        body.append(node("p", "form-error", detail)),
      );
    else toast("Answer complete. The conversation list could not refresh.");
    if (!completed) state.conversation = null;
  } finally {
    clearInterval(progressTimer);
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    setBusy(false);
    state.controller = null;
    updateScrollAffordance();
  }
}

$$("[data-mode]").forEach((button) =>
  button.addEventListener("click", () => changeMode(button.dataset.mode)),
);
$("#latest-message").onclick = () => scrollBottom();
$("#chat-scroll").addEventListener(
  "scroll",
  () => {
    updateScrollAffordance();
    if (activeEntity) positionEntity();
  },
  { passive: true },
);
window.addEventListener("resize", () => {
  if (activeEntity) positionEntity();
});
document.addEventListener(
  "scroll",
  () => {
    if (activeEntity) positionEntity();
  },
  true,
);
entityPanel.addEventListener("pointerenter", () =>
  clearTimeout(entityHideTimer),
);
entityPanel.addEventListener("pointerleave", () => {
  if (!activeEntity?.pinned)
    entityHideTimer = setTimeout(() => hideEntity(), 180);
});
entityPanel.addEventListener("focusout", () =>
  setTimeout(() => {
    if (
      activeEntity &&
      !entityPanel.contains(document.activeElement) &&
      document.activeElement !== activeEntity.anchor
    )
      hideEntity();
  }, 0),
);
document.addEventListener("pointerdown", (event) => {
  if (
    activeEntity &&
    !entityPanel.contains(event.target) &&
    !activeEntity.anchor.contains(event.target)
  )
    hideEntity();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activeEntity) {
    event.preventDefault();
    hideEntity({ restoreFocus: true });
  }
});
$("#action-execute").onclick = executeAction;
$("#action-cancel").onclick = () => cancelAction(state.reviewActionId);
$("#action-refresh").onclick = () => openActionReview(state.reviewActionId);
$("#action-dialog").addEventListener("close", () => {
  state.reviewActionId = null;
  state.reviewLoading = false;
});
setInterval(() => {
  const action = state.actions.get(state.reviewActionId);
  if (
    $("#action-dialog").open &&
    action &&
    actionState(action) === "expired" &&
    $("#action-review-status").textContent !== actionLabels.expired
  ) {
    renderActionReview(action);
    refreshActionCards(action.id);
  }
}, 1000);

$("#mobile-menu").onclick = () => {
  const open = $(".sidebar").classList.toggle("mobile-open");
  $("#mobile-menu").setAttribute("aria-expanded", String(open));
};
$$(".sidebar .nav,.sidebar .new-chat").forEach((b) =>
  b.addEventListener("click", () => {
    $(".sidebar").classList.remove("mobile-open");
    $("#mobile-menu").setAttribute("aria-expanded", "false");
  }),
);
icons();
try {
  document.body.classList.toggle(
    "dark",
    localStorage.getItem("slide-chat-theme") === "dark",
  );
} catch {}
$("#theme-toggle").onclick = () => {
  document.body.classList.toggle("dark");
  try {
    localStorage.setItem(
      "slide-chat-theme",
      document.body.classList.contains("dark") ? "dark" : "light",
    );
  } catch {}
};
$$("[data-open]").forEach(
  (b) => (b.onclick = () => openDialog(b.dataset.open)),
);
$$(".close-dialog").forEach(
  (b) => (b.onclick = () => b.closest("dialog").close()),
);
$$("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d && d.id !== "login-dialog") d.close();
  }),
);
$("#login-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget,
    button = $("button", form);
  button.disabled = true;
  $(".form-error", form).textContent = "";
  try {
    const data = await api("/api/session", {
      method: "POST",
      body: { slide_key: form.slide_key.value },
    });
    state.csrf = data.csrf;
    form.reset();
    $("#login-dialog").close();
    await loadSession();
    await loadContext();
    toast("Slide connected. Your client context is ready.");
  } catch (error) {
    $(".form-error", form).textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("#openai-form").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  try {
    await api("/api/openai", { method: "POST", body: { key: form.key.value } });
    form.reset();
    await loadSession();
    toast("OpenAI key saved securely.");
  } catch (error) {
    toast(error.message);
  }
};
$("#connector-form [name=kind]").onchange = connectorFields;
connectorFields();
$("#connector-form").onsubmit = async (e) => {
  e.preventDefault();
  const form = e.currentTarget,
    button = $("button[type=submit]", form);
  button.disabled = true;
  $(".form-error", form).textContent = "";
  try {
    const values = Object.fromEntries(new FormData(form));
    const body = {
      kind: values.kind,
      name: values.name,
      client_id: values.client_id,
      config: {},
    };
    if (values.kind === "ninjaone")
      body.config = {
        client_id: values.ninja_client_id,
        client_secret: values.client_secret,
        organization_id: values.organization_id,
        region: values.region,
      };
    else if (values.kind === "speckrmm")
      body.config = { site: values.site, api_key: values.api_key };
    else if (values.kind === "stripe")
      body.config = {
        customer_id: values.customer_id,
        api_key: values.api_key,
      };
    else {
      const file = values.file;
      if (file.size > 2000000) throw Error("Choose a file smaller than 2 MB.");
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".csv")) body.csv = text;
      else body.records = JSON.parse(text);
    }
    await api("/api/connectors", { method: "POST", body });
    form.reset();
    connectorFields();
    await loadSession();
    await loadContext();
    toast("Source connected and tested.");
  } catch (error) {
    $(".form-error", form).textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$("#client-select").onchange = async (e) => {
  state.client = e.target.value;
  if (!state.client && state.mode === "write") await changeMode("read");
  newConversation();
  renderMode();
  try {
    await loadContext();
  } catch (error) {
    toast(error.message);
  }
};
$("#refresh-context").onclick = async () => {
  try {
    await loadContext();
    toast("Context refreshed.");
  } catch (error) {
    toast(error.message);
    $("#slide-status").textContent = "Refresh failed";
  }
};
$("#new-chat").onclick = newConversation;
$("#chat-nav").onclick = newConversation;
$("#chat-form").onsubmit = (e) => {
  e.preventDefault();
  if (
    state.busy ||
    state.choosingReply ||
    state.modeChanging ||
    state.executingActions.size
  )
    return;
  const message = $("#message").value.trim();
  if (message) {
    $("#message").value = "";
    sendMessage(message);
  }
};
$("#message").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
};
$$("[data-prompt]").forEach(
  (button) => (button.onclick = () => startPrompt(button)),
);
$("#stop").onclick = () => state.controller?.abort();
$("#disconnect").onclick = async () => {
  if (state.busy || state.choosingReply || state.executingActions.size) {
    toast("Finish the current response or action before disconnecting.");
    return;
  }
  if (
    !window.confirm(
      "Disconnect and erase this workspace, including conversations, connections, and companion access?",
    )
  )
    return;
  try {
    await api("/api/session", { method: "DELETE" });
    location.reload();
  } catch (e) {
    toast(e.message);
  }
};
$("#create-token").onclick = async () => {
  try {
    const data = await api("/api/token", { method: "POST", body: {} });
    $("#companion-token").value = data.token;
    $("#token-output").classList.remove("hidden");
    toast("Token created. Copy it now; it is shown only in this dialog.");
  } catch (e) {
    toast(e.message);
  }
};
$("#copy-token").onclick = () =>
  navigator.clipboard
    .writeText($("#companion-token").value)
    .then(() => toast("Token copied."));
$("#companion-dialog").addEventListener("close", () => {
  $("#companion-token").value = "";
  $("#token-output").classList.add("hidden");
});
(async () => {
  try {
    await loadSession();
    if (state.connected) await loadContext();
    else openDialog("login");
  } catch (error) {
    toast(error.message);
  }
})();
