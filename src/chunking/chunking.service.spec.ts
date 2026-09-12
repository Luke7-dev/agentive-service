import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PdfExtractionService } from '../pdf-extraction/pdf-extraction.service.js';
import { ChunkingService } from './chunking.service.js';

const SERVICES_PDF = resolve(import.meta.dirname, '../../car-rental-services.pdf');
const POLICIES_PDF = resolve(import.meta.dirname, '../../car-rental-policies.pdf');

function findChunkContaining(chunks: { text: string }[], phrase: string) {
  const chunk = chunks.find((c) => c.text.includes(phrase));
  if (!chunk) {
    throw new Error(`No chunk contains "${phrase}"`);
  }
  return chunk;
}

describe('ChunkingService', () => {
  const service = new ChunkingService(new PdfExtractionService());

  describe('car-rental-services.pdf', () => {
    it('produces non-empty chunks identified by their source', async () => {
      const chunks = await service.chunkPdf(SERVICES_PDF);

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
        expect(chunk.metadata.source).toBe('car-rental-services.pdf');
      }
    });

    it('keeps each numbered section together as one chunk', async () => {
      const chunks = await service.chunkPdf(SERVICES_PDF);
      expect(chunks).toHaveLength(3);

      const longTerm = findChunkContaining(chunks, 'Weekly Rental Packages');
      expect(longTerm.text).toContain('Monthly Rental');
      expect(longTerm.text).toContain('Corporate Long-Term Lease');
      expect(longTerm.metadata.section).toBe('Long-Term Rentals');

      const mobility = findChunkContaining(chunks, 'Airport Pickup & Drop-off');
      expect(mobility.text).toContain('Chauffeur / Private Driver Service');
      expect(mobility.text).toContain('One-Way Rental');
      expect(mobility.text).toContain('Add-On Options');
    });

    it('preserves the original extracted text verbatim inside chunks', async () => {
      const extractedText = await new PdfExtractionService().extractText(SERVICES_PDF);
      const chunks = await service.chunkPdf(SERVICES_PDF);

      for (const chunk of chunks) {
        for (const line of chunk.text.split('\n')) {
          expect(extractedText).toContain(line);
        }
      }
    });
  });

  describe('car-rental-policies.pdf', () => {
    it('produces non-empty chunks identified by their source', async () => {
      const chunks = await service.chunkPdf(POLICIES_PDF);

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.text.trim().length).toBeGreaterThan(0);
        expect(chunk.metadata.source).toBe('car-rental-policies.pdf');
      }
    });

    it('keeps "Driver Eligibility & Required Documents" together in one chunk', async () => {
      const chunks = await service.chunkPdf(POLICIES_PDF);

      const eligibility = findChunkContaining(chunks, 'Minimum Age');
      expect(eligibility.metadata.section).toBe('Driver Eligibility & Required Documents');
      expect(eligibility.text).toContain('Driving Experience');
      expect(eligibility.text).toContain('Required Documents for Local Citizens');
      expect(eligibility.text).toContain('Required Documents for International Travelers');
    });

    it('keeps "Payment & Security Deposit" together in one chunk', async () => {
      const chunks = await service.chunkPdf(POLICIES_PDF);

      const payment = findChunkContaining(chunks, 'Accepted Payment Methods');
      expect(payment.metadata.section).toBe('Payment & Security Deposit');
      expect(payment.text).toContain('Security Deposit');
      expect(payment.text).toContain('Deposit Refund');
    });

    it('keeps a section together even when its content spans two PDF pages', async () => {
      const chunks = await service.chunkPdf(POLICIES_PDF);

      const vehicleUse = findChunkContaining(chunks, 'Fuel Policy');
      expect(vehicleUse.metadata.section).toBe('Vehicle Use Rules & Conditions');
      // "Mileage Limits" onward is on PDF page 2, "Fuel Policy" is on page 1 —
      // both must stay in the same chunk instead of being split at the page break.
      expect(vehicleUse.text).toContain('Mileage Limits');
      expect(vehicleUse.text).toContain('Prohibited Uses');
      expect(vehicleUse.text).toContain('Late Return Policy');
      expect(vehicleUse.metadata.page).toBe(1);
    });

    it('does not unnecessarily split logical sections', async () => {
      const chunks = await service.chunkPdf(POLICIES_PDF);
      // One chunk per numbered section (1-5); none of them exceed the default size guard.
      expect(chunks).toHaveLength(5);
      expect(chunks.map((c) => c.metadata.section)).toEqual([
        'Driver Eligibility & Required Documents',
        'Payment & Security Deposit',
        'Insurance & Damage Policy',
        'Cancellation & Modification Policy',
        'Vehicle Use Rules & Conditions',
      ]);
    });

    it('tags every chunk with the document title', async () => {
      const chunks = await service.chunkPdf(POLICIES_PDF);
      for (const chunk of chunks) {
        expect(chunk.metadata.documentTitle).toBe('Terms & Rental Policies');
      }
    });

    it('preserves the original extracted text verbatim inside chunks', async () => {
      const extractedText = await new PdfExtractionService().extractText(POLICIES_PDF);
      const chunks = await service.chunkPdf(POLICIES_PDF);

      for (const chunk of chunks) {
        for (const line of chunk.text.split('\n')) {
          expect(extractedText).toContain(line);
        }
      }
    });
  });

  it('is deterministic: chunking the same PDF twice yields identical output', async () => {
    const [first, second] = await Promise.all([service.chunkPdf(POLICIES_PDF), service.chunkPdf(POLICIES_PDF)]);
    expect(first).toEqual(second);

    const chunkText = await new PdfExtractionService().extractText(POLICIES_PDF);
    const [fromTextFirst, fromTextSecond] = [
      service.chunkText(chunkText, 'car-rental-policies.pdf'),
      service.chunkText(chunkText, 'car-rental-policies.pdf'),
    ];
    expect(fromTextFirst).toEqual(fromTextSecond);
  });

  it('assigns deterministic, unique, human-readable ids', async () => {
    const chunks = await service.chunkPdf(SERVICES_PDF);
    const ids = chunks.map((c) => c.id);

    expect(ids).toEqual(['car-rental-services-section-1', 'car-rental-services-section-2', 'car-rental-services-section-3']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('splits an oversized section along bullet boundaries and repeats the heading for context', () => {
    const rawText = [
      'Document 9: Synthetic Long Section Test',
      '1. A Section With Many Bullets',
      '● First bullet with a reasonably long description that adds to the total length.',
      '● Second bullet with a reasonably long description that adds to the total length.',
      '● Third bullet with a reasonably long description that adds to the total length.',
      '● Fourth bullet with a reasonably long description that adds to the total length.',
      '● Fifth bullet with a reasonably long description that adds to the total length.',
      '● Sixth bullet with a reasonably long description that adds to the total length.',
    ].join('\n');

    const chunks = service.chunkText(rawText, 'synthetic.pdf', { maxChunkChars: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Every part repeats the heading, and no bullet is cut mid-sentence.
      expect(chunk.text.startsWith('1. A Section With Many Bullets')).toBe(true);
      expect(chunk.text).not.toMatch(/\bbullet with a reasonably long$/m);
      expect(chunk.metadata.section).toBe('A Section With Many Bullets');
    }

    const allBulletText = chunks.map((c) => c.text).join('\n');
    for (const label of ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']) {
      expect(allBulletText).toContain(`${label} bullet`);
    }
  });
});
