import {
  Schema, EditorState, EditorView, TextSelection,
  baseKeymap, history, keymap, redo, toggleMark, undo
} from "./vendor/editor.mjs";
import {
  importPages, markLegacyImported, openLibrary, readLegacyPages, readLibrary, writePage, writeSetting
} from "./storage.js?v=3";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { dir: "auto" }, 0]
    },
    text: { group: "inline" },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM: () => ["br"]
    }
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0]
    },
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0]
    },
    underline: {
      parseDOM: [{ tag: "u" }],
      toDOM: () => ["u", 0]
    },
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["s", 0]
    }
  }
});

const workspace = document.getElementById("workspace");
const editor = document.getElementById("editor");
const formatBar = document.getElementById("format-bar");
const formatButtons = [...formatBar.querySelectorAll("button")];
const pagesButton = document.getElementById("pages-button");
const optionsButton = document.getElementById("options-button");
const pagesPanel = document.getElementById("pages-panel");
const optionsPanel = document.getElementById("options-panel");
const pageList = document.getElementById("page-list");
const themeInputs = [...document.querySelectorAll("#themes input")];
const counts = document.getElementById("counts");
const sessionStatus = document.getElementById("session-status");
const darkPreference = window.matchMedia("(prefers-color-scheme: dark)");
const touchPointer = window.matchMedia("(pointer: coarse)");
const wordSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;
const graphemeSegmenter = wordSegmenter && new Intl.Segmenter(undefined, { granularity: "grapheme" });
const numberFormat = new Intl.NumberFormat("en");
const keyBindings = keymap({
  "Mod-b": toggleMark(schema.marks.strong),
  "Mod-i": toggleMark(schema.marks.em),
  "Mod-u": toggleMark(schema.marks.underline),
  "Mod-Shift-x": toggleMark(schema.marks.strike),
  "Mod-z": undo,
  "Mod-Shift-z": redo,
  "Mod-y": redo,
  "Shift-Enter": (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  }
});

let view;
let database;
let activePage;
let chosenTheme = "system";
let openPanel;
let writeQueue = Promise.resolve();
const failedWrites = new Set();
const queuedPages = new Set();
const pages = [];

function plainText(doc) {
  return doc.textBetween(0, doc.content.size, "\n", "\n");
}

function newPage(text = "", created = Date.now()) {
  const paragraphs = text.split("\n").map((line) => schema.nodes.paragraph.create(
    null, line ? schema.text(line) : null
  ));
  return { id: crypto.randomUUID(), created, revision: 0, doc: schema.nodes.doc.create(null, paragraphs) };
}

function fromRecord(record) {
  return { ...record, doc: schema.nodeFromJSON(record.doc) };
}

function toRecord(page) {
  return { id: page.id, created: page.created, revision: page.revision, doc: page.doc.toJSON() };
}

function applyTheme() {
  const theme = chosenTheme === "system" ? (darkPreference.matches ? "charcoal" : "paper") : chosenTheme;
  document.documentElement.dataset.theme = theme;
  for (const input of themeInputs) input.checked = input.value === chosenTheme;
}

function restoreTheme(value) {
  if (value === "light") return "paper";
  if (value === "dark") return "charcoal";
  return themeInputs.some((input) => input.value === value) ? value : "system";
}

function updateStorageStatus() {
  sessionStatus.textContent = database && !failedWrites.size
    ? ""
    : "Changes may be lost when you close this page.";
}

function persist(key, write) {
  if (!database) return;
  writeQueue = writeQueue.then(async () => {
    const hadIssue = failedWrites.size > 0;
    try {
      await write();
      failedWrites.delete(key);
    } catch {
      failedWrites.add(key);
    }
    if (hadIssue !== (failedWrites.size > 0)) updateStorageStatus();
  });
}

