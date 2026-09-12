import { resolve } from 'node:path';
import { PdfExtractionService } from '../src/pdf-extraction/pdf-extraction.service.js';

const PDFS = ['car-rental-services.pdf', 'car-rental-policies.pdf'];

async function main() {
  const service = new PdfExtractionService();

  for (const fileName of PDFS) {
    const filePath = resolve(import.meta.dirname, '..', fileName);
    console.log(`\n=== ${fileName} ===`);
    const text = await service.extractText(filePath);
    console.log(`Extracted ${text.length} characters.`);
    console.log('--- Sample (first 500 chars) ---');
    console.log(text.slice(0, 500));
  }
}

main().catch((error) => {
  console.error('PDF extraction demo failed:', error);
  process.exitCode = 1;
});
