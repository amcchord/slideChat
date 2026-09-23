/** Safe streaming Markdown with isolated, sanitized SVG image previews. */
import { createSVGPreview } from "./svg.mjs";
const ENTITY_PATTERN =
  /\[\[(agent|device|client|backup|snapshot|alert):([A-Za-z0-9_-]+)\]\]/g;
export const ENTITY_TYPES = new Set([
  "agent",
  "device",
  "client",
  "backup",
  "snapshot",
  "alert",
]);

export function entityMap(entities = []) {
  const result = new Map();
  for (const entity of entities) {
    if (
      !entity ||
      !ENTITY_TYPES.has(entity.type) ||
      typeof entity.id !== "string"
    )
      continue;
    const ref = `${entity.type}:${entity.id}`;
    if (
      entity.ref !== ref ||
      !/^[A-Za-z0-9_-]+$/.test(entity.id) ||
      typeof entity.label !== "string"
    )
      continue;
    result.set(ref, entity);
  }
  return result;
}

export function copyMarkdown(text, entities = []) {
  const verified = entityMap(entities);
  return String(text)
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, index) => {
      if (index % 2) return part;
      return part.replace(ENTITY_PATTERN, (whole, type, id) => {
        const entity = verified.get(`${type}:${id}`);
        if (!entity) return whole;
        const prefix = ["backup", "snapshot"].includes(type) && !entity.label.toLowerCase().startsWith(type)
          ? type[0].toUpperCase() + type.slice(1) + " " : "";
        return `${prefix}${entity.label} (${id})`;
      });
    })
    .join("");
}

// Compatibility for saved questions created before structured replies existed.
// Only verified client references in an explicit client question become choices.
export function clientQuestionChoices(content, entities = []) {
  if (!/^\s*(?:which|what) client\b[^?]*\?/i.test(content)) return [];
  const verified = entityMap(entities), found = new Map();
  for (const match of String(content).matchAll(ENTITY_PATTERN)) {
    const entity = verified.get(`${match[1]}:${match[2]}`);
    if (entity?.type === "client")
      found.set(entity.id, { label: entity.label, client_id: entity.id });
  }
  return found.size >= 2 && found.size <= 8 ? [...found.values()] : [];
}

export function replyRequest(choice, original, client, clients = []) {
  if (!choice || typeof choice.label !== "string" || !choice.label.trim())
    throw Error("This answer is unavailable.");
  if (!choice.client_id) return { message: choice.label, client, restart: false };
  const selected = clients.find((item) => item.client_id === choice.client_id);
  if (!selected) throw Error("This client is no longer accessible. Refresh context.");
  if (!original) throw Error("Enter your question for this client.");
  return {
    message: original,
    client: selected.client_id,
    restart: selected.client_id !== client,
  };
}

