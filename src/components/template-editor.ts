/**
 * Template Editor Component (F10.2, F10.3)
 *
 * A reusable visual filename template editor with:
 * - Text input for the template string
 * - Clickable variable tag buttons that insert at cursor position
 * - Hover tooltips on variable tags
 * - Variable token highlighting via overlay technique
 * - Live preview (debounced 200ms) using expandTemplate()
 * - Warnings for truncated filenames (E10.3a)
 * - Graceful handling of invalid variable syntax (E10.2a)
 */

import { expandTemplate, TEMPLATE_VARIABLES, PREVIEW_SAMPLE_VARS, PHASE2_VARIABLE_KEYS } from '../filename-template';
import { t } from '../i18n';

/** Options for creating a template editor instance. */
export interface TemplateEditorOptions {
  /** The DOM element to render the editor into. */
  container: HTMLElement;
  /** Initial template string value. */
  initialTemplate: string;
  /** Output directory for preview path display. */
  outputDir?: string;
  /** File extension (without dot) for preview. */
  extension?: string;
  /**
   * Variable values to use for preview. Defaults to PREVIEW_SAMPLE_VARS.
   * Pass actual video metadata for Download page context.
   */
  previewVars?: Record<string, string>;
  /**
   * Variable keys that are "deferred" (not yet available).
   * These will be shown in italic/gray with a "待取得" badge in preview.
   * Used for Scheduled Downloads context.
   */
  deferredVars?: string[];
  /** Called whenever the template value changes. */
  onChange?: (template: string) => void;
}

/** Return value from createTemplateEditor. */
export interface TemplateEditorInstance {
  /** Get the current template string value. */
  getValue: () => string;
  /** Clean up event listeners and timers. */
  destroy: () => void;
}

/** Maximum filename length before showing truncation warning. */
const MAX_FILENAME_LENGTH = 200;

/**
 * Build a text node from a plain string (safe DOM creation).
 */
function textNode(s: string): Text {
  return document.createTextNode(s);
}

/**
 * Create an element with a class name.
 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/**
 * Create a visual template editor in the given container.
 *
 * Returns an instance with getValue() and destroy() methods.
 */
