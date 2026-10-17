const express = require('express');
const { modelRequest, validSymptoms } = require('./model-client');
const { withTransaction, run } = require('./transaction');

module.exports = function doctorRoutes({ pool, verifiedDoctor, dbError }) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const id = (value) => /^[1-9]\d*$/.test(String(value || ''));
  const content = (value, max = 4000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const optional = (value, max = 4000) => value === undefined || (typeof value === 'string' && value.length <= max);
  const query = (sql, params = []) => new Promise((resolve, reject) => pool.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
  const fail = (res, error) => dbError(res, error);
  const guard = (handler) => (req, res) => verifiedDoctor(req, res, (doctor) => Promise.resolve(handler(req, res, doctor)).catch((error) => fail(res, error)));
  const visit = async (visitId, doctorId) => {
    if (!id(visitId)) return null;
    const rows = await query(`SELECT a.id, a.patient_id AS patientId, a.doctor_id AS doctorId, a.starts_at AS startsAt,
      a.status, a.reason, u.firstName, u.lastName, u.dob, u.sex FROM appointments a
      JOIN users u ON u.id = a.patient_id WHERE a.id = ? AND a.doctor_id = ?`, [visitId, doctorId]);
    return rows[0] || null;
  };
  const missing = (res) => res.status(404).json({ message: 'Appointment not found' });

  router.get('/dashboard', guard(async (req, res, doctor) => {
    const { status, date } = req.query;
    const statuses = ['pending', 'upcoming', 'completed', 'cancelled', 'rescheduled'];
    if (status && !statuses.includes(status)) return res.status(400).json({ message: 'Invalid status' });
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) return res.status(400).json({ message: 'Invalid date' });
    const appointments = await query(`SELECT a.id, a.starts_at AS startsAt, a.status, a.reason,
      u.firstName, u.lastName,
      (SELECT COUNT(*) FROM symptom_submissions s WHERE s.appointment_id = a.id AND s.patient_id = a.patient_id) AS intakeCount
      FROM appointments a JOIN users u ON u.id = a.patient_id
      WHERE a.doctor_id = ? ${status ? 'AND a.status = ?' : ''} ${date ? 'AND DATE(a.starts_at) = ?' : ''}
      ORDER BY a.starts_at DESC LIMIT 200`, [doctor.id, ...(status ? [status] : []), ...(date ? [date] : [])]);
    const tasks = await query(`SELECT t.id, t.appointment_id AS appointmentId, t.description, t.due_at AS dueAt,
      t.completed_at AS completedAt FROM follow_up_tasks t WHERE t.doctor_id = ? ORDER BY t.completed_at, t.due_at LIMIT 100`, [doctor.id]);
    const drafts = await query(`SELECT 'assessment' AS kind, id, appointment_id AS appointmentId FROM clinical_assessments WHERE doctor_id = ? AND published_at IS NULL
      UNION ALL SELECT 'care plan', id, appointment_id FROM care_plans WHERE doctor_id = ? AND published_at IS NULL
      UNION ALL SELECT 'prescription', id, appointment_id FROM prescriptions WHERE doctor_id = ? AND published_at IS NULL`, [doctor.id, doctor.id, doctor.id]);
    res.json({ appointments, tasks, drafts });
  }));

  router.get('/appointments/:id', guard(async (req, res, doctor) => {
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    const symptoms = await query(`SELECT id, symptoms, duration, history, medications, allergies, notes, created_at AS createdAt
      FROM symptom_submissions WHERE appointment_id = ? AND patient_id = ? ORDER BY created_at DESC`, [appointment.id, appointment.patientId]);
    const history = await query(`SELECT a.id, a.starts_at AS startsAt, a.status FROM appointments a
      WHERE a.patient_id = ? AND a.doctor_id = ? ORDER BY a.starts_at DESC LIMIT 50`, [appointment.patientId, doctor.id]);
    const assessments = await query(`SELECT id, assessment, created_at AS createdAt, published_at AS publishedAt
      FROM clinical_assessments WHERE appointment_id = ? AND doctor_id = ? ORDER BY created_at DESC`, [appointment.id, doctor.id]);
    const plans = await query(`SELECT id, advice, follow_up AS followUp, treatment, lifestyle, tests_referrals AS testsReferrals,
      created_at AS createdAt, published_at AS publishedAt FROM care_plans WHERE appointment_id = ? AND doctor_id = ? ORDER BY created_at DESC`, [appointment.id, doctor.id]);
    const prescriptions = await query(`SELECT id, medication, instructions, status, created_at AS createdAt, published_at AS publishedAt
      FROM prescriptions WHERE appointment_id = ? AND doctor_id = ? ORDER BY created_at DESC`, [appointment.id, doctor.id]);
    const predictions = await query(`SELECT id, submission_id AS submissionId, output, model_version AS modelVersion, created_at AS createdAt
      FROM model_predictions WHERE appointment_id = ? AND doctor_id = ? ORDER BY created_at DESC`, [appointment.id, doctor.id]);
    const tasks = await query(`SELECT id, description, due_at AS dueAt, completed_at AS completedAt FROM follow_up_tasks
      WHERE appointment_id = ? AND doctor_id = ? ORDER BY created_at DESC`, [appointment.id, doctor.id]);
    res.json({ appointment, symptoms, history, assessments, plans, prescriptions, predictions, tasks });
  }));

  const transitions = { pending: ['upcoming', 'cancelled', 'rescheduled'], upcoming: ['completed', 'cancelled', 'rescheduled'], rescheduled: ['upcoming', 'cancelled'], completed: [], cancelled: [] };
  router.patch('/appointments/:id/status', guard(async (req, res, doctor) => {
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    const status = req.body?.status;
    if (!transitions[appointment.status]?.includes(status)) return res.status(409).json({ message: 'Invalid status transition' });
    if (status === 'completed') {
      const records = await query(`SELECT id FROM clinical_assessments WHERE appointment_id = ? AND doctor_id = ? AND published_at IS NOT NULL LIMIT 1`, [appointment.id, doctor.id]);
      if (!records.length) return res.status(409).json({ message: 'Publish an assessment before completing a consultation' });
    }
    if (status === 'rescheduled') return res.status(400).json({ message: 'Use the reschedule action with a new slot' });
    const changed = await withTransaction(pool, async (conn) => {
      const result = await run(conn, 'UPDATE appointments SET status = ? WHERE id = ? AND doctor_id = ? AND status = ?', [status, appointment.id, doctor.id, appointment.status]);
      if (!result.affectedRows) return false;
      const message = status === 'upcoming' ? 'Your appointment was confirmed. Check your schedule.' : status === 'cancelled' ? 'Your appointment was cancelled.' : 'Your consultation was marked complete.';
      await run(conn, 'INSERT INTO notifications (user_id, message) VALUES (?, ?)', [appointment.patientId, message]);
      return true;
    });
    if (!changed) return res.status(409).json({ message: 'Appointment changed; reload' });
    res.json({ status });
  }));

  router.patch('/appointments/:id/reschedule', guard(async (req, res, doctor) => {
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    if (!['pending', 'upcoming', 'rescheduled'].includes(appointment.status)) return res.status(409).json({ message: 'Cannot reschedule this appointment' });
    const startsAt = req.body?.startsAt;
    if (typeof startsAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(startsAt) || new Date(startsAt) <= new Date()) return res.status(400).json({ message: 'Invalid slot' });
    try {
      const changed = await withTransaction(pool, async (conn) => {
        await run(conn, 'SELECT user_id FROM doctor_profiles WHERE user_id = ? FOR UPDATE', [doctor.id]);
        const result = await run(conn, `UPDATE appointments a JOIN doctor_availability v ON v.doctor_id = a.doctor_id AND v.starts_at = ?
          SET a.starts_at = v.starts_at, a.status = 'rescheduled' WHERE a.id = ? AND a.doctor_id = ? AND a.status = ?
          AND v.starts_at > NOW() AND NOT EXISTS (SELECT 1 FROM doctor_time_off l WHERE l.doctor_id = a.doctor_id AND l.starts_at < v.ends_at AND l.ends_at > v.starts_at) AND NOT EXISTS (SELECT 1 FROM appointments booked WHERE booked.doctor_id = a.doctor_id AND booked.starts_at = v.starts_at AND booked.id <> a.id AND booked.status <> 'cancelled')`,
        [startsAt.replace('T', ' '), appointment.id, doctor.id, appointment.status]);
        if (!result.affectedRows) return false;
        await run(conn, 'INSERT INTO notifications (user_id, message) VALUES (?, ?)', [appointment.patientId, 'Your appointment was rescheduled. Check your appointments for the new time.']);
        return true;
      });
      if (!changed) return res.status(409).json({ message: 'Slot unavailable or appointment changed' });
      res.json({ status: 'rescheduled', startsAt });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Slot unavailable' });
      throw error;
    }
  }));

  const records = {
    assessments: { table: 'clinical_assessments', fields: ['assessment'], required: ['assessment'] },
    'care-plans': { table: 'care_plans', fields: ['advice', 'followUp', 'treatment', 'lifestyle', 'testsReferrals'], required: ['advice'], columns: ['advice', 'follow_up', 'treatment', 'lifestyle', 'tests_referrals'] },
    prescriptions: { table: 'prescriptions', fields: ['medication', 'instructions'], required: ['medication', 'instructions'] },
  };
  router.post('/appointments/:id/:kind', guard(async (req, res, doctor) => {
    const type = records[req.params.kind];
    if (!type) return res.status(404).end();
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    if (['cancelled', 'completed'].includes(appointment.status)) return res.status(409).json({ message: 'Cannot add documentation to a closed visit' });
    const values = type.fields.map((field) => req.body?.[field]);
    if (type.required.some((field) => !content(req.body?.[field])) || values.some((value) => !optional(value))) return res.status(400).json({ message: 'Invalid clinical entry' });
    const columns = type.columns || type.fields;
    const result = await query(`INSERT INTO ${type.table} (appointment_id, doctor_id, ${columns.join(', ')}) VALUES (?, ?, ${columns.map(() => '?').join(', ')})`,
      [appointment.id, doctor.id, ...values.map((value) => value?.trim() || null)]);
    res.status(201).json({ id: result.insertId, status: 'draft' });
  }));
  router.patch('/appointments/:id/:kind/:recordId/publish', guard(async (req, res, doctor) => {
    const type = records[req.params.kind];
    if (!type || !id(req.params.recordId)) return res.status(400).json({ message: 'Invalid record' });
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    if (['cancelled', 'completed'].includes(appointment.status)) return res.status(409).json({ message: 'Cannot publish for a closed visit' });
    // Publication and audit are committed together. Once signed, rows are immutable; amendments are new drafts.
    const conn = await new Promise((resolve, reject) => pool.getConnection((err, c) => err ? reject(err) : resolve(c)));
    const run = (sql, params) => new Promise((resolve, reject) => conn.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
    try {
      await new Promise((resolve, reject) => conn.beginTransaction((err) => err ? reject(err) : resolve()));
      const updated = await run(`UPDATE ${type.table} SET published_at = NOW() WHERE id = ? AND appointment_id = ? AND doctor_id = ? AND published_at IS NULL`, [req.params.recordId, appointment.id, doctor.id]);
      if (!updated.affectedRows) { await new Promise((resolve) => conn.rollback(resolve)); return res.status(409).json({ message: 'Draft not found or already published' }); }
      await run('INSERT INTO audit_logs (actor_id, action, resource_type, resource_id) VALUES (?, ?, ?, ?)', [doctor.id, 'publish', type.table, req.params.recordId]);
      await run('INSERT INTO notifications (user_id, message) VALUES (?, ?)', [appointment.patientId, req.params.kind === 'care-plans' ? 'A care plan was published for your visit. Open My health to review it.' : req.params.kind === 'prescriptions' ? 'A prescription record was published for your visit. Open My health to review it.' : 'An assessment was published for your visit. Open My health to review it.']);
      await new Promise((resolve, reject) => conn.commit((err) => err ? reject(err) : resolve()));
      res.json({ id: req.params.recordId, status: 'published' });
    } catch (error) {
      await new Promise((resolve) => conn.rollback(resolve));
      fail(res, error);
    } finally { conn.release(); }
  }));

  router.post('/appointments/:id/tasks', guard(async (req, res, doctor) => {
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    if (!content(req.body?.description, 500)) return res.status(400).json({ message: 'Invalid follow-up task' });
    const due = req.body.dueAt || null;
    if (due && (typeof due !== 'string' || Number.isNaN(Date.parse(due)))) return res.status(400).json({ message: 'Invalid due date' });
    const result = await withTransaction(pool, async (conn) => {
      const task = await run(conn, 'INSERT INTO follow_up_tasks (appointment_id, doctor_id, description, due_at) VALUES (?, ?, ?, ?)', [appointment.id, doctor.id, req.body.description.trim(), due]);
      await run(conn, 'INSERT INTO notifications (user_id, message) VALUES (?, ?)', [doctor.id, 'A follow-up task was added to your workspace.']);
      return task;
    });
    res.status(201).json({ id: result.insertId });
  }));
  router.patch('/tasks/:id/complete', guard(async (req, res, doctor) => {
    if (!id(req.params.id)) return res.status(400).json({ message: 'Invalid task' });
    const result = await query('UPDATE follow_up_tasks SET completed_at = NOW() WHERE id = ? AND doctor_id = ? AND completed_at IS NULL', [req.params.id, doctor.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Task not found' });
    res.json({ status: 'completed' });
  }));

  router.get('/symptoms', guard(async (req, res) => {
    try { res.json(await modelRequest('/internal/symptoms')); }
    catch { res.status(503).json({ message: 'Symptom model unavailable' }); }
  }));
  router.post('/predict', guard(async (req, res) => {
    if (!validSymptoms(req.body?.symptoms)) return res.status(400).json({ message: 'Select valid symptoms' });
    try {
      const result = await modelRequest('/internal/predict', req.body.symptoms);
      if (typeof result.output !== 'string' || typeof result.modelVersion !== 'string') throw new Error('Invalid model response');
      res.json({ output:result.output, modelVersion:result.modelVersion, label:'Experimental decision support, not a diagnosis' });
    } catch { res.status(503).json({ message: 'Symptom model unavailable or selection invalid' }); }
  }));

  router.post('/appointments/:id/predictions', guard(async (req, res, doctor) => {
    const appointment = await visit(req.params.id, doctor.id);
    if (!appointment) return missing(res);
    if (['cancelled', 'completed'].includes(appointment.status)) return res.status(409).json({ message: 'Visit closed' });
    if (!id(req.body?.submissionId)) return res.status(400).json({ message: 'Invalid submission' });
    const submissions = await query('SELECT id, symptoms FROM symptom_submissions WHERE id = ? AND appointment_id = ? AND patient_id = ?', [req.body.submissionId, appointment.id, appointment.patientId]);
    if (!submissions.length) return res.status(404).json({ message: 'Submission not found' });
    // Only exact model identifiers; free-form text is never guessed or sent to the model.
    const symptoms = submissions[0].symptoms.split(',').map((item) => item.trim());
    if (!symptoms.length || symptoms.some((item) => !/^[a-z_ .()0-9-]+$/.test(item))) return res.status(422).json({ message: 'Questionnaire needs model symptom identifiers' });
    if (!process.env.PREDICTION_INTERNAL_TOKEN) return res.status(503).json({ message: 'Prediction service not configured' });
    const output = await modelRequest('/internal/predict', symptoms).catch(() => null);
    if (!output?.output || !output?.modelVersion) return res.status(422).json({ message: 'Model could not evaluate these identifiers' });
    const result = await query('INSERT INTO model_predictions (appointment_id, submission_id, doctor_id, model_version, output) VALUES (?, ?, ?, ?, ?)', [appointment.id, submissions[0].id, doctor.id, output.modelVersion, output.output]);
    res.status(201).json({ id: result.insertId, output: output.output, modelVersion: output.modelVersion, label: 'Experimental decision support, not a diagnosis' });
  }));

  router.get('/notifications', guard(async (req, res, doctor) => {
    const rows = await query('SELECT id, message, created_at AS createdAt, read_at AS readAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [doctor.id]);
    res.json(rows);
  }));
  router.patch('/notifications/:id/read', guard(async (req, res, doctor) => {
    if (!id(req.params.id)) return res.status(400).json({ message: 'Invalid notification' });
    const result = await query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?', [req.params.id, doctor.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Notification not found' });
    res.json({ status: 'read' });
  }));

  router.get('/availability', guard(async (req, res, doctor) => {
    const slots = await query('SELECT id, starts_at AS startsAt, ends_at AS endsAt FROM doctor_availability WHERE doctor_id = ? AND starts_at > NOW() ORDER BY starts_at LIMIT 200', [doctor.id]);
    const leave = await query('SELECT id, starts_at AS startsAt, ends_at AS endsAt FROM doctor_time_off WHERE doctor_id = ? AND ends_at > NOW() ORDER BY starts_at LIMIT 100', [doctor.id]);
    res.json({ slots, leave });
  }));
  router.post('/availability', guard(async (req, res, doctor) => {
    const { startsAt, endsAt } = req.body || {};
    const valid = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(value) && !Number.isNaN(Date.parse(value));
    if (!valid(startsAt) || !valid(endsAt) || new Date(startsAt) <= new Date() || new Date(endsAt) <= new Date(startsAt) || (new Date(endsAt) - new Date(startsAt)) > 4 * 60 * 60 * 1000) return res.status(400).json({ message: 'Invalid working slot' });
    const start = startsAt.replace('T', ' '), end = endsAt.replace('T', ' ');
    // Serialize all schedule mutations for this doctor through the profile row.
    const conn = await new Promise((resolve, reject) => pool.getConnection((err, c) => err ? reject(err) : resolve(c)));
    const run = (sql, params) => new Promise((resolve, reject) => conn.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
    try {
      await new Promise((resolve, reject) => conn.beginTransaction((err) => err ? reject(err) : resolve()));
      await run('SELECT user_id FROM doctor_profiles WHERE user_id = ? FOR UPDATE', [doctor.id]);
      const conflict = await run(`SELECT id FROM doctor_availability WHERE doctor_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1`, [doctor.id, end, start]);
      const off = await run('SELECT id FROM doctor_time_off WHERE doctor_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1', [doctor.id, end, start]);
      if (conflict.length || off.length) { await new Promise((resolve) => conn.rollback(resolve)); return res.status(409).json({ message: 'Working slot conflicts with an existing slot or leave' }); }
      const result = await run('INSERT INTO doctor_availability (doctor_id, starts_at, ends_at) VALUES (?, ?, ?)', [doctor.id, start, end]);
      await new Promise((resolve, reject) => conn.commit((err) => err ? reject(err) : resolve()));
      res.status(201).json({ id: result.insertId });
    } catch (error) { await new Promise((resolve) => conn.rollback(resolve)); fail(res, error); } finally { conn.release(); }
  }));
  router.delete('/availability/:id', guard(async (req, res, doctor) => {
    if (!id(req.params.id)) return res.status(400).json({ message: 'Invalid slot' });
    const result = await query(`DELETE v FROM doctor_availability v WHERE v.id = ? AND v.doctor_id = ? AND NOT EXISTS
      (SELECT 1 FROM appointments a WHERE a.doctor_id = v.doctor_id AND a.starts_at = v.starts_at AND a.status <> 'cancelled')`, [req.params.id, doctor.id]);
    if (!result.affectedRows) return res.status(409).json({ message: 'Booked or missing slot' });
    res.json({ removed: true });
  }));
  router.get('/analytics', guard(async (req, res, doctor) => {
    const totals = await query(`SELECT DATE_FORMAT(starts_at, '%Y-%m-%d') AS day, status, COUNT(*) AS total FROM appointments
      WHERE doctor_id = ? GROUP BY day, status ORDER BY day DESC LIMIT 120`, [doctor.id]);
    res.json({ appointmentsByDay: totals, definition: 'Counts of this doctor\'s appointments grouped by scheduled date and current status. No timing or feedback data is collected.' });
  }));
  return router;
};
