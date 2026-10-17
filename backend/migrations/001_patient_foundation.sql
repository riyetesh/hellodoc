-- Apply once to the existing hello_doc database after reviewing SHOW CREATE TABLE users.
-- Requires users.id to be INT-compatible; existing users remain patients.
-- Take a backup before applying. MySQL DDL commits independently.
ALTER TABLE users ADD COLUMN role ENUM('patient','doctor') NOT NULL DEFAULT 'patient';
CREATE TABLE doctor_profiles (
  user_id INT NOT NULL PRIMARY KEY,
  verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  specialty VARCHAR(120) NOT NULL,
  language VARCHAR(80) NULL,
  consultation_type ENUM('video','in-person','both') NOT NULL DEFAULT 'video',
  fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  approved_at DATETIME NULL,
  CONSTRAINT fk_doctor_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE doctor_availability (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  UNIQUE KEY uq_doctor_slot (doctor_id, starts_at),
  CONSTRAINT fk_availability_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE appointments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  doctor_id INT NOT NULL,
  starts_at DATETIME NOT NULL,
  status ENUM('pending','upcoming','completed','cancelled','rescheduled') NOT NULL DEFAULT 'pending',
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_patient_appointment (patient_id, starts_at),
  INDEX idx_doctor_appointment (doctor_id, starts_at),
  active_slot DATETIME GENERATED ALWAYS AS (CASE WHEN status = 'cancelled' THEN NULL ELSE starts_at END) STORED,
  UNIQUE KEY uq_appointment_slot (doctor_id, active_slot),
  CONSTRAINT fk_appointment_patient FOREIGN KEY (patient_id) REFERENCES users(id),
  CONSTRAINT fk_appointment_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE symptom_submissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  appointment_id BIGINT UNSIGNED NULL,
  symptoms TEXT NOT NULL,
  duration VARCHAR(120) NOT NULL,
  history TEXT NULL,
  medications TEXT NULL,
  allergies TEXT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_symptoms_patient (patient_id, created_at),
  CONSTRAINT fk_symptom_patient FOREIGN KEY (patient_id) REFERENCES users(id),
  CONSTRAINT fk_symptom_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);
CREATE TABLE clinical_assessments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  doctor_id INT NOT NULL,
  assessment TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assessment_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT fk_assessment_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE care_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  doctor_id INT NOT NULL,
  advice TEXT NOT NULL,
  follow_up TEXT NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_plan_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT fk_plan_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE prescriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  doctor_id INT NOT NULL,
  medication VARCHAR(255) NOT NULL,
  instructions TEXT NOT NULL,
  status ENUM('active','stopped','completed') NOT NULL DEFAULT 'active',
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prescription_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT fk_prescription_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message VARCHAR(500) NOT NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notification_user (user_id, created_at),
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NOT NULL,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_resource (resource_type, resource_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id)
);
CREATE TABLE schema_migrations (version VARCHAR(80) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO schema_migrations (version) VALUES ('001_patient_foundation');
