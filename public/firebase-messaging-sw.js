importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            "AIzaSyDwF1U0STPwy0dWPjW2-CxBn0xALxeBF3E",
  authDomain:        "dtf-field-ops-ae91c.firebaseapp.com",
  projectId:         "dtf-field-ops-ae91c",
  storageBucket:     "dtf-field-ops-ae91c.firebasestorage.app",
  messagingSenderId: "136950488759",
  appId:             "1:136950488759:web:66934942a5c419da577732",
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {}
  self.registration.showNotification(title ?? 'DTF Field Ops', {
    body: body ?? '',
    icon: '/icons/icon-192.svg',
  })
})
