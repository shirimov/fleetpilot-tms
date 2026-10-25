import path from "node:path";
import { mkdir, realpath } from "node:fs/promises";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import { DriverValidationError } from "./validation";
export const MAX_DRIVER_FILE = 10 * 1024 * 1024;
export async function driverStorage() {
  const root = path.resolve(
    process.env.PRIVATE_FILE_STORAGE_ROOT || path.join(process.cwd(), ".data"),
  );
  const publicRoot = await realpath(path.join(process.cwd(), "public"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const resolved = await realpath(root);
  if (resolved === publicRoot || resolved.startsWith(publicRoot + path.sep))
    throw new Error("Driver storage must be private.");
  const namespace = path.join(resolved, "driver-documents");
  await mkdir(namespace, { recursive: true, mode: 0o700 });
  if ((await realpath(namespace)) !== namespace)
    throw new Error("Driver storage cannot use a symbolic link.");
  return new FilesystemPrivateFileStorage("driver-documents", resolved);
}
export async function boundedDocumentForm(request: Request) {
  const limit = MAX_DRIVER_FILE + 65536;
  if (Number(request.headers.get("content-length")) > limit)
    throw new DriverValidationError("Upload exceeds the 10 MB limit.");
  if (!request.body) throw new DriverValidationError("A document is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new DriverValidationError("Upload exceeds the 10 MB limit.");
      }
      chunks.push(value);
    }
    const formRequest = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: Buffer.concat(chunks),
    });
    return await formRequest.formData();
  } catch (error) {
    if (error instanceof DriverValidationError) throw error;
    throw new DriverValidationError("Invalid multipart document upload.");
  }
}
export function validateDriverFile(file: File, bytes: Uint8Array) {
  if (!file.size || file.size > MAX_DRIVER_FILE || bytes.length !== file.size)
    throw new DriverValidationError("Select a nonempty document up to 10 MB.");
  const normalizedName = file.name.normalize("NFKC");
  if (/[\\/\u0000-\u001f]/.test(normalizedName) || normalizedName.length > 180)
    throw new DriverValidationError("Invalid document filename.");
  const extension = path.extname(normalizedName).toLowerCase();
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  const prefix = (...values: number[]) =>
    values.every((value, index) => bytes[index] === value);
  const valid =
    extension === ".pdf"
      ? Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-"
      : extension === ".png"
        ? prefix(137, 80, 78, 71, 13, 10, 26, 10)
        : [".jpg", ".jpeg"].includes(extension)
          ? prefix(255, 216, 255)
          : extension === ".webp"
            ? Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
              Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP"
            : false;
  if (
    types[extension] !== file.type ||
    !valid ||
    /\.(?:html?|svg|js|mjs|exe|sh|php)(?:\.|$)/i.test(normalizedName)
  )
    throw new DriverValidationError(
      "Only PDF, PNG, JPEG or WebP files with matching content and MIME type are accepted.",
    );
  return {
    filename: normalizedName.replace(/[^a-zA-Z0-9 _().-]/g, "_"),
    mimeType: file.type,
    byteSize: file.size,
  };
}
