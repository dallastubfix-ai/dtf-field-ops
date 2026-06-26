import { supabase } from './supabase'
import db from './db'

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
      synced++
    } catch (err) {
      if (err?.code === '23505') {
        await db.sync_queue.delete(op.id)
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
    }
  } else {
    await db.sync_queue.add({
      table_name: tableName,
      operation: 'update',
      payload: clean,
      created_at: new Date().toISOString()
    })
  }
}
