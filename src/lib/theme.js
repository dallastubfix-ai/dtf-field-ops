import { useState, useEffect, useCallback } from 'react'

const THEME_KEY = 'dtf-theme-pref'
const ACCENTS_KEY = 'dtf-accents'
const THEME_PREFS = ['system', 'light', 'dark']
const ACCENT_VALUES = ['on', 'off']

// Final phase of the UI polish flips this to 'system'.
export const DEFAULT_THEME_PREF = 'light'
const DEFAULT_ACCENTS = 'on'

const DARK_QUERY = '(prefers-color-scheme: dark)'

// Page-base token values, used for the Android status bar / nav bar color.
const THEME_COLORS = { light: '#E6E9EE', dark: '#0A0B0D' }

function readKey(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

function writeKey(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked (private window, site data cleared) - the choice just won't persist.
  }
}

export function getThemePref() {
  return readKey(THEME_KEY, THEME_PREFS, DEFAULT_THEME_PREF)
}

export function getAccents() {
  return readKey(ACCENTS_KEY, ACCENT_VALUES, DEFAULT_ACCENTS)
}

let mediaQuery = null
let mediaListener = null

function systemPrefersDark() {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

// Sets both data attributes on <html>. While the pref is "system", it also
// listens for the phone's light/dark setting changing and re-applies.
export function applyTheme() {
  const pref = getThemePref()
  const resolved = pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.accents = getAccents()

  let themeMeta = document.querySelector('meta[name="theme-color"]')
  if (!themeMeta) {
    themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    document.head.appendChild(themeMeta)
  }
  themeMeta.setAttribute('content', THEME_COLORS[resolved])

  if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener('change', mediaListener)
    mediaQuery = null
    mediaListener = null
  }
  if (pref === 'system') {
    try {
      mediaQuery = window.matchMedia(DARK_QUERY)
      mediaListener = () => applyTheme()
      mediaQuery.addEventListener('change', mediaListener)
    } catch {
      mediaQuery = null
      mediaListener = null
    }
  }
}

export function setThemePref(pref) {
  if (!THEME_PREFS.includes(pref)) return
  writeKey(THEME_KEY, pref)
  applyTheme()
}

export function setAccents(value) {
  if (!ACCENT_VALUES.includes(value)) return
  writeKey(ACCENTS_KEY, value)
  applyTheme()
}

export function useTheme() {
  const [themePref, setThemePrefState] = useState(getThemePref)
  const [accents, setAccentsState] = useState(getAccents)

  const updateThemePref = useCallback((pref) => {
    setThemePref(pref)
    setThemePrefState(getThemePref())
  }, [])

  const updateAccents = useCallback((value) => {
    setAccents(value)
    setAccentsState(getAccents())
  }, [])

  // Keep the hook in step if another tab changes the stored choice.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== THEME_KEY && e.key !== ACCENTS_KEY) return
      setThemePrefState(getThemePref())
      setAccentsState(getAccents())
      applyTheme()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { themePref, accents, setThemePref: updateThemePref, setAccents: updateAccents }
}
