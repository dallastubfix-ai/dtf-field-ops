import { supabase } from './supabase'
import db from './db'

// Clears the Dexie-only "pending" flag once nothing else is queued for that row.
async function markSyncedIfClear(op) {
  const id = op.payload?.id
  if (id == null || op.operation === 'delete') return
  try {
    const left = await db.sync_queue
      .where('table_name').equals(op.table_name)
      .filter(o => o.payload?.id === id).count()
    if (left === 0) await db[op.table_name].where('id').equals(id).modify({ _synced: true })
  } catch { /* cosmetic flag */ }
}

export async function processSyncQueue() {
  const pending = await db.sync_queue.orderBy('id').toArray()
  if (pending.length === 0) return { synced: 0, errors: 0 }

  let synced = 0
  let errors = 0

  for (const op of pending) {
    try {
      if (op.operation === 'insert') {
        const { error } = await supabase.from(op.table_name).insert(op.payload)
        if (error) throw error
      } else if (op.operation === 'update') {
        const { error } = await supabase
          .from(op.table_name)
          .update(op.payload)
          .eq('id', op.payload.id)
        if (error) throw error
      } else if (op.operation === 'delete') {
        const { error } = await supabase
          .from(op.table_name)
          .delete()
          .eq('id', op.payload.id)
        if (error) throw error
      }
      await db.sync_queue.delete(op.id)
      await markSyncedIfClear(op)
      synced++
    } catch (err) {
      if (err?.code === '23505') {
        await db.sync_queue.delete(op.id)
        await markSyncedIfClear(op)
        synced++
      } else {
        console.error('Sync error for op', op.id, err)
        errors++
      }
    }
  }
  return { synced, errors }
}

// Upsert a row into Dexie keyed by the real Supabase `id`, NOT the Dexie
// ++_localId primary key. A plain db.table.put() of a row without _localId
// always inserts a new row, so repeated background refreshes would otherwise
// accumulate duplicate records on every page load.
export async function upsertLocal(tableName, row) {
  if (!row || row.id == null) return
  const existing = await db[tableName].where('id').equals(row.id).first()
  if (existing) {
    await db[tableName].where('id').equals(row.id).modify(row)
  } else {
    await db[tableName].add(row)
  }
}

// Ids in `tableName` that still have a queued insert/update/delete.
async function pendingIdsFor(tableName) {
  const ops = await db.sync_queue.where('table_name').equals(tableName).toArray()
  return new Set(ops.map(op => op.payload?.id).filter(id => id != null))
}

// Merge a server list into Dexie without losing unsynced local work.
// Pending = a queued sync_queue op for the id. With honorUnsyncedFlag, a local
// _synced === false also counts (invoices: InvoiceBuilder sets it with no queue op).
// Pending local rows are left untouched; every other row is replaced by the server
// row (marked _synced: true), reusing _localId so no duplicates are created.
// removeMissing: ONLY when serverRows is the complete set for the table (or for
// the slice removeScope describes). Deletes local rows the server no longer has,
// except pending ones. An empty list never deletes anything.
export async function mergeServerRows(
  tableName, serverRows,
  { removeMissing = false, honorUnsyncedFlag = false, removeScope = null } = {}
) {
  if (!Array.isArray(serverRows)) return
  const table = db[tableName]
  await db.transaction('rw', table, db.sync_queue, async () => {
    const pending = await pendingIdsFor(tableName)
    const ids = serverRows.map(r => r?.id).filter(id => id != null)
    // Only the removal step needs every local row; otherwise look up just these ids.
    const locals = removeMissing
      ? await table.toArray()
      : (ids.length ? await table.where('id').anyOf(ids).toArray() : [])
    const localById = new Map(locals.filter(r => r.id != null).map(r => [r.id, r]))
    const unsynced = r => honorUnsyncedFlag && r._synced === false
    const isPending = r => pending.has(r.id) || unsynced(r)

    const serverIds = new Set()
    const toPut = []
    for (const row of serverRows) {
      if (row?.id == null) continue
      serverIds.add(row.id)
      const local = localById.get(row.id)
      if (pending.has(row.id) || (local && unsynced(local))) continue
      toPut.push({ ...row, _synced: true, ...(local ? { _localId: local._localId } : {}) })
    }
    await table.bulkPut(toPut)

    if (removeMissing && serverRows.length > 0) {
      const gone = locals
        .filter(r => r.id != null && !serverIds.has(r.id) && !isPending(r) && (!removeScope || removeScope(r)))
        .map(r => r._localId)
      await table.bulkDelete(gone)
    }
  })
}

// Single-row version for the refresh loops. Same rule: pending local rows win.
export async function upsertServerRow(tableName, row, opts) {
  await mergeServerRows(tableName, [row], opts)
}

export async function writeRecord(tableName, payload, isOnline) {
  await db[tableName].put({ ...payload, _synced: isOnline })

  if (isOnline) {
    const { data, error } = await supabase.from(tableName).insert(payload).select().single()
    if (error) {
      await db.sync_queue.add({
        table_name: tableName,
        operation: 'insert',
        payload,
        created_at: new Date().toISOString()
      })
      throw error
    }
    return data
  } else {
    await db.sync_queue.add({
      table_name: tableName,
      operation: 'insert',
      payload,
      created_at: new Date().toISOString()
    })
    return payload
  }
}

export async function updateRecord(tableName, payload, isOnline) {
  // _localId and _synced are Dexie-only bookkeeping fields — they are NOT
  // columns on the Supabase table, so they must be stripped before any
  // .update() call or Postgres rejects the whole request.
  const { _localId, _synced, ...clean } = payload

  await db[tableName].where('id').equals(clean.id).modify({ ...clean, _synced: !!isOnline })

  if (isOnline) {
    const { error } = await supabase
      .from(tableName)
      .update(clean)
      .eq('id', clean.id)
    if (error) {
      await db[tableName].where('id').equals(clean.id).modify({ _synced: false })
      await db.sync_queue.add({
        table_name: tableName,
        operation: 'update',
        payload: clean,
        created_at: new Date().toISOString()
      })
      return { synced: false }
    }
    return { synced: true }
  } else {
    await db.sync_queue.add({
      table_name: tableName,
      operation: 'update',
      payload: clean,
      created_at: new Date().toISOString()
    })
    return { synced: false }
  }
}
