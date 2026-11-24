"use strict";

const draftKey = "noword:draft";
const pagesKey = "noword:pages";
const themeKey = "noword:theme";
const drafts = [""];
const workspace = document.querySelector(".workspace");
let editor = document.getElementById("editor");
const previewPane = document.getElementById("preview-pane");
const previewButton = document.getElementById("preview");
const themeButton = document.getElementById("theme");
const pagesButton = document.getElementById("pages-button");
const optionsButton = document.getElementById("options-button");
const pagesPanel = document.getElementById("pages-panel");
const optionsPanel = document.getElementById("options-panel");
const pageList = document.getElementById("page-list");
const newPageButton = document.getElementById("new-page");
const counts = document.getElementById("counts");
const sessionStatus = document.getElementById("session-status");
const darkPreference = window.matchMedia("(prefers-color-scheme: dark)");
const wordSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;
const graphemeSegmenter = wordSegmenter && new Intl.Segmenter(undefined, { granularity: "grapheme" });
const numberFormat = new Intl.NumberFormat("en");
const markdown = window.markdownit?.({ html: false });
let activePage = 0;
let chosenTheme;
let openPanel;
let draftStored = true;
let pagesStored = true;

function loadPages() {
  try {
    drafts[0] = sessionStorage.getItem(draftKey) ?? "";
    const storedTheme = sessionStorage.getItem(themeKey);
    if (storedTheme === "light" || storedTheme === "dark") chosenTheme = storedTheme;
    const savedPages = sessionStorage.getItem(pagesKey);
    if (!savedPages) return;

    const { additional, active } = JSON.parse(savedPages) ?? {};
    if (!Array.isArray(additional) || !additional.every((draft) => typeof draft === "string")) return;
    for (const draft of additional) drafts.push(draft);
    if (Number.isInteger(active) && active >= 0 && active < drafts.length) activePage = active;
  } catch {
    draftStored = false;
    pagesStored = false;
  }
}

function updateStorageStatus() {
  sessionStatus.textContent = draftStored && pagesStored ? "" : "Refresh recovery unavailable";
}

function savePages() {
  try {
    sessionStorage.setItem(pagesKey, JSON.stringify({ active: activePage, additional: drafts.slice(1) }));
    pagesStored = true;
  } catch {
    pagesStored = false;
  }
  updateStorageStatus();
}

function saveDraft() {
  drafts[activePage] = editor.value;
  if (activePage > 0) {
    savePages();
    return;
  }

  // Keep the original draft key as the first page so existing drafts reopen as-is.
  try {
    if (editor.value === "") sessionStorage.removeItem(draftKey);
    else sessionStorage.setItem(draftKey, editor.value);
    draftStored = true;
  } catch {
    draftStored = false;
  }
  updateStorageStatus();
}

function updateCounts() {
  const draft = editor.value;
  let words = 0;
  let characters = 0;

  if (wordSegmenter) {
    for (const segment of wordSegmenter.segment(draft)) {
      if (segment.isWordLike) words += 1;
    }
    for (const segment of graphemeSegmenter.segment(draft)) characters += 1;
  } else {
    words = draft.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
    characters = [...draft].length;
  }

  const wordLabel = words === 1 ? "word" : "words";
  const characterLabel = characters === 1 ? "character" : "characters";
  counts.textContent = `${numberFormat.format(words)} ${wordLabel} · ${numberFormat.format(characters)} ${characterLabel}`;
  previewButton.disabled = !draft.trim();
}

function setPreview(show) {
  if (show) {
    previewPane.innerHTML = markdown.render(editor.value);
    previewPane.scrollTop = 0;
  }
  editor.hidden = show;
  previewPane.hidden = !show;
  previewButton.textContent = show ? "Back to writing" : "Markdown preview";
}

function focusEditor() {
  editor.focus({ preventScroll: true });
}

function selectPage(index) {
  if (index !== activePage) {
    activePage = index;
    // A new text field keeps Undo from bringing text across pages.
    const nextEditor = editor.cloneNode(false);
    nextEditor.value = drafts[index];
    editor.replaceWith(nextEditor);
    editor = nextEditor;
    savePages();
    updateCounts();
  }
  setPreview(false);
  closePanel();
  focusEditor();
}

function renderPageList() {
  const items = drafts.map((draft, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const title = draft.trim().split("\n", 1)[0].replace(/^#{1,6}\s+/, "");
    button.type = "button";
    button.dir = "auto";
    button.textContent = title || `Untitled page ${index + 1}`;
    if (index === activePage) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => selectPage(index));
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
}

function applyTheme() {
  const theme = chosenTheme ?? (darkPreference.matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === "dark" ? "Light theme" : "Dark theme";
}

loadPages();
editor.value = drafts[activePage];
updateCounts();
updateStorageStatus();
applyTheme();

workspace.addEventListener("input", (event) => {
  if (event.target !== editor) return;
  saveDraft();
  updateCounts();
});

pagesButton.addEventListener("click", () => togglePanel(pagesButton, pagesPanel));
optionsButton.addEventListener("click", () => togglePanel(optionsButton, optionsPanel));
newPageButton.addEventListener("click", () => {
  drafts.push("");
  selectPage(drafts.length - 1);
});

document.addEventListener("pointerdown", (event) => {
  if (openPanel && !openPanel.panel.contains(event.target) && !openPanel.button.contains(event.target)) {
    closePanel();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.isComposing) return;
  if (openPanel) closePanel(true);
  else if (!previewPane.hidden) {
    setPreview(false);
    focusEditor();
  }
});

if (markdown) {
  // Render image descriptions without requesting remote assets.
  markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, index, options);
  };

  // Use classes for alignment under the page's Content Security Policy.
  for (const rule of ["th_open", "td_open"]) {
    markdown.renderer.rules[rule] = (tokens, index, options, env, renderer) => {
      const token = tokens[index];
      const styleIndex = token.attrIndex("style");
      if (styleIndex >= 0) {
        const [, style] = token.attrs.splice(styleIndex, 1)[0];
        token.attrJoin("class", `align-${style.split(":")[1]}`);
      }
      return renderer.renderToken(tokens, index, options);
    };
  }

  previewButton.hidden = false;
  previewButton.addEventListener("click", () => {
    const show = previewPane.hidden;
    setPreview(show);
    closePanel(show);
    if (!show) focusEditor();
  });
}

themeButton.addEventListener("click", () => {
  chosenTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme();
  try {
    sessionStorage.setItem(themeKey, chosenTheme);
  } catch {
    // The theme still works for the open page.
  }
});

darkPreference.addEventListener("change", applyTheme);
document.getElementById("controls").hidden = false;
document.getElementById("status-bar").hidden = false;

if (window.matchMedia("(pointer: fine) and (hover: hover)").matches) focusEditor();
