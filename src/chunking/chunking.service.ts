import { Injectable } from '@nestjs/common';
import { basename } from 'node:path';
import { PdfExtractionService } from '../pdf-extraction/pdf-extraction.service.js';
import type { ChunkingOptions, KnowledgeChunk } from './knowledge-chunk.interface.js';

interface TaggedLine {
  text: string;
  page: number;
}

interface ParsedSection {
  /** e.g. "section-1", or "section-intro" for content preceding the first heading. */
  id: string;
  title?: string;
  /** The heading line itself (kept as the first line of `lines`), or null when there is none. */
  headingLine: string | null;
  lines: TaggedLine[];
}

const DEFAULT_MAX_CHUNK_CHARS = 1200;

// Matches the "-- <page> of <total> --" separators pdf-parse inserts between pages.
const PAGE_MARKER_RE = /^--\s*(\d+)\s+of\s+\d+\s*--$/;
// Matches the single title line at the top of these knowledge-base documents, e.g.
// "Document 2: Terms & Rental Policies".
const TITLE_LINE_RE = /^Document\s+\d+\s*:\s*(.+)$/i;
// Matches a numbered section heading, e.g. "1. Driver Eligibility & Required Documents".
const HEADING_RE = /^(\d{1,2})\.\s+([A-Z0-9].*)$/;
// Matches a top-level bullet, e.g. "● Minimum Age: ...". Sub-bullets ("•") and wrapped
// continuation lines are treated as part of the preceding top-level bullet's block.
const TOP_BULLET_RE = /^●\s*/;

/**
 * Splits extracted PDF text into semantically coherent chunks for later
 * embedding, preferring the document's own structure (headings, bullets,
 * paragraphs) over fixed character counts.
 */
@Injectable()
export class ChunkingService {
  constructor(private readonly pdfExtractionService: PdfExtractionService) {}

  /** Extracts text from a PDF (via PdfExtractionService) and chunks it. */
  async chunkPdf(filePath: string, options?: ChunkingOptions): Promise<KnowledgeChunk[]> {
    const text = await this.pdfExtractionService.extractText(filePath);
    return this.chunkText(text, basename(filePath), options);
  }

  /** Pure chunking of already-extracted text. Deterministic for identical input. */
  chunkText(rawText: string, source: string, options: ChunkingOptions = {}): KnowledgeChunk[] {
    const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
    const taggedLines = this.tagLinesWithPages(rawText);
    const { documentTitle, sections } = this.splitIntoSections(taggedLines);
    const sourceSlug = this.slugify(source);

    const chunks: KnowledgeChunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const sectionText = section.lines
        .map((line) => line.text)
        .join('\n')
        .trim();
      if (sectionText.length === 0) {
        continue;
      }

      if (sectionText.length <= maxChunkChars) {
        chunks.push({
          id: `${sourceSlug}-${section.id}`,
          text: sectionText,
          metadata: {
            source,
            section: section.title,
            documentTitle,
            page: section.lines[0].page,
            chunkIndex: chunkIndex++,
          },
        });
        continue;
      }

      // Section is too large: split along bullet/block boundaries only, repeating the
      // heading on each part as a small, non-duplicative overlap for context.
      const blocks = this.splitIntoBlocks(section);
      const parts = this.packBlocks(blocks, maxChunkChars, section.headingLine);
      parts.forEach((part, partIndex) => {
        chunks.push({
          id: `${sourceSlug}-${section.id}-part-${partIndex + 1}`,
          text: part.text,
          metadata: {
            source,
            section: section.title,
            documentTitle,
            page: part.page,
            chunkIndex: chunkIndex++,
          },
        });
      });
    }

