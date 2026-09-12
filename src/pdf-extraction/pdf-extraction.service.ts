import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

/**
 * Extracts plain text from PDF files.
 *
 * Kept deliberately narrow (extraction only) so it can be reused as a
 * building block for later chunking/embedding pipelines without carrying
 * unrelated responsibilities.
 */
@Injectable()
export class PdfExtractionService {
  private readonly logger = new Logger(PdfExtractionService.name);

  /**
   * Extracts all text content from a PDF file on disk.
   *
   * @param filePath absolute or relative path to a .pdf file
   * @returns the concatenated plain text of every page
   */
  async extractText(filePath: string): Promise<string> {
    if (!filePath.toLowerCase().endsWith('.pdf')) {
      throw new Error(`Expected a .pdf file, got "${filePath}"`);
    }

    const data = await this.readPdfFile(filePath);

    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return result.text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to parse PDF at "${filePath}": ${message}`);
      throw new Error(`Failed to extract text from PDF "${filePath}": ${message}`);
    } finally {
      await parser.destroy();
    }
  }

  private async readPdfFile(filePath: string): Promise<Buffer> {
    try {
      return await readFile(filePath);
    } catch {
      throw new Error(`PDF file not found or unreadable: "${filePath}"`);
    }
  }
}
