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
  await db[tableName].where('id').equals(payload.id).modify(payload)

  if (isOnline) {
    const { error } = await supabase
      .from(tableName)
      .update(payload)
      .eq('id', payload.id)
    if (error) {
      await db.sync_queue.add({
        table_name: tableName,
        operation: 'update',
        payload,
        created_at: new Date().toISOString()
      })
    }
  } else {
    await db.sync_queue.add({
      table_name: tableName,
      operation: 'update',
      payload,
      created_at: new Date().toISOString()
    })
  }
}
