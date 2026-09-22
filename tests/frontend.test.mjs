import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  entityMap,
  copyMarkdown,
  splitTableRow,
  tableAlignment,
  actionState,
  actionEligibility,
  toolLabel,
  citationIds,
  createMarkdownRenderer,
  createEventDecoder,
  clientQuestionChoices,
  replyRequest,
} from "../static/js/rendering.mjs";

test("saved client clarification offers only verified choices", () => {
  const clients = ["a", "b"].map((id) => ({ type: "client", id, ref: `client:${id}`, label: id.toUpperCase() }));
  const question = "Which client should I investigate: [[client:a]] or [[client:b]]?";
  assert.deepEqual(clientQuestionChoices(question, clients), [{ label: "A", client_id: "a" }, { label: "B", client_id: "b" }]);
  assert.deepEqual(clientQuestionChoices(question, clients.slice(0, 1)), []);
  assert.deepEqual(clientQuestionChoices("Compared [[client:a]] and [[client:b]].", clients), []);
});

test("client reply preserves the task and starts a conversation in the chosen scope", () => {
  assert.deepEqual(replyRequest({ label: "Misleading model name", client_id: "a" }, "Check backups", "", [{ client_id: "a", name: "Acme" }]), { message: "Check backups", client: "a", restart: true });
  assert.throws(() => replyRequest({ label: "Unknown", client_id: "b" }, "Check backups", "", [{ client_id: "a" }]), /no longer accessible/);
});

test("generic reply sends exactly the visible answer and preserves scope", () => {
  assert.deepEqual(replyRequest({ label: "Last 24 hours", client_id: "", message: "hidden command" }, "ignored", "a"), { message: "Last 24 hours", client: "a", restart: false });
});

// Deliberately no HTML parser: an accidental HTML sink fails these renderer tests.
class TestNode {
  constructor(tag, text = "") {
    this.tagName = tag;
    this.childNodes = [];
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.scrollLeft = 0;
    this._text = text;
    this.classList = { add: (name) => (this.className += " " + name) };
  }
  set innerHTML(value) {
    throw Error("HTML interpretation is forbidden");
  }
  set textContent(value) {
    this._text = String(value);
    this.childNodes = [];
  }
  get textContent() {
    return (
      this._text + this.childNodes.map((child) => child.textContent).join("")
    );
  }
  get children() {
    return this.childNodes.filter((child) => !child.tagName.startsWith("#"));
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === "#fragment") this.append(...node.childNodes);
      else this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    this._text = "";
    this.childNodes = [];
    this.append(...nodes);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  querySelectorAll(selector) {
    const found = [];
    for (const child of this.childNodes) {
      if (
        selector.startsWith(".")
          ? child.className.split(" ").includes(selector.slice(1))
          : child.tagName === selector
      )
        found.push(child);
      found.push(...child.querySelectorAll(selector));
    }
    return found;
  }
}
const document = {
  createElement: (tag) => new TestNode(tag),
  createTextNode: (text) => new TestNode("#text", text),
  createDocumentFragment: () => new TestNode("#fragment"),
};
const agent = {
  ref: "agent:a_files",
  type: "agent",
  id: "a_files",
  label: "ACME-FILES",
  status: "online",
};
const evidence = [1, 2, 3, 4].map((number) => ({
  id: "S" + number,
  label: "Source " + number,
}));
function renderer() {
  const parent = new TestNode("div"),
    clicked = [];
  return {
    parent,
    clicked,
    render: createMarkdownRenderer({
      document,
      onEvidence: (source) => clicked.push(source.id),
      createEntityChip: (entity) => {
        const node = new TestNode("button", entity.label);
        node.className = "entity-chip";
        return node;
      },
    }),
  };
}

