import Dexie from 'dexie'

export const db = new Dexie('dtf_field_ops')

db.version(1).stores({
  customers:    '++_localId, id, phone, full_name, created_at',
  jobs:         '++_localId, id, job_number, customer_id, status, created_at',
  appointments: '++_localId, id, job_id, appointment_datetime',
  images:       '++_localId, id, job_id, image_type',
  videos:       '++_localId, id, job_id',
  invoices:     '++_localId, id, job_id, payment_status',
  warranties:   '++_localId, id, invoice_id, job_id',
  sync_queue:   '++id, table_name, operation, created_at',
  auth_cache:   'key'
})

export default db