function savePage(page) {
  if (!database || queuedPages.has(page)) return;
  queuedPages.add(page);
  persist(page, async () => {
    queuedPages.delete(page);
    const { saved, concurrent } = await writePage(database, toRecord(page), page === activePage);
    page.id = saved.id;
    page.created = saved.created;
    page.revision = saved.revision;
    if (concurrent) {
      pages.push(fromRecord(concurrent));
      if (openPanel?.panel === pagesPanel) renderPageList();
    }
  });
}

function updateCounts(doc) {
  const text = plainText(doc);
  let words = 0;
  let characters = 0;
  if (wordSegmenter) {
    for (const segment of wordSegmenter.segment(text)) {
      if (segment.isWordLike) words += 1;
    }
    for (const segment of graphemeSegmenter.segment(text)) characters += 1;
  } else {
    words = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    characters = [...text].length;
  }

  workspace.dataset.empty = String(doc.childCount === 1 && doc.firstChild.content.size === 0);
  const wordLabel = words === 1 ? "word" : "words";
  const characterLabel = characters === 1 ? "character" : "characters";
  counts.textContent = `${numberFormat.format(words)} ${wordLabel} · ${numberFormat.format(characters)} ${characterLabel}`;
}

function updateFormatBar() {
  const { selection, doc } = view.state;
  const inside = view.hasFocus() || formatBar.contains(document.activeElement);
  formatBar.hidden = selection.empty || !inside || Boolean(openPanel) || view.composing;
  if (formatBar.hidden) return;

  for (const button of formatButtons) {
    const marked = doc.rangeHasMark(selection.from, selection.to, schema.marks[button.dataset.mark]);
    button.setAttribute("aria-pressed", String(marked));
  }

  const start = view.coordsAtPos(selection.from, 1);
  const end = view.coordsAtPos(selection.to, -1);
  const { offsetWidth: width, offsetHeight: height } = formatBar;
  const viewport = window.visualViewport;
  const leftEdge = viewport?.offsetLeft ?? 0;
  const topEdge = viewport?.offsetTop ?? 0;
  const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth);
  const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight);
  const anchor = Math.abs(start.top - end.top) < 4 ? (start.left + end.left) / 2 : start.left;
  const above = start.top - height - 8;
  const below = start.bottom + 8;
  const preferBelow = touchPointer.matches && below + height <= bottomEdge - 8;
  const top = preferBelow || above < topEdge + 8 ? below : above;
  formatBar.style.left = `${Math.max(leftEdge + 8, Math.min(anchor - width / 2, rightEdge - width - 8))}px`;
  formatBar.style.top = `${Math.max(topEdge + 8, Math.min(top, bottomEdge - height - 8))}px`;
}

function createEditorState(doc) {
  return EditorState.create({ doc, plugins: [history(), keyBindings, keymap(baseKeymap)] });
}

function selectPage(page) {
  if (page !== activePage) {
    activePage = page;
    view.updateState(createEditorState(page.doc));
    editor.scrollTop = 0;
    updateCounts(page.doc);
    persist("active", () => writeSetting(database, "active", page.id));
  }
  closePanel();
  view.focus();
}

function renderPageList() {
  const items = pages.map((page, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const title = plainText(page.doc).trim().split("\n", 1)[0];
    button.type = "button";
    button.dir = "auto";
    button.textContent = title || `Untitled page ${index + 1}`;
    if (page === activePage) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => selectPage(page));
    item.append(button);
    return item;
  });
  pageList.replaceChildren(...items);
}

function closePanel(restoreFocus = false) {
  if (!openPanel) return;
  const { button, panel } = openPanel;
  panel.hidden = true;
  button.setAttribute("aria-expanded", "false");
  openPanel = undefined;
  if (restoreFocus) button.focus();
}

function togglePanel(button, panel) {
  if (openPanel?.button === button) {
    closePanel(true);
    return;
  }
  closePanel();
  if (panel === pagesPanel) renderPageList();
  openPanel = { button, panel };
  panel.hidden = false;
  button.setAttribute("aria-expanded", "true");
  updateFormatBar();
}

