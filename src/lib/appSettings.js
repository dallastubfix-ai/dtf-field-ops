import { supabase } from './supabase'
import db from './db'
import { upsertLocal } from './sync'

const SETTINGS_ID = 'default'

async function readLocal() {
  try {
    return (await db.app_settings.where('id').equals(SETTINGS_ID).first()) ?? null
  } catch {
    return null
  }
}

// Never throws. Returns the Dexie copy, replaced by the server row when online
// and the fetch succeeds. Returns null if neither is available.
export async function loadHomeAddress(isOnline) {
  const local = await readLocal()
  if (!isOnline) return local

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('id, home_address, updated_at')
      .eq('id', SETTINGS_ID)
      .maybeSingle()
    if (error || !data) return local
    try {
      await upsertLocal('app_settings', { ...data, _synced: true })
    } catch {
      // local cache failure must not hide a good server row
    }
    return data
  } catch {
    return local
  }
}

// Online only. Success means the server returned the row with the exact
// address we sent. updateRecord is not used because it can't report failure.
export async function saveHomeAddress(address) {
  const home_address = (address ?? '').trim()
  if (!home_address) return { ok: false, message: 'Enter your home address first.' }
  if (!navigator.onLine) return { ok: false, message: 'Connect to the internet to save your home address.' }

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .upsert(
        { id: SETTINGS_ID, home_address, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select()
      .single()

    if (error || !data || data.home_address !== home_address) {
      return { ok: false, message: 'Your home address could not be saved. Please try again.' }
    }

    try {
      await upsertLocal('app_settings', { ...data, _synced: true })
    } catch {
      // server has it; the local copy refreshes on the next load
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Your home address could not be saved. Check your connection and try again.' }
  }
}
