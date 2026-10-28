// customer-sign
//
// Public endpoint behind the remote customer signing page (/sign/:token). The
// customer has no login, so this function is the only door the public has to
// signature_requests, invoices and the signature file in storage. It runs with
// the service role and checks the signing token itself.
//
// Actions (POST, JSON body):
//   load   { action, token }                   -> invoice details for the page
//   submit { action, token, name, signature }  -> store the signature, mark used
//
// The Authorization header is ignored. The storage path is built here from the
// invoice id on the signature request, never taken from the caller.
//
// SECURITY: never log the token, the customer name, the request body or any
// PNG data. Only static messages and the invoice id are logged. Database and
// storage error text is never returned to the caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ALLOWED_ORIGIN = "https://dtf-field-ops.vercel.app";
const MAX_BODY_BYTES = 450 * 1024;
const MAX_SIGNATURE_BYTES = 300 * 1024;
const MAX_PNG_WIDTH = 2000;
const MAX_PNG_HEIGHT = 1000;
const MAX_NAME_LENGTH = 100;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;
const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR_TAG = [0x49, 0x48, 0x44, 0x52];

type ErrorCode =
  | "invalid"
  | "used"
  | "expired"
  | "bad_request"
  | "too_large"
  | "server";

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid: 404,
  used: 409,
  expired: 410,
  bad_request: 400,
  too_large: 413,
  server: 500,
};

type CorsHeaders = Record<string, string>;

// Service role (bypasses RLS). Any Authorization header on the request is
// ignored; this client is the only one used.
function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
type AdminClient = ReturnType<typeof createAdminClient>;

type SignatureRequestRow = {
  id: string;
  invoice_id: string;
  customer_name: string | null;
  used_at: string | null;
  expires_at: string;
};

type InvoiceRow = {
  invoice_number: string | null;
  service_date: string | null;
  surface_type: string | null;
  surface_color: string | null;
  line_items: unknown;
  discount: number | string | null;
  total: number | string | null;
  warranty_included: boolean | null;
  warranty_years: number | string | null;
  customer_signature_url: string | null;
};

type TokenCheck =
  | { ok: true; request: SignatureRequestRow; invoice: InvoiceRow }
  | { ok: false; code: ErrorCode };

// Exactly the production origin, plus any comma-separated origins in the
// optional ALLOWED_ORIGINS secret (for example a local dev server).
function allowedOrigins(): string[] {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return [DEFAULT_ALLOWED_ORIGIN, ...extra];
}

function buildCorsHeaders(req: Request): CorsHeaders {
  const headers: CorsHeaders = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: CorsHeaders,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}

function errorResponse(code: ErrorCode, cors: CorsHeaders): Response {
  return jsonResponse({ error: code }, ERROR_STATUS[code], cors);
}

// Reads the body as text, giving up as soon as it passes the size cap. Checks
// the declared Content-Length first, then counts the bytes actually read.
// Returns null when the body is too large.
async function readBodyLimited(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

// Shared checks for both actions. The token format is checked by the caller
// before this runs, so a malformed token never reaches the database.
async function checkToken(
  admin: AdminClient,
  token: string,
): Promise<TokenCheck> {
  const { data: requestData, error: requestError } = await admin
    .from("signature_requests")
    .select("id, invoice_id, customer_name, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (requestError) {
    console.error("signature request lookup failed");
    return { ok: false, code: "server" };
  }
  const request = requestData as SignatureRequestRow | null;
  if (!request) return { ok: false, code: "invalid" };
  if (request.used_at) return { ok: false, code: "used" };
  if (!(new Date(request.expires_at).getTime() > Date.now())) {
    return { ok: false, code: "expired" };
  }

  const { data: invoiceData, error: invoiceError } = await admin
    .from("invoices")
    .select(
      "invoice_number, service_date, surface_type, surface_color, line_items, discount, total, warranty_included, warranty_years, customer_signature_url",
    )
    .eq("id", request.invoice_id)
    .maybeSingle();

  if (invoiceError) {
    console.error(`invoice lookup failed for invoice ${request.invoice_id}`);
    return { ok: false, code: "server" };
  }
  const invoice = invoiceData as InvoiceRow | null;
  if (!invoice) return { ok: false, code: "invalid" };

  // Already signed (for example in person on the technician's phone): the
  // remote link must not overwrite that signature.
  if (invoice.customer_signature_url) return { ok: false, code: "used" };

  return { ok: true, request, invoice };
}

function scalarOrNull(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

// Each line item is reduced to description and amount; nothing else leaves.
function reduceLineItems(
  value: unknown,
): { description: string | number | null; amount: string | number | null }[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const entry = (item && typeof item === "object" ? item : {}) as Record<
      string,
      unknown
    >;
    return {
      description: scalarOrNull(entry.description),
      amount: scalarOrNull(entry.amount),
    };
  });
}

