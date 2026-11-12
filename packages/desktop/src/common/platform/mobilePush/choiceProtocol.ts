/** Shared, bounded incremental parser for explicit prose-question markers. */
export const USER_CHOICE_MARKER = '[[AIONUI_USER_CHOICE_REQUIRED]]';
const MAX_LINE_LENGTH = 8192;
const MAX_PREVIEW_LENGTH = 320;

export type ChoiceSignal = { index: number; preview: string };

/** Only standalone, unquoted markers outside Markdown code count as requests. */
export class ChoiceSignalParser {
  private line = '';
  private overflow = false;
  private fence: { character: string; length: number } | null = null;
  private signals: ChoiceSignal[] = [];
  private committedPreview = '';
  private capturing = false;
  private lineNumber = 1;
  private finished = false;

  constructor(private readonly onMarker?: (index: number, line: number) => void) {}

  feed(text: string): ChoiceSignal[] {
    if (this.finished) return this.snapshot();
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.overflow) {
        this.line += part;
        if (this.line.length > MAX_LINE_LENGTH) {
          this.line = '';
          this.overflow = true;
        }
      }
      if (part.endsWith('\n')) {
        if (!this.overflow) this.commitLine(this.line.replace(/\r?\n$/, ''));
        this.lineNumber += 1;
        this.line = '';
        this.overflow = false;
      }
    }
    return this.snapshot();
  }

  /** Flush an unterminated final line only after the message is complete. */
  finish(): ChoiceSignal[] {
    if (!this.finished) {
      if (!this.overflow && this.line) this.commitLine(this.line.replace(/\r$/, ''));
      this.line = '';
      this.finished = true;
    }
    return this.snapshot();
  }

  private commitLine(line: string): void {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (this.fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (closing && closing[1][0] === this.fence.character && closing[1].length >= this.fence.length) {
        this.fence = null;
      }
      return;
    }
    if (opening) {
      this.fence = { character: opening[1][0], length: opening[1].length };
      return;
    }
    if (/^ {0,3}\[\[AIONUI_USER_CHOICE_REQUIRED\]\]\s*$/.test(line)) {
      this.signals.push({ index: this.signals.length, preview: '' });
      this.onMarker?.(this.signals.length - 1, this.lineNumber);
      this.committedPreview = '';
      this.capturing = true;
      return;
    }
    if (!this.capturing) return;
    if (!line.trim() && this.committedPreview) {
      this.capturing = false;
      return;
    }
    this.committedPreview = this.previewWith(line);
    this.signals[this.signals.length - 1].preview = this.committedPreview;
  }

  private previewWith(line: string): string {
    return [this.committedPreview, line.trim()].filter(Boolean).join(' ').slice(0, MAX_PREVIEW_LENGTH);
  }

  private snapshot(): ChoiceSignal[] {
    const lastIndex = this.signals.length - 1;
    const provisionalLine = USER_CHOICE_MARKER.startsWith(this.line.trim()) ? '' : this.line;
    return this.signals.map((signal, index) => ({
      ...signal,
      preview:
        index === lastIndex && this.capturing && !this.fence && !this.overflow
          ? this.previewWith(provisionalLine)
          : signal.preview,
    }));
  }
}
