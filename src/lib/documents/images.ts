import { PDFDocument } from "pdf-lib";

/** The customer said this photo was the last page of the document in hand. */
export function photoDone(text: string): boolean {
  return /^(אין עוד|אין עוד תמונות|זה הכל|זהו|סיימתי|no more|that'?s all|last one|לא|no)[.!?\s]*$/i.test(text.trim());
}

/** Embed photos in order into one PDF. PNG and JPEG only. */
export async function imagesToPdf(pages: { mime: string; bytes: Buffer }[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const page of pages) {
    const mime = page.mime.toLowerCase();
    const image = mime.includes("png") ? await pdf.embedPng(page.bytes) : await pdf.embedJpg(page.bytes);
    const sheet = pdf.addPage([image.width, image.height]);
    sheet.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return Buffer.from(await pdf.save());
}