export function createTemplateEditor(options: TemplateEditorOptions): TemplateEditorInstance {
  const {
    container,
    initialTemplate,
    outputDir = '',
    extension = 'mp4',
    previewVars = PREVIEW_SAMPLE_VARS,
    deferredVars = [],
    onChange,
  } = options;

  // ── Build DOM ─────────────────────────────────────────────────────────────

  const editorEl = el('div', 'template-editor');

  // Input wrapper (for overlay highlighting)
  const inputWrapper = el('div', 'template-editor-input-wrapper');

  // Overlay div for variable highlighting (positioned behind / synced with input)
  const highlightOverlay = el('div', 'template-editor-highlight-overlay');
  highlightOverlay.setAttribute('aria-hidden', 'true');

  // The actual text input
  const inputEl = el('input', 'template-editor-input');
  inputEl.type = 'text';
  inputEl.value = initialTemplate;
  inputEl.spellcheck = false;
  inputEl.setAttribute('autocomplete', 'off');
  inputEl.setAttribute('autocorrect', 'off');
  inputEl.setAttribute('autocapitalize', 'off');

  inputWrapper.appendChild(highlightOverlay);
  inputWrapper.appendChild(inputEl);
  editorEl.appendChild(inputWrapper);

  // Variable tags row
  const tagsRow = el('div', 'template-variable-tags');
  const tagsLabel = el('span', 'template-variable-tags-label');
  tagsLabel.textContent = t('templateEditor.variablesLabel');
  tagsRow.appendChild(tagsLabel);

  TEMPLATE_VARIABLES.forEach(variable => {
    const tag = el('button', 'template-variable-tag');
    tag.type = 'button';
    tag.dataset.key = variable.key;

    const tagText = el('span', 'template-variable-tag-text');
    tagText.textContent = `{${variable.key}}`;
    tag.appendChild(tagText);

    // Tooltip element built entirely with DOM methods (no innerHTML)
    const tooltip = el('div', 'template-variable-tag-tooltip');

    const tooltipTitle = el('strong');
    tooltipTitle.textContent = `{${variable.key}}`;
    tooltip.appendChild(tooltipTitle);

    tooltip.appendChild(el('br'));

    const descKey = `templateEditor.variables.${variable.key}.description`;
    const descText = textNode(t(descKey));
    tooltip.appendChild(descText);

    tooltip.appendChild(el('br'));

    const exampleSpan = el('span', 'tooltip-example');
    const exKey = `templateEditor.variables.${variable.key}.example`;
    exampleSpan.textContent = `${t('templateEditor.exampleLabel')}: ${t(exKey)}`;
    tooltip.appendChild(exampleSpan);

    tag.appendChild(tooltip);

    // Click: insert variable at cursor position
    tag.addEventListener('click', () => {
      insertAtCursor(inputEl, `{${variable.key}}`);
      updateHighlight();
      schedulePreviewUpdate();
      if (onChange) {
        onChange(inputEl.value);
      }
    });

    tagsRow.appendChild(tag);
  });

  editorEl.appendChild(tagsRow);

  // Preview section
  const previewSection = el('div', 'template-preview');

  const previewLabel = el('div', 'template-preview-label');
  previewLabel.textContent = t('templateEditor.preview.label');
  previewSection.appendChild(previewLabel);

  const previewFilename = el('div', 'template-preview-filename');
  previewSection.appendChild(previewFilename);

  const previewPath = el('div', 'template-preview-path');
  previewSection.appendChild(previewPath);

  const previewWarning = el('div', 'template-preview-warning');
  previewWarning.style.display = 'none';
  previewSection.appendChild(previewWarning);

  editorEl.appendChild(previewSection);

  container.appendChild(editorEl);

  // ── State ─────────────────────────────────────────────────────────────────

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  // ── Helper functions ──────────────────────────────────────────────────────

  /** Insert text at the current cursor position in an input element. */
  function insertAtCursor(input: HTMLInputElement, text: string): void {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = before + text + after;
    const newPos = start + text.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();
  }

  /**
   * Update the highlight overlay to visually distinguish {variable} tokens.
   *
   * Clears and rebuilds the overlay using DOM methods.
   * Each {variable} token becomes a <mark> element; plain text becomes text nodes.
   */
  function updateHighlight(): void {
    const text = inputEl.value;

    // Clear overlay
    while (highlightOverlay.firstChild) {
      highlightOverlay.removeChild(highlightOverlay.firstChild);
    }

    // Tokenize on {variable} boundaries
    const parts = text.split(/(\{[^}]*\})/g);
    for (const part of parts) {
      const match = part.match(/^\{([^}]*)\}$/);
      if (match) {
        const key = match[1];
        const mark = el('mark');
        mark.textContent = part;
        const isValid = TEMPLATE_VARIABLES.some(v => v.key === key);
        const isDeferred = deferredVars.includes(key);
        if (isDeferred) {
          mark.className = 'template-var-token template-var-deferred';
        } else if (isValid) {
          mark.className = 'template-var-token';
        } else {
          mark.className = 'template-var-token template-var-invalid';
        }
        highlightOverlay.appendChild(mark);
      } else if (part.length > 0) {
        highlightOverlay.appendChild(textNode(part));
      }
    }
  }

  /** Schedule a preview update with 200ms debounce (SC-10). */
  function schedulePreviewUpdate(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (!destroyed) {
        updatePreview();
      }
    }, 200);
  }

  /** Build preview vars: merge previewVars but omit deferred vars. */
  function buildPreviewVarsForExpansion(): Record<string, string> {
    const vars: Record<string, string> = { ...previewVars };
    for (const key of deferredVars) {
      delete vars[key];
    }
    return vars;
  }

  /**
   * Update the live preview area.
   *
   * Calls expandTemplate() and renders the result.
   * Shows truncation warning if filename > MAX_FILENAME_LENGTH chars.
   */
  async function updatePreview(): Promise<void> {
    if (destroyed) return;

    const template = inputEl.value;
    if (!template.trim()) {
      clearPreview();
      return;
    }

    try {
      const vars = buildPreviewVarsForExpansion();
      const expanded = await expandTemplate(template, vars);

      if (destroyed) return;

      // Render the preview filename
      while (previewFilename.firstChild) {
        previewFilename.removeChild(previewFilename.firstChild);
      }

      if (deferredVars.length > 0) {
        renderPreviewWithDeferredVars(previewFilename, expanded);
      } else {
        previewFilename.appendChild(textNode(`${expanded}.${extension}`));
      }

      // Show full path
      if (outputDir) {
        previewPath.textContent = `${outputDir}/${expanded}.${extension}`;
      } else {
        previewPath.textContent = '';
      }

      // Truncation warning (E10.3a)
      if (expanded.length > MAX_FILENAME_LENGTH) {
        previewWarning.textContent = t('templateEditor.preview.truncationWarning');
        previewWarning.style.display = 'block';
      } else {
        previewWarning.style.display = 'none';
      }
    } catch (_err) {
      // E10.2a: invalid syntax — show template as literal text, don't block editing
      if (!destroyed) {
        while (previewFilename.firstChild) {
          previewFilename.removeChild(previewFilename.firstChild);
        }
        previewFilename.appendChild(textNode(template));
        previewPath.textContent = '';
        previewWarning.style.display = 'none';
      }
    }
  }

  /** Clear all preview content. */
  function clearPreview(): void {
    while (previewFilename.firstChild) {
      previewFilename.removeChild(previewFilename.firstChild);
    }
    previewPath.textContent = '';
    previewWarning.style.display = 'none';
  }

  /**
   * Render the expanded preview filename for Scheduled Downloads context.
   * Deferred variable placeholders are shown in italic/gray with a "待取得" badge.
   */
  function renderPreviewWithDeferredVars(container: HTMLElement, expanded: string): void {
    // Split expanded text on {variable} patterns (deferred vars remain as placeholders)
    const parts = expanded.split(/(\{[^}]+\})/g);
    for (const part of parts) {
      const match = part.match(/^\{([^}]+)\}$/);
      if (match && deferredVars.includes(match[1])) {
        const span = el('span', 'template-deferred-var');
        span.appendChild(textNode(`{${match[1]}}`));

        const badge = el('span', 'template-deferred-badge');
        badge.textContent = t('templateEditor.preview.deferredLabel');
        span.appendChild(badge);

        container.appendChild(span);
      } else {
        container.appendChild(textNode(part));
      }
    }
    // Append extension
    container.appendChild(textNode(`.${extension}`));
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  function onInput(): void {
    updateHighlight();
    schedulePreviewUpdate();
    if (onChange) {
      onChange(inputEl.value);
    }
  }

  function onScroll(): void {
    highlightOverlay.scrollLeft = inputEl.scrollLeft;
  }

  function onKeydown(): void {
    setTimeout(() => {
      if (!destroyed) {
        highlightOverlay.scrollLeft = inputEl.scrollLeft;
      }
    }, 0);
  }

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('scroll', onScroll);
  inputEl.addEventListener('keydown', onKeydown);

  // ── Initial render ────────────────────────────────────────────────────────

  updateHighlight();
  updatePreview();

  // ── Return instance ───────────────────────────────────────────────────────

  return {
    getValue(): string {
      return inputEl.value;
    },
    destroy(): void {
      destroyed = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('scroll', onScroll);
      inputEl.removeEventListener('keydown', onKeydown);
      if (editorEl.parentElement === container) {
        container.removeChild(editorEl);
      }
    },
  };
}

/**
 * Convenience export: deferred variable keys for the scheduled download context.
 * Phase 2 variables are not available at trigger time.
 */
export const SCHEDULED_DEFERRED_VARS: readonly string[] = [...PHASE2_VARIABLE_KEYS];
