import type { FastifyReply } from 'fastify';

/**
 * The minimum a PDF response needs: the bytes to serve and the digest that
 * identifies them. `RenderedDocument` satisfies this; a document sealed at
 * issue time and replayed from storage does too.
 */
export interface PdfResponsePayload {
  /** The document as it will be served. Hash and serve the same buffer. */
  bytes: Buffer;
  /** SHA-256 (hex) over `bytes`, as recorded when the document was rendered. */
  sha256: string;
  byteLength?: number;
  mediaType?: 'application/pdf';
}

/**
 * Single place where a rendered PDF becomes an HTTP response.
 *
 * Every official document is served as `doc.bytes` — the same buffer that was
 * hashed — and always advertises `x-document-sha256` so the client (and any
 * filing/audit step) can prove the filed copy is byte-identical to the one the
 * server rendered. Routing all PDF responses through here is what stops a new
 * document endpoint from quietly shipping an unhashed, unverifiable copy.
 */
export function sendPdf(reply: FastifyReply, doc: PdfResponsePayload, filename: string): FastifyReply {
  const chained = reply
    .status(200)
    .header('content-type', doc.mediaType ?? 'application/pdf')
    .header('content-disposition', `inline; filename="${filename}"`)
    .header('x-document-sha256', doc.sha256);
  return doc.byteLength === undefined
    ? chained.send(doc.bytes)
    : chained.header('content-length', doc.byteLength).send(doc.bytes);
}
