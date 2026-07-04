// promote-customer-signature
//
// Triggered by a Supabase Database Webhook when a row in `signature_requests`
// is UPDATED. The caller is server-side (the Postgres webhook), NOT a browser,
// so there is no CORS handling here.
//
// Responsibilities:
//   1. Authenticate the webhook via a shared secret header.
//   2. On the exact transition of a signature request from unfulfilled to
//      fulfilled, promote the stored signature into a signed URL and write it
//      onto the invoice.
//   3. Best-effort: notify the technician via FCM push.
//
// SECURITY: never log the Firebase private key, the constructed JWT, the
// access token, or any full request/response body from Google's endpoints.
// Only static messages and safe identifiers (e.g. invoice id) are logged.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// One year, in seconds. Matches the signed-URL expiry already used in
// InvoiceBuilder.jsx so the two code paths stay consistent.
const SIGNED_URL_EXPIRY_SECONDS = 31536000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Base64url-encode raw bytes: standard base64, then + -> -, / -> _, no padding.
function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlEncodeString(str: string): string {
  return base64urlEncodeBytes(new TextEncoder().encode(str));
}

// Build and sign a JWT for the Firebase service account using the Web Crypto
// API (native in Deno — no external JWT library needed).
async function buildFirebaseJwt(): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: Deno.env.get("FIREBASE_CLIENT_EMAIL"),
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned =
    `${base64urlEncodeString(JSON.stringify(header))}.` +
    `${base64urlEncodeString(JSON.stringify(claims))}`;

  // Import the service-account private key (PKCS#8 PEM). The env var stores
  // newlines as literal "\n" sequences, so restore real newlines first, then
  // strip the PEM header/footer and all internal whitespace before decoding.
  const pem = (Deno.env.get("FIREBASE_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n");
  const pemUnquoted = pem.trim().replace(/^"|"$/g, "").trim();
  const pemBody = pemUnquoted
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64urlEncodeBytes(new Uint8Array(signature))}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // --- Step 1/2: Authenticate the webhook via shared secret ------------------
  const providedSecret = req.headers.get("X-Webhook-Secret");
  const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  // --- Step 3: Parse the webhook payload -------------------------------------
  let payload: {
    type?: string;
    table?: string;
    record?: Record<string, unknown>;
    old_record?: Record<string, unknown>;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const record = payload.record ?? {};
  const oldRecord = payload.old_record ?? {};

  // --- Step 4: Only act on the unfulfilled -> fulfilled transition -----------
  // Guards against reprocessing on unrelated updates to the same row.
  const isFulfillmentTransition =
    record.used_at != null && oldRecord.used_at == null;
  if (!isFulfillmentTransition) {
    return jsonResponse({ skipped: true }, 200);
  }

  // --- Step 5: Extract the fields we need ------------------------------------
  const invoiceId = record.invoice_id as string;
  const customerSignaturePath = record.customer_signature_path as string;
  const customerName = record.customer_name as string | null | undefined;

  // --- Step 6: Admin client (service role — bypasses RLS) --------------------
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // --- Step 7/8: Create a signed URL for the stored signature ----------------
  const { data: signedUrlData, error: signedUrlError } = await adminClient.storage
    .from("job-images")
    .createSignedUrl(customerSignaturePath, SIGNED_URL_EXPIRY_SECONDS);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    console.error(
      `signed_url_failed for invoice ${invoiceId}: ${signedUrlError?.message ?? "no signed url returned"}`,
    );
    return jsonResponse({ error: "signed_url_failed" }, 500);
  }

  // --- Step 9/10: Write the signed URL onto the invoice (critical path) ------
  const { error: invoiceUpdateError } = await adminClient
    .from("invoices")
    .update({
      customer_signature_url: signedUrlData.signedUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (invoiceUpdateError) {
    console.error(
      `invoice_update_failed for invoice ${invoiceId}: ${invoiceUpdateError.message}`,
    );
    return jsonResponse({ error: "invoice_update_failed" }, 500);
  }

  console.log(`Invoice ${invoiceId} signature URL updated successfully`);

  // --- Steps 11-16: Best-effort push notification ----------------------------
  // A failure anywhere in here must NOT fail the overall response — the invoice
  // update above already succeeded and is the important part.
  try {
    // Step 12: single-technician design for now (known limitation).
    const { data: subscriptions, error: subError } = await adminClient
      .from("push_subscriptions")
      .select("endpoint")
      .limit(1);

    if (subError) {
      throw new Error(`push_subscriptions query failed: ${subError.message}`);
    }

    const endpoint = subscriptions?.[0]?.endpoint as string | undefined;

    // Step 13: nothing to notify.
    if (!endpoint) {
      console.log("No push subscription found, skipping notification");
    } else {
      // Step 14: build the signed service-account JWT.
      const jwt = await buildFirebaseJwt();

      // Step 15: exchange the JWT for a Google OAuth access token.
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (!tokenResp.ok) {
        // Do not log the response body — it may echo sensitive material.
        throw new Error(`Token exchange failed with status ${tokenResp.status}`);
      }

      const tokenJson = await tokenResp.json();
      const accessToken = tokenJson.access_token as string | undefined;
      if (!accessToken) {
        throw new Error("Token exchange returned no access_token");
      }

      // Step 16: send the FCM push.
      const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
      const fcmResp = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: endpoint,
              notification: {
                title: "Signature Received",
                body: `${customerName || "Customer"} signed the invoice`,
              },
            },
          }),
        },
      );

      if (fcmResp.ok) {
        console.log(`Push notification sent for invoice ${invoiceId}`);
      } else {
        // Do not log the response body.
        console.error(
          `Push notification failed for invoice ${invoiceId} with status ${fcmResp.status}`,
        );
      }
    }
  } catch (pushError) {
    // Best-effort only: log a safe message and continue to the final return.
    console.error(
      `Push notification error for invoice ${invoiceId}: ${
        pushError instanceof Error ? pushError.message : "unknown error"
      }`,
    );
  }

  // --- Step 17: Success — reached whenever the invoice update succeeded -------
  return jsonResponse({ success: true }, 200);
});
