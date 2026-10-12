export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_BYTES = 18 * 1024 * 1024; // Below the 20 MB multipart server-action ceiling.
export const SUPPORTED_EXTENSIONS = /\.(pdf|png|jpe?g)$/i;
export function sourceMime(filename, buffer) {
  const ext = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (ext === 'pdf' && buffer.subarray(0,1024).includes(Buffer.from('%PDF-'))) return 'application/pdf';
  if (ext === 'png' && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (['jpg','jpeg'].includes(ext) && buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  throw new Error('File content does not match a supported PDF, JPEG or PNG. Choose the original file or a valid screenshot.');
}
export function validateUploads(files) {
  if (!files.length) throw new Error('Choose a PDF, JPEG or PNG first.');
  if (files.length > 5 || files.some((f) => f.size > MAX_FILE_BYTES || !SUPPORTED_EXTENSIONS.test(f.name))) throw new Error('Choose up to five PDF, JPEG or PNG files, each no larger than 10 MB.');
  if (files.reduce((n,f) => n + f.size,0) > MAX_BATCH_BYTES) throw new Error('This batch exceeds 18 MB. Upload fewer files at a time.');
}
