// delete-test-job
//
// Hard-deletes a single job and all of its dependent rows and storage files.
//
// SAFETY: this function will ONLY ever delete a job whose `is_test` column is
// exactly `true` in the database. That check is the single source of truth — no
// client-supplied flag or any other signal is trusted. If the job is not a test
// job, the function returns 403 and touches nothing.
//
// The customer row is never deleted, regardless of linkage.
//
// Caller must be an authenticated Supabase user (Authorization bearer token).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function buildCorsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":
      req.headers.get("Origin") ?? "https://dtf-field-ops.vercel.app",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  // --- Verify the caller -----------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401, buildCorsHeaders(req));
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401, buildCorsHeaders(req));
  }

  // --- Step 1: Parse the request body ----------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, buildCorsHeaders(req));
  }

  const jobId = (body as Record<string, unknown> | null)?.job_id;
  if (typeof jobId !== "string" || jobId.length === 0) {
    return jsonResponse({ error: "Missing or invalid job_id" }, 400, buildCorsHeaders(req));
  }

  // --- Step 2: Admin client (service role — bypasses RLS) --------------------
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // --- Step 3: Load the job (need is_test to make the safety decision) --------
  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .select("id, is_test")
    .eq("id", jobId)
    .maybeSingle();

  if (jobError) {
    console.error(`Failed to load job ${jobId}: ${jobError.message}`);
    return jsonResponse({ error: "job_lookup_failed" }, 500, buildCorsHeaders(req));
  }

  if (!job) {
    return jsonResponse({ error: "job_not_found" }, 404, buildCorsHeaders(req));
  }

  // --- Step 4: CRITICAL SAFETY CHECK -----------------------------------------
  // Only the database value of is_test is trusted. Must be exactly true.
  if (job.is_test !== true) {
    return jsonResponse({ error: "not_a_test_job" }, 403, buildCorsHeaders(req));
  }

  // --- Step 5: Gather invoice ids for this job -------------------------------
  const { data: invoices, error: invoicesError } = await adminClient
    .from("invoices")
    .select("id")
    .eq("job_id", jobId);

  if (invoicesError) {
    console.error(
      `Failed to load invoices for job ${jobId}: ${invoicesError.message}`,
    );
    return jsonResponse({ error: "invoice_lookup_failed" }, 500, buildCorsHeaders(req));
  }

  const invoiceIds = (invoices ?? []).map((inv) => inv.id as string);

  // --- Step 6: Gather image storage paths for this job -----------------------
  const { data: images, error: imagesError } = await adminClient
    .from("images")
    .select("id, storage_path")
    .eq("job_id", jobId);

  if (imagesError) {
    console.error(
      `Failed to load images for job ${jobId}: ${imagesError.message}`,
    );
    return jsonResponse({ error: "image_lookup_failed" }, 500, buildCorsHeaders(req));
  }

  // --- Step 7: Best-effort delete of image files from storage ----------------
  // File cleanup is best-effort; the DB cleanup below is the critical path.
  const imagePaths = (images ?? [])
    .map((img) => img.storage_path as string | null)
    .filter((p): p is string => typeof p === "string" && p.length > 0);

  if (imagePaths.length > 0) {
    const { error: removeError } = await adminClient.storage
      .from("job-images")
      .remove(imagePaths);
    if (removeError) {
      console.error(
        `Best-effort image file cleanup failed for job ${jobId}: ${removeError.message}`,
      );
    }
  }

  // --- Step 8: Best-effort delete of signature files from storage ------------
  // technician.png / customer.png may never have been created (unsigned invoice);
  // a missing file here is expected and silent.
  const signaturePaths = invoiceIds.flatMap((id) => [
    `signatures/${id}/technician.png`,
    `signatures/${id}/customer.png`,
  ]);

  if (signaturePaths.length > 0) {
    const { error: sigRemoveError } = await adminClient.storage
      .from("job-images")
      .remove(signaturePaths);
    if (sigRemoveError) {
      console.error(
        `Best-effort signature file cleanup failed for job ${jobId}: ${sigRemoveError.message}`,
      );
    }
  }

  // --- Steps 9-13: Critical database deletes ---------------------------------
  // From here on, every delete must succeed. On any failure return 500 so the
  // caller knows the job was not fully removed.

  // Step 9: signature_requests for these invoices.
  if (invoiceIds.length > 0) {
    const { error } = await adminClient
      .from("signature_requests")
      .delete()
      .in("invoice_id", invoiceIds);
    if (error) {
      console.error(
        `Failed to delete signature_requests for job ${jobId}: ${error.message}`,
      );
      return jsonResponse({ error: "delete_signature_requests_failed" }, 500, buildCorsHeaders(req));
    }
  }

  // Step 10: appointments, images, videos for this job.
  {
    const { error } = await adminClient
      .from("appointments")
      .delete()
      .eq("job_id", jobId);
    if (error) {
      console.error(
        `Failed to delete appointments for job ${jobId}: ${error.message}`,
      );
      return jsonResponse({ error: "delete_appointments_failed" }, 500, buildCorsHeaders(req));
    }
  }
  {
    const { error } = await adminClient
      .from("images")
      .delete()
      .eq("job_id", jobId);
    if (error) {
      console.error(
        `Failed to delete images for job ${jobId}: ${error.message}`,
      );
      return jsonResponse({ error: "delete_images_failed" }, 500, buildCorsHeaders(req));
    }
  }
  {
    const { error } = await adminClient
      .from("videos")
      .delete()
      .eq("job_id", jobId);
    if (error) {
      console.error(
        `Failed to delete videos for job ${jobId}: ${error.message}`,
      );
      return jsonResponse({ error: "delete_videos_failed" }, 500, buildCorsHeaders(req));
    }
  }

  // Warranties tied to these invoices — deleted BEFORE invoices because
  // warranties.invoice_id references invoices.id (FK), so children go first.
  if (invoiceIds.length > 0) {
    const { error } = await adminClient
      .from("warranties")
      .delete()
      .in("invoice_id", invoiceIds);
    if (error) {
      console.error(
        `Failed to delete warranties for job ${jobId}: ${error.message}`,
      );
      return jsonResponse({ error: "delete_warranties_failed" }, 500, buildCorsHeaders(req));
    }
  }

  // Invoices for this job — after warranties so no FK reference remains.
  {
    const { error } = await adminClient
      .from("invoices")
      .delete()
      .eq("job_id", jobId);
    if (error) {
      console.error(
        `Failed to delete invoices for job ${jobId}: ${error.message}`,
      );
      return jsonResponse({ error: "delete_invoices_failed" }, 500, buildCorsHeaders(req));
    }
  }

  // Step 13: the job itself.
  {
    const { error } = await adminClient.from("jobs").delete().eq("id", jobId);
    if (error) {
      console.error(`Failed to delete job ${jobId}: ${error.message}`);
      return jsonResponse({ error: "delete_job_failed" }, 500, buildCorsHeaders(req));
    }
  }

  // Step 14: customers table is intentionally left untouched.

  // --- Step 16: Success ------------------------------------------------------
  console.log(`Test job ${jobId} deleted successfully`);
  return jsonResponse({ success: true }, 200, buildCorsHeaders(req));
});
