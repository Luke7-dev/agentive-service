import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfExtractionService } from './pdf-extraction.service.js';

const SERVICES_PDF = resolve(import.meta.dirname, '../../car-rental-services.pdf');
const POLICIES_PDF = resolve(import.meta.dirname, '../../car-rental-policies.pdf');

describe('PdfExtractionService', () => {
  const service = new PdfExtractionService();

  it('extracts non-empty text from car-rental-services.pdf', async () => {
    const text = await service.extractText(SERVICES_PDF);

    expect(text.length).toBeGreaterThan(0);
    console.log('\n--- car-rental-services.pdf (first 300 chars) ---');
    console.log(text.slice(0, 300));
  });

  it('extracts non-empty text from car-rental-policies.pdf', async () => {
    const text = await service.extractText(POLICIES_PDF);

    expect(text.length).toBeGreaterThan(0);
    console.log('\n--- car-rental-policies.pdf (first 300 chars) ---');
    console.log(text.slice(0, 300));
  });

  it('throws a clear error for a missing file', async () => {
    await expect(service.extractText(resolve(import.meta.dirname, '../../does-not-exist.pdf'))).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws a clear error for a non-pdf file', async () => {
    await expect(service.extractText(resolve(import.meta.dirname, '../../package.json'))).rejects.toThrow(
      /expected a \.pdf file/i,
    );
  });
});