test("only canonical verified references become entities", () => {
  const map = entityMap([
    agent,
    { ...agent, ref: "device:a_files" },
    { ...agent, id: "../a" },
    { ...agent, type: "script" },
    null,
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get(agent.ref), agent);
});
test("copy expands verified labels and IDs while preserving code and unknown references", () => {
  assert.equal(
    copyMarkdown(
      "Use [[agent:a_files]] and [[agent:missing]]. `[[agent:a_files]]`\n```\n[[agent:a_files]]\n```",
      [agent],
    ),
    "Use ACME-FILES (a_files) and [[agent:missing]]. `[[agent:a_files]]`\n```\n[[agent:a_files]]\n```",
  );
});
test("table parsing preserves empty cells, escaped pipes, inline code, and alignment", () => {
  assert.deepEqual(splitTableRow("| One | | `x|y` | a\\|b |"), [
    "One",
    "",
    "`x|y`",
    "a|b",
  ]);
  assert.deepEqual(tableAlignment("| :--- | ---: | :---: |"), [
    "left",
    "right",
    "center",
  ]);
  assert.equal(tableAlignment("| warning | --- |"), null);
});
test("citation ranges and groups are bounded and do not allow unsafe numeric loops", () => {
  assert.deepEqual(citationIds("[S1–S3, S4]"), ["S1", "S2", "S3", "S4"]);
  assert.deepEqual(citationIds("[S1, S1; S3]"), ["S1", "S3"]);
  for (const token of [
    "[S4-S1]",
    "[S1-S9999]",
    "[S0]",
    "[S999999999999999999999999]",
    "[S1/ S2]",
  ])
    assert.deepEqual(citationIds(token), []);
});
test("Markdown interprets formatting but never HTML or script-like URLs", () => {
  const { parent, render } = renderer();
  render(
    parent,
    "## Check\n**Critical** and _literal_\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1))\n```html\n<script>alert(1)</script>\n```",
  );
  assert.equal(parent.querySelectorAll("h2").length, 1);
  assert.equal(parent.querySelectorAll("strong").length, 1);
  assert.equal(parent.querySelectorAll("img").length, 0);
  assert.equal(parent.querySelectorAll("script").length, 0);
  assert.equal(parent.querySelectorAll("a").length, 0);
  assert.match(parent.textContent, /<script>alert/);
});
test("verified entities and citations render; unknown references remain readable", () => {
  const { parent, render, clicked } = renderer();
  render(
    parent,
    "[[agent:a_files]] [[agent:unknown]] [S1–S3] [S4-S5]",
    evidence,
    [agent],
  );
  assert.equal(parent.querySelectorAll(".entity-chip").length, 1);
  assert.match(parent.textContent, /\[\[agent:unknown\]\]/);
  assert.match(parent.textContent, /\[S4-S5\]/);
  assert.equal(parent.querySelectorAll(".citation").length, 3);
  parent.querySelectorAll(".citation")[1].listeners.click();
  assert.deepEqual(clicked, ["S2"]);
});
test("inline code does not turn references into chips or citations", () => {
  const { parent, render } = renderer();
  render(parent, "`[[agent:a_files]] [S1]`", evidence, [agent]);
  assert.equal(parent.querySelectorAll(".entity-chip").length, 0);
  assert.equal(parent.querySelectorAll(".citation").length, 0);
  assert.equal(parent.querySelectorAll("code").length, 1);
});
test("streaming table has semantic headers, empty cells, and completes cleanly", () => {
  const { parent, render } = renderer();
  const head = "| Server | Status | Next step |\n| --- | --- | --- |\n";
  render(parent, head + "| [[agent:a_files]] |", evidence, [agent], {
    streaming: true,
  });
  assert.equal(parent.querySelectorAll("th").length, 3);
  assert.ok(
    parent.querySelectorAll("th").every((node) => node.scope === "col"),
  );
  assert.equal(parent.querySelectorAll("td").length, 3);
  assert.equal(parent.querySelectorAll(".streaming-row").length, 1);
  assert.equal(parent.querySelectorAll(".table-scroll")[0].tabIndex, 0);
  parent.querySelectorAll(".table-scroll")[0].scrollLeft = 72;
  render(
    parent,
    head + "| [[agent:a_files]] | Healthy | Check evidence |\n",
    evidence,
    [agent],
  );
  assert.equal(parent.querySelectorAll(".streaming-row").length, 0);
  assert.equal(parent.querySelectorAll(".table-scroll")[0].scrollLeft, 72);
  assert.equal(parent.querySelectorAll(".entity-chip").length, 1);
});
test("partial fences and lists render without exposing code as active elements", () => {
  const { parent, render } = renderer();
  render(parent, '1. First\n2. Second\n\n```sh\necho "<script>"', [], [], {
    streaming: true,
  });
  assert.equal(parent.querySelectorAll("ol").length, 1);
  assert.equal(parent.querySelectorAll("li").length, 2);
  assert.equal(parent.querySelectorAll(".streaming-block").length, 1);
  assert.equal(parent.querySelectorAll("script").length, 0);
});
test("action execution requires exact client, write mode, fresh token, idle and pending state", () => {
  const action = {
    status: "pending",
    client_id: "c_acme",
    expires_at: 200,
    confirmation: "opaque-review-token",
  };
  const context = { mode: "write", clientId: "c_acme" };
  assert.equal(actionEligibility(action, context, 100).allowed, true);
  for (const change of [
    { mode: "read" },
    { clientId: "" },
    { clientId: "c_other" },
    { busy: true },
    { executing: true },
  ])
    assert.equal(
      actionEligibility(action, { ...context, ...change }, 100).allowed,
      false,
    );
  for (const status of [
    "succeeded",
    "failed",
    "unknown",
    "cancelled",
    "running",
  ])
    assert.equal(
      actionEligibility({ ...action, status }, context, 100).allowed,
      false,
    );
  assert.equal(
    actionEligibility({ ...action, confirmation: "" }, context, 100).allowed,
    false,
  );
  assert.equal(actionEligibility(action, context, 200).allowed, false);
  assert.equal(actionState(action, 200), "expired");
});
test("event decoder accepts arbitrary chunk boundaries, CRLF, comments, and final blocks", () => {
  const events = [],
    feed = createEventDecoder((event) => events.push(event));
  const stream =
    ': heartbeat\r\n\r\ndata: {"type":"delta","text":"a"}\r\n\r\ndata: {"type":"done"}\n\ndata: [DONE]\n\n';
  for (const char of stream) feed(char);
  feed('data: {"type":"status"}', true);
  assert.deepEqual(events, [
    { type: "delta", text: "a" },
    { type: "done" },
    { type: "status" },
  ]);
});
test("tool labels explain work without exposing implementation names", () => {
  assert.equal(toolLabel("slide_device_alerts"), "Checking device alerts");
  assert.match(toolLabel("propose_action"), /review/);
  assert.equal(toolLabel("made_up_tool"), "Reading relevant evidence");
});
test("workspace template exposes eight workflows, review controls, and module entrypoint", () => {
  const html = readFileSync(
    new URL("../templates/index.html", import.meta.url),
    "utf8",
  );
  assert.equal((html.match(/data-prompt=/g) || []).length, 8);
  assert.match(html, /<script type="module" src="\/static\/js\/workspace.js(?:\?[^\"]+)?"/);
  for (const id of [
    "entity-popover",
    "mode-description",
    "action-dialog",
    "action-execute",
    "action-cancel",
    "action-refresh",
    "latest-message",
  ])
    assert.ok(html.includes(`id="${id}"`));
  assert.doesNotMatch(html, /id="action-confirmation"/);
});

test("unfinished entity and citation fragments stay hidden only during streaming", () => {
  const { parent, render } = renderer();
  for (const tail of [
    "[",
    "[[",
    "[[ag",
    "[[agent:",
    "[[agent:a_files",
    "[[agent:a_files]",
    "[S",
    "[S1",
    "[S1–",
    "[S1, S2",
  ]) {
    render(parent, "Inspect " + tail, evidence, [agent], { streaming: true });
    assert.equal(parent.textContent, "Inspect ", tail);
    render(parent, "Inspect " + tail, evidence, [agent]);
    assert.equal(parent.textContent, "Inspect " + tail, "final " + tail);
  }
  render(parent, "Inspect [[agent:a_files]] [S1]", evidence, [agent], {
    streaming: true,
  });
  assert.equal(parent.querySelectorAll(".entity-chip").length, 1);
  assert.equal(parent.querySelectorAll(".citation").length, 1);
});
test("unfinished bold renders as emphasis without a marker flash", () => {
  const { parent, render } = renderer();
  for (const text of ["A **critical", "A **critical*", "A __critical"]) {
    render(parent, text, [], [], { streaming: true });
    assert.equal(parent.textContent, "A critical");
    assert.equal(parent.querySelectorAll("strong").length, 1);
  }
  render(parent, "A **critical", [], []);
  assert.equal(parent.textContent, "A **critical");
  render(parent, "A **critical [[agent:a_", [], [], { streaming: true });
  assert.equal(parent.textContent, "A critical ");
  render(parent, "A **", [], [], { streaming: true });
  assert.equal(parent.textContent, "A ");
});
test("partial table header and separator reserve a placeholder without raw pipes", () => {
  const { parent, render } = renderer();
  for (const text of [
    "|",
    "| Agent | Status",
    "| Agent | Status |\n",
    "| Agent | Status |\n| --",
    "| Agent | Status |\n| --- | :",
  ]) {
    render(parent, text, [], [], { streaming: true });
    assert.equal(parent.textContent, "");
    assert.equal(
      parent.querySelectorAll(".streaming-table-placeholder").length,
      1,
    );
  }
  render(parent, "| Agent | Status |\n| --- | --- |\n", [], [], {
    streaming: true,
  });
  assert.equal(parent.querySelectorAll("table").length, 1);
  assert.equal(
    parent.querySelectorAll(".streaming-table-placeholder").length,
    0,
  );
  render(parent, "| literal pipe", [], []);
  assert.equal(parent.textContent, "| literal pipe");
});
test("streaming normalization preserves fenced code, inline code, and escaped markers", () => {
  const { parent, render } = renderer();
  render(parent, "```text\n| header |\n[[agent:a_\n**unfinished", [], [], {
    streaming: true,
  });
  assert.equal(parent.textContent, "| header |\n[[agent:a_\n**unfinished");
  render(parent, "`[[agent:a_` and `**bold`", [], [], { streaming: true });
  assert.equal(parent.textContent, "[[agent:a_ and **bold");
  render(parent, "\\[[agent:a_ and \\**bold", [], [], { streaming: true });
  assert.equal(parent.textContent, "[[agent:a_ and **bold");
  render(parent, "\\| literal table pipe", [], [], { streaming: true });
  assert.equal(parent.textContent, "| literal table pipe");
  assert.equal(
    parent.querySelectorAll(".streaming-table-placeholder").length,
    0,
  );
});
test("the active partial table cell uses streaming token handling", () => {
  const { parent, render } = renderer();
  render(
    parent,
    "| Server | Status |\n| --- | --- |\n| [[agent:a_files]] | **Needs [S",
    evidence,
    [agent],
    { streaming: true },
  );
  assert.equal(parent.querySelectorAll("td")[1].textContent, "Needs ");
  assert.equal(parent.querySelectorAll("strong").length, 1);
  assert.equal(parent.querySelectorAll(".entity-chip").length, 1);
});
