"use strict";

const draftKey = "noword:draft";
const themeKey = "noword:theme";
const editor = document.getElementById("editor");
const writingArea = document.getElementById("writing-area");
const previewPane = document.getElementById("preview-pane");
const writeButton = document.getElementById("write");
const previewButton = document.getElementById("preview");
const focusButton = document.getElementById("focus");
const focusLabel = document.getElementById("focus-label");
const themeButton = document.getElementById("theme");
const wordCount = document.getElementById("word-count");
const sessionStatus = document.getElementById("session-status");
const sessionDetails = document.getElementById("session-details");
const session = sessionStatus.closest("details");
const normalSessionDetails = sessionDetails.textContent;
const darkPreference = window.matchMedia("(prefers-color-scheme: dark)");
const wordSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;
const numberFormat = new Intl.NumberFormat("en");
const markdown = window.markdownit?.({ html: false });
let chosenTheme;

function showStorageStatus(available, initial = false) {
  const status = available ? "Draft stays in this tab" : "Refresh recovery unavailable";
  if (sessionStatus.textContent === status) return;

  sessionStatus.textContent = status;
  sessionDetails.textContent = available ? normalSessionDetails : initial
    ? "This browser has blocked session storage. Your draft is available while this page is open."
    : "The browser couldn’t keep your latest edits. Keep this page open to retain them.";
}

function updateWordCount() {
  const draft = editor.value;
  let words = 0;

  if (wordSegmenter) {
    for (const segment of wordSegmenter.segment(draft)) {
      if (segment.isWordLike) words += 1;
    }
  } else {
    words = draft.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  }

  wordCount.textContent = `${numberFormat.format(words)} ${words === 1 ? "word" : "words"}`;
}

function retainDraft() {
  try {
    if (editor.value === "") {
      sessionStorage.removeItem(draftKey);
    } else {
      sessionStorage.setItem(draftKey, editor.value);
    }
    showStorageStatus(true);
  } catch {
    showStorageStatus(false);
  }
}

function setView(showPreview) {
  if (showPreview) {
    if (editor.value.trim()) {
      previewPane.innerHTML = markdown.render(editor.value);
    } else {
      const empty = document.createElement("p");
      empty.className = "preview-empty";
      empty.textContent = "Start writing to see a preview.";
      previewPane.replaceChildren(empty);
    }
    previewPane.scrollTop = 0;
  }

  writingArea.hidden = showPreview;
  previewPane.hidden = !showPreview;
  writeButton.setAttribute("aria-pressed", String(!showPreview));
  previewButton.setAttribute("aria-pressed", String(showPreview));
  if (!showPreview) editor.focus({ preventScroll: true });
}

function setFocus(active) {
  document.body.classList.toggle("is-focused", active);
  focusButton.setAttribute("aria-pressed", String(active));
  focusLabel.textContent = active ? "Exit focus" : "Focus";
  session.open = false;
  if (active) setView(false);
  else focusButton.focus({ preventScroll: true });
}

function applyTheme() {
  const theme = chosenTheme ?? (darkPreference.matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
}

try {
  editor.value = sessionStorage.getItem(draftKey) ?? "";
  const storedTheme = sessionStorage.getItem(themeKey);
  if (storedTheme === "light" || storedTheme === "dark") chosenTheme = storedTheme;
} catch {
  showStorageStatus(false, true);
}

updateWordCount();
applyTheme();
document.getElementById("status-bar").hidden = false;

editor.addEventListener("input", () => {
  retainDraft();
  updateWordCount();
});

if (markdown) {
  // Show image descriptions without making requests to URLs from the draft.
  markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content);
  markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, index, options);
  };
  writeButton.addEventListener("click", () => setView(false));
  previewButton.addEventListener("click", () => setView(true));
  document.getElementById("mode-switch").hidden = false;
}

focusButton.addEventListener("click", () => setFocus(!document.body.classList.contains("is-focused")));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.isComposing && document.body.classList.contains("is-focused")) {
    setFocus(false);
  }
});
focusButton.hidden = false;

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
themeButton.hidden = false;

document.addEventListener("pointerdown", (event) => {
  if (session.open && !session.contains(event.target)) session.open = false;
});

if (!editor.value && window.matchMedia("(pointer: fine) and (hover: hover)").matches) {
  editor.focus({ preventScroll: true });
}