export function splitTableRow(line) {
  let source = String(line).trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|"))
    source = source.slice(0, -1);
  const cells = [];
  let current = "",
    inCode = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\" && source[index + 1] === "|") {
      current += "|";
      index++;
    } else if (char === "`") {
      inCode = !inCode;
      current += char;
    } else if (char === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function tableAlignment(line) {
  const cells = splitTableRow(line);
  if (!cells.length || !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    return null;
  return cells.map((cell) =>
    cell.startsWith(":") && cell.endsWith(":")
      ? "center"
      : cell.endsWith(":")
        ? "right"
        : "left",
  );
}

export function actionState(action, now = Date.now() / 1000) {
  if (
    action.status === "pending" &&
    Number.isFinite(Number(action.expires_at)) &&
    Number(action.expires_at) <= now
  )
    return "expired";
  return action.status || "unknown";
}

export function actionEligibility(
  action,
  { mode, clientId, busy = false, executing = false },
  now,
) {
  if (executing)
    return {
      allowed: false,
      reason: "The request is being submitted. Do not resubmit it.",
    };
  if (actionState(action, now) !== "pending")
    return { allowed: false, reason: "" };
  if (busy)
    return {
      allowed: false,
      reason: "Wait for Chat to finish before executing a change.",
    };
  if (!clientId || clientId !== action.client_id)
    return {
      allowed: false,
      reason: "Select the client attached to this action before executing it.",
    };
  if (mode !== "write")
    return {
      allowed: false,
      reason: "Switch to Write mode to execute this reviewed action.",
    };
  if (typeof action.confirmation !== "string" || !action.confirmation)
    return {
      allowed: false,
      reason: "Refresh this review before executing the action.",
    };
  return {
    allowed: true,
    reason:
      "Only this exact action will be submitted. Current permissions and conditions are checked again.",
  };
}

export const TOOL_LABELS = {
  network_diagram: "Mapping hosts, guests, clients and Slide protection",
  ask_question: "Preparing answer choices",
  slide_inventory: "Reading the client inventory",
  slide_agent: "Inspecting server details and services",
  slide_device_alerts: "Checking device alerts",
  slide_activity: "Checking backup, recovery point, or alert evidence",
  connected_data: "Reading connected client records",
  connected_device: "Inspecting the connected RMM device",
  search_context: "Searching imported client context",
  propose_action: "Preparing a change for your review",
  propose_slide_action: "Preparing a change for your review",
  start_backup: "Preparing a backup request for review",
  pause_backups: "Preparing a backup pause for review",
  resume_backups: "Preparing backup resumption for review",
  rename_agent: "Preparing a server name change for review",
  update_agent_comments: "Preparing a server note change for review",
  resolve_alert: "Preparing an alert update for review",
  reopen_alert: "Preparing an alert update for review",
};

export function toolLabel(name) {
  return TOOL_LABELS[name] || "Reading relevant evidence";
}

/** Expand bounded citation groups; invalid or unverified references remain literal. */
export function citationIds(token) {
  if (!/^\[S\d+(?:\s*[-–,;]\s*S?\d+)*\]$/.test(token)) return [];
  const parts = token.slice(1, -1).split(/\s*[,;]\s*/),
    ids = [];
  for (const part of parts) {
    const range = part.match(/^S?(\d+)(?:\s*[-–]\s*S?(\d+))?$/);
    if (!range) return [];
    const first = Number(range[1]),
      last = range[2] ? Number(range[2]) : first;
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      first < 1 ||
      last < first ||
      last - first > 30 ||
      ids.length + last - first + 1 > 40
    )
      return [];
    for (let n = first; n <= last; n++) ids.push("S" + n);
  }
  return [...new Set(ids)];
}

// Only normalize the active streaming tail. Final text never passes through this helper.
function streamingInline(text) {
  let bold = null,
    code = null,
    end = text.length;
  for (let index = 0; index < end; index++) {
    if (text[index] === "\\") {
      index++;
      continue;
    }
    if (text[index] === "`") {
      let length = 1;
      while (text[index + length] === "`") length++;
      if (code === length) code = null;
      else if (!code) code = length;
      index += length - 1;
      continue;
    }
    if (code) continue;
    const tail = text.slice(index);
    if (text[index] === "[") {
      const entity = tail.match(/^\[\[([a-z]*)(?::[A-Za-z0-9_-]*\]?)?$/);
      const partialEntity =
        entity && [...ENTITY_TYPES].some((type) => type.startsWith(entity[1]));
      const partialCitation = /^\[S\d*(?:\s*[-–,;]\s*S?\d*)*$/.test(tail);
      if (tail === "[" || partialEntity || partialCitation) {
        end = index;
        break;
      }
    }
    const marker = text.slice(index, index + 2);
    if (marker === "**" || marker === "__") {
      if (bold === marker) bold = null;
      else if (!bold && index + 2 === end) {
        end = index;
        break;
      } else if (!bold && !/\s/.test(text[index + 2])) bold = marker;
      index++;
    }
  }
  let result = text.slice(0, end);
  if (bold) {
    // A chunk can stop halfway through the closing delimiter.
    if (result.endsWith(bold[0]) && !result.endsWith("\\" + bold[0]))
      result = result.slice(0, -1);
    result += bold;
  }
  return result;
}

export function createMarkdownRenderer({
  document,
  onEvidence = () => {},
  createEntityChip,
  createDiagram = createSVGPreview,
}) {
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function inline(
    parent,
    text,
    evidence,
    entities,
    depth = 0,
    preview = false,
  ) {
    if (preview) text = streamingInline(text);
    if (depth > 4) {
      parent.append(document.createTextNode(text));
      return;
    }
    const pattern =
      /(\\[\\`*_\[\]~|]|`[^`\n]+`|\[\[(?:agent|device|client|backup|snapshot|alert):[A-Za-z0-9_-]+\]\]|\[S\d+(?:\s*[-–,;]\s*S?\d+)*\]|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|~~[^~\n]+~~)/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(start, match.index)));
      const token = match[0];
      if (token.startsWith("\\"))
        parent.append(document.createTextNode(token.slice(1)));
      else if (token.startsWith("`"))
        parent.append(node("code", token.slice(1, -1)));
      else if (token.startsWith("[[")) {
        const ref = token.slice(2, -2),
          entity = entities.get(ref);
        parent.append(
          entity && createEntityChip
            ? createEntityChip(entity)
            : document.createTextNode(token),
        );
      } else if (token.startsWith("[S")) {
        const ids = citationIds(token),
          sources = ids.map((id) => evidence.find((item) => item.id === id));
        if (sources.length && sources.every(Boolean))
          sources.forEach((source) => {
            const button = node("button", source.id, "citation");
            button.type = "button";
            button.setAttribute(
              "aria-label",
              `View evidence ${source.id}: ${source.label}`,
            );
            button.addEventListener("click", () => onEvidence(source));
            parent.append(button);
          });
        else parent.append(document.createTextNode(token));
      } else {
        const doubled =
          token.startsWith("**") ||
          token.startsWith("__") ||
          token.startsWith("~~");
        const element = node(
          token.startsWith("~~") ? "s" : doubled ? "strong" : "em",
        );
        inline(
          element,
          token.slice(doubled ? 2 : 1, doubled ? -2 : -1),
          evidence,
          entities,
          depth + 1,
        );
        parent.append(element);
      }
      start = match.index + token.length;
    }
    parent.append(document.createTextNode(text.slice(start)));
  }
  return function renderMarkdown(
    parent,
    text,
    evidence = [],
    entityList = [],
    { streaming = false } = {},
  ) {
    const entities = entityMap(entityList),
      fragment = document.createDocumentFragment();
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const preview = streaming && index === lines.length - 1;
      if (!line.trim()) continue;
      const fence = line.match(/^\s*(`{3,}|~{3,})([\w+-]*)\s*$/);
      if (fence) {
        const block = [];
        let closed = false;
        while (++index < lines.length) {
          if (lines[index].trim().startsWith(fence[1])) {
            closed = true;
            break;
          }
          block.push(lines[index]);
        }
        if (fence[2].toLowerCase() === "svg") {
          fragment.append(createDiagram(document, block.join("\n"), {
            pending: streaming && !closed,
            incomplete: !closed,
          }));
          continue;
        }
        const pre = node("pre", undefined, "code-block");
        if (fence[2]) pre.setAttribute("aria-label", `${fence[2]} code`);
        if (streaming && !closed) pre.classList.add("streaming-block");
        pre.append(node("code", block.join("\n")));
        fragment.append(pre);
        continue;
      }
      const align =
        index + 1 < lines.length && line.includes("|")
          ? tableAlignment(lines[index + 1])
          : null;
      const headers = align ? splitTableRow(line) : [];
      if (align && align.length === headers.length) {
        const wrapper = node("div", undefined, "table-scroll");
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute(
          "aria-label",
          "Data table. Scroll horizontally for more columns.",
        );
        const table = node("table"),
          head = node("thead"),
          headRow = node("tr"),
          body = node("tbody");
        headers.forEach((cell, cellIndex) => {
          const th = node("th");
          th.scope = "col";
          th.className = `align-${align[cellIndex]}`;
          inline(th, cell, evidence, entities);
          headRow.append(th);
        });
        head.append(headRow);
        table.append(head, body);
        index++;
        while (
          index + 1 < lines.length &&
          lines[index + 1].includes("|") &&
          lines[index + 1].trim()
        ) {
          const rowLine = lines[++index],
            cells = splitTableRow(rowLine),
            row = node("tr");
          if (
            streaming &&
            index === lines.length - 1 &&
            !String(text).endsWith("\n")
          )
            row.className = "streaming-row";
          for (let cellIndex = 0; cellIndex < headers.length; cellIndex++) {
            const td = node("td");
            td.className = `align-${align[cellIndex]}`;
            inline(
              td,
              cells[cellIndex] || "",
              evidence,
              entities,
              0,
              streaming &&
                index === lines.length - 1 &&
                cellIndex === cells.length - 1,
            );
            row.append(td);
          }
          body.append(row);
        }
        wrapper.append(table);
        fragment.append(wrapper);
        continue;
      }
      if (
        streaming &&
        /^\s*\|/.test(line) &&
        lines.length - index <= 3 &&
        /^[\s|:-]*$/.test(lines.slice(index + 1).join("\n"))
      ) {
        const placeholder = node(
          "div",
          undefined,
          "streaming-table-placeholder",
        );
        placeholder.setAttribute("role", "status");
        placeholder.setAttribute("aria-label", "Table arriving");
        fragment.append(placeholder);
        break;
      }
      const heading = line.match(/^(#{1,6})\s+(.*?)(?:\s+#+)?$/);
      if (heading) {
        const h = node(heading[1].length <= 2 ? "h2" : "h3");
        inline(h, heading[2], evidence, entities, 0, preview);
        fragment.append(h);
        continue;
      }
      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
        fragment.append(node("hr"));
        continue;
      }
      const list = line.match(/^\s{0,3}([-*+] |\d+[.)] )(.*)$/);
      if (list) {
        const ordered = /^\d/.test(list[1]),
          container = node(ordered ? "ol" : "ul");
        if (ordered) container.start = parseInt(list[1], 10);
        while (index < lines.length) {
          const item = lines[index].match(/^\s{0,3}([-*+] |\d+[.)] )(.*)$/);
          if (!item || /^\d/.test(item[1]) !== ordered) {
            index--;
            break;
          }
          const li = node("li");
          inline(
            li,
            item[2],
            evidence,
            entities,
            0,
            streaming && index === lines.length - 1,
          );
          container.append(li);
          index++;
        }
        fragment.append(container);
        continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = node("blockquote");
        inline(
          quote,
          line.replace(/^>\s?/, ""),
          evidence,
          entities,
          0,
          preview,
        );
        fragment.append(quote);
        continue;
      }
      const paragraph = node("p");
      inline(paragraph, line, evidence, entities, 0, preview);
      fragment.append(paragraph);
    }
    // Keep horizontal reading position while streamed rows update.
    const offsets = [...parent.querySelectorAll(".table-scroll")].map(
      (element) => element.scrollLeft,
    );
    parent.replaceChildren(fragment);
    [...parent.querySelectorAll(".table-scroll")].forEach((element, index) => {
      element.scrollLeft = offsets[index] || 0;
    });
  };
}

/** SSE blocks can span arbitrary chunks and use LF or CRLF line endings. */
export function createEventDecoder(onEvent) {
  let buffer = "";
  return function feed(chunk, final = false) {
    buffer += chunk;
    const dispatch = (block) => {
      const raw = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (raw && raw !== "[DONE]") onEvent(JSON.parse(raw));
    };
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      dispatch(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
    }
    if (final && buffer.trim()) {
      dispatch(buffer);
      buffer = "";
    }
  };
}