async function restoreLibrary() {
  const legacy = readLegacyPages();
  chosenTheme = restoreTheme(legacy?.theme);
  let saved;
  try {
    database = await openLibrary();
    saved = await readLibrary(database);
    database.onversionchange = () => {
      database.close();
      database = undefined;
      updateStorageStatus();
    };
    for (const record of saved.pages) pages.push(fromRecord(record));
    if (saved.theme) chosenTheme = restoreTheme(saved.theme);
  } catch {
    database = undefined;
  }

  if (legacy) {
    const importedAt = Date.now();
    const imported = legacy.drafts.map((draft, index) => newPage(draft, importedAt + index));
    pages.push(...imported);
    activePage = imported[legacy.active] ?? imported[0];
    if (database) {
      const records = imported.map((page) => ({ ...toRecord(page), revision: 1 }));
      try {
        await importPages(database, records, activePage?.id, saved.theme ? undefined : chosenTheme);
        for (const page of imported) page.revision = 1;
        markLegacyImported();
      } catch {
        for (const page of imported) failedWrites.add(page);
      }
    }
  }

  if (!pages.length) pages.push(newPage());
  activePage ??= pages.find((page) => page.id === saved?.active) ?? pages[0];
}

await restoreLibrary();
applyTheme();
updateStorageStatus();

view = new EditorView(editor, {
  state: createEditorState(activePage.doc),
  attributes: {
    role: "textbox",
    "aria-label": "Write your draft",
    "aria-multiline": "true",
    autocorrect: "off",
    spellcheck: "false",
    translate: "no"
  },
  dispatchTransaction(transaction) {
    view.updateState(view.state.apply(transaction));
    if (transaction.docChanged) {
      activePage.doc = view.state.doc;
      savePage(activePage);
      updateCounts(activePage.doc);
    }
    updateFormatBar();
  }
});
updateCounts(activePage.doc);

editor.addEventListener("compositionstart", () => { workspace.dataset.empty = "false"; });
editor.addEventListener("compositionend", () => requestAnimationFrame(() => updateCounts(view.state.doc)));
formatBar.addEventListener("mousedown", (event) => event.preventDefault());
formatBar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-mark]");
  if (!button) return;
  toggleMark(schema.marks[button.dataset.mark])(view.state, view.dispatch);
  view.focus();
});
document.addEventListener("focusin", updateFormatBar);
document.addEventListener("focusout", () => requestAnimationFrame(updateFormatBar));
editor.addEventListener("scroll", updateFormatBar);
window.addEventListener("resize", updateFormatBar);
window.visualViewport?.addEventListener("resize", updateFormatBar);

pagesButton.addEventListener("click", () => togglePanel(pagesButton, pagesPanel));
optionsButton.addEventListener("click", () => togglePanel(optionsButton, optionsPanel));
document.getElementById("new-page").addEventListener("click", () => {
  if (activePage.revision === 0) savePage(activePage);
  const page = newPage();
  pages.push(page);
  selectPage(page);
  savePage(page);
});

document.addEventListener("pointerdown", (event) => {
  if (openPanel && !openPanel.panel.contains(event.target) && !openPanel.button.contains(event.target)) {
    closePanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing) return;
  if (openPanel) closePanel(true);
  else if (!formatBar.hidden) {
    const { doc, selection } = view.state;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, selection.to)));
    view.focus();
  }
});

document.getElementById("themes").addEventListener("change", (event) => {
  if (!themeInputs.includes(event.target)) return;
  chosenTheme = event.target.value;
  applyTheme();
  const theme = chosenTheme;
  persist("theme", () => writeSetting(database, "theme", theme));
});
darkPreference.addEventListener("change", applyTheme);
document.getElementById("controls").hidden = false;
document.getElementById("status-bar").hidden = false;

if (window.matchMedia("(pointer: fine) and (hover: hover)").matches) view.focus();
