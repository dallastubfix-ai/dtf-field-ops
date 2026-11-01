// Uploads a finished collage JPEG to the job's Google Drive photo folder and records it
// in the images table (image_type 'collage'). Collages only: ImageCapture has its own copy.
import { supabase } from './supabase'
import db from './db'
import { getValidProviderToken } from './googleToken'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id'

// Saves drive_folder_id on the server, one retry. True when the server accepted it.
async function saveFolderIdToServer(jobId, folderId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await supabase.from('jobs').update({ drive_folder_id: folderId }).eq('id', jobId)
      if (!error) return true
      console.error('drive_folder_id save error:', error)
    } catch (err) {
      console.error('drive_folder_id save error:', err)
    }
  }
  return false
}

// Server save failed twice: queue a partial jobs update so it syncs when the signal is better.
async function queueFolderId(jobId, folderId) {
  try {
    await db.sync_queue.add({
      table_name: 'jobs',
      operation: 'update',
      payload: { id: jobId, drive_folder_id: folderId },
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('drive_folder_id queue error:', err) // the warning below still tells John
  }
}

async function saveFolderIdLocally(jobId, folderId) {
  try {
    await db.jobs.where('id').equals(jobId).modify({ drive_folder_id: folderId })
  } catch (err) {
    console.error('local drive_folder_id save error:', err) // the server copy is what matters
  }
}

// Returns { folderId, warning }. Uses the job's folder if it has one; else re-reads the
// server copy (the local one may be stale) before creating a new folder.
async function ensureJobFolder(job, token) {
  if (job.drive_folder_id) return { folderId: job.drive_folder_id, warning: null }

  const { data, error } = await supabase.from('jobs').select('drive_folder_id').eq('id', job.id).maybeSingle()
  if (error) {
    console.error('drive_folder_id read error:', error)
    throw new Error("Couldn't check this job's Drive folder. Please try again.")
  }
  if (data?.drive_folder_id) {
    await saveFolderIdLocally(job.id, data.drive_folder_id)
    return { folderId: data.drive_folder_id, warning: null }
  }

  const topFolderId = import.meta.env.VITE_GOOGLE_DRIVE_PHOTOS_FOLDER_ID
  const res = await fetch(DRIVE_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: job.job_number ?? job.id,
      mimeType: 'application/vnd.google-apps.folder',
      ...(topFolderId ? { parents: [topFolderId] } : {}),
    }),
  })
  if (!res.ok) {
    console.error('Drive folder creation error:', res.status, (await res.text()).slice(0, 150))
    throw new Error("Couldn't create the Drive folder. Please try again.")
  }
  const { id: folderId } = await res.json()

  const saved = await saveFolderIdToServer(job.id, folderId)
  await saveFolderIdLocally(job.id, folderId)
  if (!saved) await queueFolderId(job.id, folderId)
  return {
    folderId,
    warning: saved
      ? null
      : "The collage was saved, but this job's Drive folder couldn't be linked on the server yet. It will sync when the signal is better.",
  }
}

async function deleteDriveFile(token, fileId) {
  try {
    const res = await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

// job: the job row (needs id, job_number, drive_folder_id). file: the JPEG File. filename: final name.
// Returns { record, warning }. Throws an Error with a message that is safe to show.
export async function uploadCollageToDrive({ job, file, filename }) {
  if (!job?.id) throw new Error("Couldn't find this job. Please try again.")

  const token = await getValidProviderToken()
  if (!token) throw new Error('Google Drive not connected')

  const { folderId, warning } = await ensureJobFolder(job, token)

  const form = new FormData()
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name: filename, mimeType: 'image/jpeg', parents: [folderId] })], { type: 'application/json' })
  )
  form.append('file', file)

  let driveFileId
  try {
    const res = await fetch(DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) {
      console.error('Drive upload error:', res.status, (await res.text()).slice(0, 150))
      throw new Error('upload failed')
    }
    driveFileId = (await res.json()).id
  } catch {
    throw new Error("Couldn't upload the collage to Google Drive. Please try again.")
  }

  const record = {
    id: crypto.randomUUID(),
    job_id: job.id,
    storage_path: null,
    google_drive_file_id: driveFileId,
    filename,
    image_type: 'collage',
    latitude: null,
    longitude: null,
    captured_at: new Date().toISOString(),
  }

  let insertFailed = false
  try {
    const { error } = await supabase.from('images').insert(record)
    if (error) {
      console.error('images insert error:', error)
      insertFailed = true
    }
  } catch (err) {
    console.error('images insert error:', err)
    insertFailed = true
  }
  if (insertFailed) {
    const undone = await deleteDriveFile(token, driveFileId)
    throw new Error(
      undone
        ? "The collage couldn't be saved. The upload was undone. Please try again."
        : "The collage couldn't be saved, and the uploaded copy may still be in Drive. Please try again."
    )
  }

  try {
    await db.images.add({ ...record, _synced: true })
  } catch (err) {
    console.error('local images save error:', err) // the server has it; the page reloads from there
  }
  return { record, warning }
}
