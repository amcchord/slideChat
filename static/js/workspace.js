"use strict";
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
};
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
  $("#client-select").disabled = busy || !state.connected;
  $("#new-chat").disabled = busy;
  $("#stream-status").classList.toggle("hidden", !busy);
}
function newConversation() {
  if (state.busy) return;
  state.conversation = null;
  state.evidence = [];
  $("#messages").replaceChildren();
  $("#welcome").classList.remove("hidden");
  renderEvidence();
  renderHistory();
  $("#chat-scroll").scrollTop = 0;
  $("#message").focus({ preventScroll: true });
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
  }
  return data;
}
async function loadContext() {
  if (!state.connected) return;
  $("#slide-status").textContent = "Refreshing…";
  ["clients", "devices", "agents"].forEach((name) => {
    $("#stat-" + name).textContent = "—";
  });
  $("#context-sources").replaceChildren();
  const data = await api(
    "/api/context?client_id=" + encodeURIComponent(state.client),
  ).catch((error) => {
    $("#slide-status").textContent = "Context unavailable";
    throw error;
  });
  state.context = data;
  if (!state.client) {
    state.inventory = data.inventory;
    renderClientOptions();
  }
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
  $("#client-select").disabled = state.busy;
  const sources = $("#context-sources");
  sources.replaceChildren();
  data.sources.forEach((c) => {
    const row = node("div", "context-source");
    row.append(
      node(
        "span",
        "source-letter",
        c.kind === "stripe" ? "$" : c.kind === "ninjaone" ? "N" : "{}",
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
    ["", "All accessible clients"],
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
    history.append(
      node(
        "p",
        "muted empty-history",
        "Your work stays here. Pick up where you left off.",
      ),
    );
}
async function loadConversation(id) {
  if (state.busy) return;
  try {
    const data = await api("/api/conversations/" + id);
    state.conversation = id;
    state.client = data.client_id;
    $("#client-select").value = state.client;
    $("#welcome").classList.add("hidden");
    $("#messages").replaceChildren();
    state.evidence = [];
    data.messages.forEach((m) => {
      addMessage(m.role, m.content, m.evidence || [], m.usage);
      state.evidence = m.evidence || state.evidence;
    });
    renderEvidence();
    renderHistory();
    await loadContext();
    scrollBottom();
  } catch (e) {
    toast(e.message);
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
      node("small", "", c.kind + " · " + c.client_id),
    );
    const remove = node("button", "text-button", "Remove");
    remove.onclick = async () => {
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
function addMessage(role, content, evidence = [], usage = null) {
  const article = node("article", "message " + role);
  if (role === "assistant") {
    const label = node("div", "message-label");
    const img = node("img");
    img.src = "/static/slide-mark.svg";
    img.alt = "";
    label.append(img, document.createTextNode("Slide Chat"));
    if (usage)
      label.append(
        node(
          "small",
          "",
          (usage.input_tokens + usage.output_tokens).toLocaleString() +
            " tokens",
        ),
      );
    article.append(label);
  }
  const body = node("div", "message-body");
  article.append(body);
  if (role === "user") body.textContent = content;
  else renderMarkdown(body, content, evidence);
  if (role === "assistant" && content) {
    const actions = node("div", "message-actions");
    const copy = node("button", "text-button", "Copy answer");
    copy.onclick = () =>
      navigator.clipboard
        .writeText(content)
        .then(() => toast("Answer copied."));
    actions.append(copy);
    if (state.conversation) {
      const exportLink = node("a", "text-button", "Export with evidence");
      exportLink.href = "/api/conversations/" + state.conversation + "/export";
      actions.append(exportLink);
    }
    article.append(actions);
  }
  $("#messages").append(article);
  return article;
}
// This renderer creates DOM nodes only. Raw model HTML, links, scripts and event attributes are never inserted.
function inline(parent, text, evidence) {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\])/g;
  let start = 0;
  for (const match of text.matchAll(re)) {
    parent.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0];
    if (token.startsWith("**"))
      parent.append(node("strong", "", token.slice(2, -2)));
    else if (token.startsWith("`"))
      parent.append(node("code", "", token.slice(1, -1)));
    else {
      const source = evidence.find((e) => "[" + e.id + "]" === token);
      if (source) {
        const button = node("button", "citation", source.id);
        button.onclick = () => showEvidence(source);
        parent.append(button);
      } else parent.append(document.createTextNode(token));
    }
    start = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(start)));
}
function renderMarkdown(parent, text, evidence) {
  parent.replaceChildren();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const block = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        block.push(lines[i]);
      parent.append(node("pre", "", block.join("\n")));
      continue;
    }
    if (!line.trim()) continue;
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])
    ) {
      const table = node("table");
      const headers = line
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean);
      const tr = node("tr");
      headers.forEach((cell) => {
        const th = node("th");
        inline(th, cell, evidence);
        tr.append(th);
      });
      table.append(tr);
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes("|")) {
        const row = node("tr");
        lines[++i]
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .forEach((cell) => {
            const td = node("td");
            inline(td, cell.trim(), evidence);
            row.append(td);
          });
        table.append(row);
      }
      parent.append(table);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      const h = node(heading[1].length <= 2 ? "h2" : "h3");
      inline(h, heading[2], evidence);
      parent.append(h);
      continue;
    }
    const list = line.match(/^(?:[-*]|\d+\.)\s+(.*)/);
    if (list) {
      const ul = node(/^\d/.test(line) ? "ol" : "ul");
      const li = node("li");
      inline(li, list[1], evidence);
      ul.append(li);
      if (/^\d/.test(line)) ul.start = parseInt(line);
      parent.append(ul);
      continue;
    }
    const p = node("p");
    inline(p, line, evidence);
    parent.append(p);
  }
}
function renderEvidence() {
  const list = $("#evidence-list");
  list.replaceChildren();
  $("#evidence-count").textContent = state.evidence.length;
  if (!state.evidence.length) {
    list.append(
      node(
        "p",
        "muted evidence-empty",
        "Source reads appear here as Chat investigates.",
      ),
    );
    return;
  }
  state.evidence.forEach((source) => {
    const card = node("button", "evidence-card");
    card.append(
      node("strong", "", source.id + " · " + source.label),
      node("small", "", new Date(source.observed_at).toLocaleTimeString()),
    );
    card.onclick = () => showEvidence(source);
    list.append(card);
  });
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
}
async function sendMessage(message) {
  if (state.busy) return;
  if (!state.connected) {
    openDialog("login");
    return;
  }
  if (!state.openai_configured) {
    openDialog("connections");
    return;
  }
  $("#welcome").classList.add("hidden");
  addMessage("user", message);
  const article = addMessage("assistant", "");
  const body = $(".message-body", article);
  state.evidence = [];
  renderEvidence();
  setBusy(true);
  state.controller = new AbortController();
  $("#stream-status").textContent = "Reading your workspace";
  let answer = "",
    completed = false;
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
      throw Error(error.error);
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const raw = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!raw) continue;
        const event = JSON.parse(raw);
        if (event.type === "conversation") state.conversation = event.id;
        if (event.type === "delta") {
          answer += event.text;
          body.textContent = answer;
          scrollBottom();
        }
        if (event.type === "status")
          $("#stream-status").textContent = event.text;
        if (event.type === "tool")
          $("#stream-status").textContent =
            event.status === "error"
              ? event.error
              : "Reading " + event.name.replaceAll("_", " ");
        if (event.type === "evidence") {
          state.evidence.push(event.evidence);
          renderEvidence();
        }
        if (event.type === "error") throw Error(event.error);
        if (event.type === "done") {
          completed = true;
          renderMarkdown(body, event.content, event.evidence);
          const actions = node("div", "message-actions");
          const copy = node("button", "text-button", "Copy answer");
          copy.onclick = () =>
            navigator.clipboard
              .writeText(event.content)
              .then(() => toast("Answer copied."));
          const exp = node("a", "text-button", "Export with evidence");
          exp.href = "/api/conversations/" + state.conversation + "/export";
          actions.append(
            copy,
            exp,
            node(
              "span",
              "text-button",
              (
                event.usage.input_tokens + event.usage.output_tokens
              ).toLocaleString() + " tokens",
            ),
          );
          article.append(actions);
        }
      }
      if (done) break;
    }
    if (!completed) throw Error("The response ended before completion.");
    await loadSession();
  } catch (error) {
    const message =
      error.name === "AbortError"
        ? "Stopped receiving this answer. In-flight API work may still finish."
        : error.message;
    body.append(node("p", "form-error", message));
    toast(message);
    if (!completed) state.conversation = null;
  } finally {
    setBusy(false);
    state.controller = null;
    scrollBottom();
  }
}
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
  newConversation();
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
  (b) =>
    (b.onclick = () => {
      if (state.busy) return;
      $("#message").value = b.dataset.prompt;
      $("#message").focus();
    }),
);
$("#stop").onclick = () => state.controller?.abort();
$("#disconnect").onclick = async () => {
  if (state.busy) {
    toast("Finish the current response before disconnecting.");
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
