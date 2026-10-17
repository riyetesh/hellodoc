-- Apply only after 001_patient_foundation and a reviewed backup. MySQL 8.
ALTER TABLE clinical_assessments ADD COLUMN published_at DATETIME NULL;
ALTER TABLE care_plans ADD COLUMN treatment TEXT NULL, ADD COLUMN lifestyle TEXT NULL,
  ADD COLUMN tests_referrals TEXT NULL;
CREATE TABLE model_predictions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  submission_id BIGINT UNSIGNED NOT NULL,
  doctor_id INT NOT NULL,
  model_version VARCHAR(120) NOT NULL,
  output VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_prediction_visit (appointment_id, created_at),
  CONSTRAINT fk_prediction_visit FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT fk_prediction_submission FOREIGN KEY (submission_id) REFERENCES symptom_submissions(id),
  CONSTRAINT fk_prediction_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE follow_up_tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id BIGINT UNSIGNED NOT NULL,
  doctor_id INT NOT NULL,
  description VARCHAR(500) NOT NULL,
  due_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doctor_task (doctor_id, completed_at, due_at),
  CONSTRAINT fk_task_visit FOREIGN KEY (appointment_id) REFERENCES appointments(id),
  CONSTRAINT fk_task_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE doctor_schedule (
  doctor_id INT NOT NULL PRIMARY KEY,
  appointment_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  consultation_types VARCHAR(120) NOT NULL DEFAULT 'video',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_schedule_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
CREATE TABLE doctor_time_off (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  CONSTRAINT fk_time_off_doctor FOREIGN KEY (doctor_id) REFERENCES doctor_profiles(user_id)
);
-- Published clinical records must not be silently overwritten. Amendments are new rows.
INSERT INTO schema_migrations (version) VALUES ('002_doctor_workspace');
