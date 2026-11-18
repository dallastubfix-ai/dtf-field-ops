import { companyFor, isSubcontract } from './jobLabel'

const BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

// Title, first description line and color for an event. DTF: exactly the old "DTF – Name" / "Job <number>"
// and NO colorId key. BBR / TTR: "<TAG> – Name", the job label, and the company color.
function eventHead({ customerName, jobNumber, workingFor, label }) {
  if (!isSubcontract({ working_for: workingFor })) {
    return { summary: `DTF – ${customerName}`, head: `Job ${jobNumber}`, color: {} }
  }
  const company = companyFor(workingFor)
  return { summary: `${company.tag} – ${customerName}`, head: label || company.tag, color: { colorId: company.colorId } }
}

function incrementDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function buildEventBody({ customerName, address, appointmentDate, appointmentTime, jobNumber, notes, workingFor, label }) {
  const { summary, head, color } = eventHead({ customerName, jobNumber, workingFor, label })
  const description = notes ? `${head}\n${notes}` : head

  const startDateTime = `${appointmentDate}T${appointmentTime}:00`

  const [hour, minute] = appointmentTime.split(':').map(Number)
  const endHour = hour + 2
  const endDate = endHour >= 24 ? incrementDate(appointmentDate) : appointmentDate
  const endTime = `${String(endHour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const endDateTime = `${endDate}T${endTime}:00`

  return {
    summary,
    location: address,
    description,
    start: { dateTime: startDateTime, timeZone: 'America/Chicago' },
    end: { dateTime: endDateTime, timeZone: 'America/Chicago' },
    ...color,
  }
}

export async function createCalendarEvent(token, appointmentData) {
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEventBody(appointmentData)),
    })
    if (res.status === 401) return { error: 'token_expired' }
    if (res.status === 200 || res.status === 201) {
      const data = await res.json()
      return data.id
    }
    const errBody = await res.text()
    console.error('Calendar API request failed:', res.status, errBody)
    return { error: 'request_failed', status: res.status, detail: errBody.slice(0, 200) }
  } catch (err) {
    console.error('Calendar API network error:', err)
    return { error: 'network_error', detail: err?.message || 'Unknown error' }
  }
}

export async function updateCalendarEvent(token, eventId, appointmentData) {
  try {
    const res = await fetch(`${BASE_URL}/${eventId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEventBody(appointmentData)),
    })
    if (res.status === 401) return { error: 'token_expired' }
    if (res.status === 200) return eventId
    const errBody = await res.text()
    console.error('Calendar API request failed:', res.status, errBody)
    return { error: 'request_failed', status: res.status, detail: errBody.slice(0, 200) }
  } catch (err) {
    console.error('Calendar API network error:', err)
    return { error: 'network_error', detail: err?.message || 'Unknown error' }
  }
}

export async function deleteCalendarEvent(token, eventId) {
  try {
    const res = await fetch(`${BASE_URL}/${eventId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (res.status === 401) return { error: 'token_expired' }
    if (res.status === 204) return true
    return null
  } catch {
    return null
  }
}

// After a job's company or label changed: rewrites the title, the color and the FIRST description
// line of each existing event, keeping the rest of the description (notes) and the time and place.
// Best effort. Returns { failed }: how many events could not be updated. An event already deleted
// in Google is skipped, not counted as a failure.
export async function refreshCalendarEvents(token, eventIds, { customerName, jobNumber, workingFor, label }) {
  let failed = 0
  for (const eventId of eventIds) {
    try {
      const url = `${BASE_URL}/${eventId}`
      const getRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (getRes.status === 404 || getRes.status === 410) continue
      if (!getRes.ok) { failed++; continue }
      const event = await getRes.json()
      if (event?.status === 'cancelled') continue
      // Keep the name already on the event if this page doesn't have the customer loaded.
      const name = customerName || String(event?.summary ?? '').split(' – ').slice(1).join(' – ')
      const { summary, head, color } = eventHead({ customerName: name, jobNumber, workingFor, label })
      const rest = String(event?.description ?? '').split('\n').slice(1).join('\n')
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, description: rest ? `${head}\n${rest}` : head, ...color }),
      })
      if (!res.ok) failed++
    } catch {
      failed++
    }
  }
  return { failed }
}
