const BASE_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

function incrementDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function buildEventBody({ customerName, address, appointmentDate, appointmentTime, jobNumber, notes }) {
  const description = notes ? `Job ${jobNumber}\n${notes}` : `Job ${jobNumber}`

  const startDateTime = `${appointmentDate}T${appointmentTime}:00`

  const [hour, minute] = appointmentTime.split(':').map(Number)
  const endHour = hour + 2
  const endDate = endHour >= 24 ? incrementDate(appointmentDate) : appointmentDate
  const endTime = `${String(endHour % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const endDateTime = `${endDate}T${endTime}:00`

  return {
    summary: `DTF – ${customerName}`,
    location: address,
    description,
    start: { dateTime: startDateTime, timeZone: 'America/Chicago' },
    end: { dateTime: endDateTime, timeZone: 'America/Chicago' },
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