    return chunks;
  }

  /** Splits raw extracted text into non-empty, trimmed lines tagged with their page number. */
  private tagLinesWithPages(rawText: string): TaggedLine[] {
    const tagged: TaggedLine[] = [];
    let currentPage = 1;

    for (const rawLine of rawText.split('\n')) {
      const line = rawLine.trim();
      if (line.length === 0) {
        continue;
      }

      const marker = line.match(PAGE_MARKER_RE);
      if (marker) {
        currentPage = Number(marker[1]) + 1;
        continue;
      }

      tagged.push({ text: line, page: currentPage });
    }

    return tagged;
  }

  /**
   * Groups tagged lines into an optional document title plus an ordered list of
   * sections, using numbered headings as section boundaries. Content appearing
   * before the first heading (other than the title line) becomes an "intro"
   * section, so the chunker degrades gracefully on documents without headings.
   */
  private splitIntoSections(taggedLines: TaggedLine[]): {
    documentTitle?: string;
    sections: ParsedSection[];
  } {
    let documentTitle: string | undefined;
    let startIndex = 0;

    if (taggedLines.length > 0) {
      const titleMatch = taggedLines[0].text.match(TITLE_LINE_RE);
      if (titleMatch) {
        documentTitle = titleMatch[1].trim();
        startIndex = 1;
      }
    }

    const sections: ParsedSection[] = [];
    const introLines: TaggedLine[] = [];
    let current: ParsedSection | null = null;

    for (let i = startIndex; i < taggedLines.length; i++) {
      const line = taggedLines[i];
      const headingMatch = line.text.match(HEADING_RE);

      if (headingMatch) {
        if (current) {
          sections.push(current);
        }
        current = {
          id: `section-${headingMatch[1]}`,
          title: headingMatch[2].trim(),
          headingLine: line.text,
          lines: [line],
        };
        continue;
      }

      if (current) {
        current.lines.push(line);
      } else {
        introLines.push(line);
      }
    }

    if (current) {
      sections.push(current);
    }

    if (introLines.length > 0) {
      sections.unshift({ id: 'section-intro', title: undefined, headingLine: null, lines: introLines });
    }

    return { documentTitle, sections };
  }

  /**
   * Groups a section's content lines into blocks that must never be split: a
   * top-level bullet plus any sub-bullets/wrapped lines that follow it, until
   * the next top-level bullet.
   */
  private splitIntoBlocks(section: ParsedSection): TaggedLine[][] {
    const contentLines = section.headingLine ? section.lines.slice(1) : section.lines;
    const blocks: TaggedLine[][] = [];
    let currentBlock: TaggedLine[] = [];

    for (const line of contentLines) {
      if (currentBlock.length === 0 || TOP_BULLET_RE.test(line.text)) {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
        }
        currentBlock = [line];
      } else {
        currentBlock.push(line);
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    return blocks;
  }

  /**
   * Greedily packs blocks into parts no larger than `maxChunkChars`, splitting
   * only between blocks (never inside one). Each part repeats the section
   * heading so it stays understandable on its own.
   */
  private packBlocks(
    blocks: TaggedLine[][],
    maxChunkChars: number,
    headingLine: string | null,
  ): Array<{ text: string; page: number }> {
    const parts: Array<{ text: string; page: number }> = [];
    let currentLines: TaggedLine[] = [];
    let currentLength = headingLine?.length ?? 0;

    const flush = () => {
      if (currentLines.length === 0) {
        return;
      }
      const lines = headingLine ? [headingLine, ...currentLines.map((l) => l.text)] : currentLines.map((l) => l.text);
      parts.push({ text: lines.join('\n'), page: currentLines[0].page });
      currentLines = [];
      currentLength = headingLine?.length ?? 0;
    };

    for (const block of blocks) {
      const blockLength = block.reduce((sum, l) => sum + l.text.length + 1, 0);
      if (currentLines.length > 0 && currentLength + blockLength > maxChunkChars) {
        flush();
      }
      currentLines.push(...block);
      currentLength += blockLength;
    }
    flush();

    return parts;
  }

  private slugify(source: string): string {
    return source
      .replace(/\.pdf$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