function handleLoad(
  check: Extract<TokenCheck, { ok: true }>,
  cors: CorsHeaders,
): Response {
  const { request, invoice } = check;
  return jsonResponse(
    {
      customer_name: request.customer_name,
      invoice: {
        invoice_number: invoice.invoice_number,
        service_date: invoice.service_date,
        surface_type: invoice.surface_type,
        surface_color: invoice.surface_color,
        line_items: reduceLineItems(invoice.line_items),
        discount: invoice.discount,
        total: invoice.total,
        warranty_included: invoice.warranty_included,
        warranty_years: invoice.warranty_years,
      },
    },
    200,
    cors,
  );
}

// Trim, strip control characters, and require 1-100 characters.
function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .trim()
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
  const length = Array.from(cleaned).length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? cleaned : null;
}

// Decodes a PNG data URL and validates it: prefix, decoded size, the 8-byte
// PNG signature, and the width and height in the IHDR chunk. Returns the PNG
// bytes, or null if anything is off.
function decodePng(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }
  const base64 = value.slice(PNG_DATA_URL_PREFIX.length);
  // Cheap size check before decoding: base64 is 4 characters per 3 bytes.
  if (base64.length > Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4) return null;

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  // 8 signature bytes + 4 length + 4 "IHDR" + 4 width + 4 height.
  if (bytes.length < 24 || bytes.length > MAX_SIGNATURE_BYTES) return null;

  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  for (let i = 0; i < PNG_IHDR_TAG.length; i++) {
    if (bytes[12 + i] !== PNG_IHDR_TAG[i]) return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return null;
  if (width > MAX_PNG_WIDTH || height > MAX_PNG_HEIGHT) return null;

  return bytes;
}

async function handleSubmit(
  admin: AdminClient,
  check: Extract<TokenCheck, { ok: true }>,
  body: Record<string, unknown>,
  cors: CorsHeaders,
): Promise<Response> {
  const { request } = check;
  const invoiceId = request.invoice_id;

  const name = cleanName(body.name);
  if (name === null) return errorResponse("bad_request", cors);
  const png = decodePng(body.signature);
  if (png === null) return errorResponse("bad_request", cors);

  // The upload MUST come before the update: the webhook fires on the update
  // and needs the file to exist.
  const path = `signatures/${invoiceId}/customer.png`;
  const { error: uploadError } = await admin.storage
    .from("job-images")
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (uploadError) {
    console.error(`signature upload failed for invoice ${invoiceId}`);
    return errorResponse("server", cors);
  }

  // One conditional update: only succeeds while the request is still unused
  // and unexpired, so a link can be used exactly once.
  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("signature_requests")
    .update({
      used_at: nowIso,
      customer_name: name,
      customer_signature_path: path,
    })
    .eq("id", request.id)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("id");

  if (updateError) {
    console.error(`signature request update failed for invoice ${invoiceId}`);
    return errorResponse("server", cors);
  }

  if (!updated || updated.length === 0) {
    // Lost a race or the link expired since the check: say which.
    const { data: again, error: rereadError } = await admin
      .from("signature_requests")
      .select("used_at, expires_at")
      .eq("id", request.id)
      .maybeSingle();
    const current = again as
      | { used_at: string | null; expires_at: string }
      | null;
    if (rereadError || !current) {
      console.error(`signature request re-read failed for invoice ${invoiceId}`);
      return errorResponse("server", cors);
    }
    if (current.used_at) return errorResponse("used", cors);
    if (!(new Date(current.expires_at).getTime() > Date.now())) {
      return errorResponse("expired", cors);
    }
    console.error(`signature request update matched no row for invoice ${invoiceId}`);
    return errorResponse("server", cors);
  }

  console.log(`Customer signature stored for invoice ${invoiceId}`);
  return jsonResponse({ ok: true }, 200, cors);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "bad_request" }, 405, {
      ...cors,
      Allow: "POST, OPTIONS",
    });
  }

  try {
    const raw = await readBodyLimited(req);
    if (raw === null) return errorResponse("too_large", cors);

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return errorResponse("bad_request", cors);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return errorResponse("bad_request", cors);
    }

    const action = body.action;
    if (action !== "load" && action !== "submit") {
      return errorResponse("bad_request", cors);
    }

    // Wrong shape: 404 without touching the database.
    const token = body.token;
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      return errorResponse("invalid", cors);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("function environment is not configured");
      return errorResponse("server", cors);
    }
    const admin = createAdminClient(supabaseUrl, serviceRoleKey);

    const check = await checkToken(admin, token);
    if (!check.ok) return errorResponse(check.code, cors);

    if (action === "load") return handleLoad(check, cors);
    return await handleSubmit(admin, check, body, cors);
  } catch {
    // Static message only: the error could carry request data.
    console.error("unexpected error");
    return errorResponse("server", cors);
  }
});
