import type remarkBreaks from 'remark-breaks';
import { ChoiceSignalParser, USER_CHOICE_MARKER } from './protocol';
import styles from './proseQuestions.module.css';

type MarkdownRoot = Parameters<ReturnType<typeof remarkBreaks>>[0];
type RootContent = MarkdownRoot['children'][number];
type Blockquote = Extract<RootContent, { type: 'blockquote' }>;
type PhrasingContent = Extract<RootContent, { type: 'paragraph' }>['children'][number];

/** Decorate explicit prose questions without reparsing or splitting Markdown documents. */
export const remarkChoiceQuestions =
  ({ label, highlightedQuestionIndex }: { label: string; highlightedQuestionIndex?: number }) =>
  (tree: MarkdownRoot, file: { toString(): string }) => {
    const markers = new Map<number, number>();
    new ChoiceSignalParser((index, line) => markers.set(line, index)).feed(String(file));
    if (!markers.size) return;

    const output: RootContent[] = [];
    let question: Blockquote | undefined;
    const append = (node: RootContent) => {
      // Before other transforms, the remark parser emits blocks/definitions at the document root.
      if (question) question.children.push(node as Blockquote['children'][number]);
      else output.push(node);
    };

    for (const node of tree.children) {
      // Code, quoted examples and list contents are not standalone prose paragraphs.
      if (node.type !== 'paragraph') {
        append(node);
        continue;
      }

      let children: PhrasingContent[] = [];
      const flush = () => {
        if (children.length) append({ ...node, children });
        children = [];
      };
      for (const child of node.children) {
        if (child.type !== 'text' || !child.position) {
          children.push(child);
          continue;
        }
        let line = child.position.start.line;
        let text = '';
        for (const part of child.value.split(/(?<=\n)/)) {
          const index = markers.get(line);
          if (index !== undefined && part.trim() === USER_CHOICE_MARKER) {
            if (text) children.push({ ...child, value: text });
            text = '';
            flush();
            question = {
              type: 'blockquote',
              data: {
                hName: 'section',
                hProperties: {
                  className: styles.question,
                  role: 'group',
                  'aria-label': label,
                  'data-choice-marker-index': index,
                  ...(index === highlightedQuestionIndex ? { 'data-notification-highlight': 'true' } : {}),
                },
              },
              children: [
                {
                  type: 'paragraph',
                  data: { hProperties: { className: styles.label } },
                  children: [{ type: 'text', value: label }],
                },
              ],
            };
            output.push(question);
          } else {
            text += part;
          }
          if (part.endsWith('\n')) line += 1;
        }
        if (text) children.push({ ...child, value: text });
      }
      flush();
    }
    tree.children = output;
  };
