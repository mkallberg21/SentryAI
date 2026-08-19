-- SentryAI initial schema.
--
-- Three protections are enforced here rather than in application code, because
-- application code is exactly what fails during an incident:
--
--   1. Row-level security scopes every table to one district, and student
--      records to the caseload the user actually holds.
--   2. The audit log rejects UPDATE and DELETE at the database level. The
--      application role has no grant that could rewrite history.
--   3. Clinical fields are stored as encrypted envelopes, so a query that
--      escapes RLS still returns ciphertext.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS sentryai;

-- ---------------------------------------------------------------------------
-- Session context
--
-- The application sets these per transaction. `current_setting(..., true)`
-- returns NULL rather than raising when unset, so an unscoped connection sees
-- nothing instead of erroring in a way that tempts someone to disable RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sentryai.current_district() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('sentryai.district_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION sentryai.current_actor() RETURNS uuid
  LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('sentryai.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION sentryai.current_role_name() RETURNS text
  LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('sentryai.role', true), ''), 'none') $$;

-- Roles that see every student in their district. Everyone else is limited to
-- their assigned caseload.
CREATE OR REPLACE FUNCTION sentryai.is_district_wide_role() RETURNS boolean
  LANGUAGE sql STABLE AS
$$ SELECT sentryai.current_role_name() IN (
     'special-education-director',
     'district-administrator',
     'program-specialist'
   ) $$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE districts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- Drives which compliance pack applies. Not nullable: a district with no
  -- state would silently fall back to federal timelines and produce wrong
  -- deadlines, which is worse than failing to load.
  state_code  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schools_district_idx ON schools(district_id);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL,
  role        text NOT NULL,
  -- Professional credential, required on service logs for Medicaid claiming.
  credential  text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (district_id, email)
);
CREATE INDEX users_district_idx ON users(district_id);

-- ---------------------------------------------------------------------------
-- School calendars
--
-- Stored per district and year because day counting depends on them. A wrong
-- calendar produces wrong deadlines district-wide, so this is operational data,
-- not configuration.
-- ---------------------------------------------------------------------------

CREATE TABLE school_calendars (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id             uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  year                    text NOT NULL,
  first_instructional_day date NOT NULL,
  last_instructional_day  date NOT NULL,
  non_instructional_days  date[] NOT NULL DEFAULT '{}',
  extended_breaks         jsonb NOT NULL DEFAULT '[]',
  UNIQUE (district_id, year)
);

-- ---------------------------------------------------------------------------
-- Students
--
-- Names and identifiers are stored in the clear, protected by RLS. Encrypting
-- them would make caseload listing, sorting, and SIS reconciliation impossible
-- without decrypting every row on every request, which trades a real capability
-- for very little: an attacker who has escaped RLS already knows which district
-- and school they are looking at.
--
-- What IS encrypted is the clinical detail -- disability category, present
-- levels, evaluation and progress narratives. That is the information whose
-- disclosure actually harms a child.
-- ---------------------------------------------------------------------------

CREATE TABLE students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id   uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  local_id      text NOT NULL,
  state_id      text,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  date_of_birth date NOT NULL,
  grade_level   text NOT NULL,
  home_language text NOT NULL DEFAULT 'English',
  decision_makers jsonb NOT NULL DEFAULT '[]',
  enrolled_on   date NOT NULL,
  exited_on     date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (district_id, local_id)
);
CREATE INDEX students_district_idx ON students(district_id);
CREATE INDEX students_school_idx ON students(school_id);

-- Who is responsible for whom. Drives caseload-level row security.
CREATE TABLE student_assignments (
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  district_id uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  role        text NOT NULL,
  assigned_on date NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (student_id, user_id)
);
CREATE INDEX student_assignments_user_idx ON student_assignments(user_id);

-- Can the current session see this student?
CREATE OR REPLACE FUNCTION sentryai.can_see_student(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, sentryai AS
$$
  SELECT sentryai.is_district_wide_role()
      OR EXISTS (
           SELECT 1 FROM student_assignments a
            WHERE a.student_id = target
              AND a.user_id = sentryai.current_actor()
         )
$$;

-- ---------------------------------------------------------------------------
-- Special education records
-- ---------------------------------------------------------------------------

CREATE TABLE evaluations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id              uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  student_id               uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind                     text NOT NULL,
  status                   text NOT NULL,
  referred_on              date NOT NULL,
  consent_requested_on     date,
  consent_received_on      date,
  consent_id               uuid,
  report_completed_on      date,
  eligibility_determined_on date,
  assigned_to              uuid REFERENCES users(id) ON DELETE SET NULL,
  tolled_periods           jsonb NOT NULL DEFAULT '[]',
  -- Encrypted envelope: evaluation findings and recommendations.
  findings_encrypted       jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluations_student_idx ON evaluations(student_id);
CREATE INDEX evaluations_district_open_idx
  ON evaluations(district_id) WHERE eligibility_determined_on IS NULL;

CREATE TABLE ieps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id          uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind                 text NOT NULL,
  status               text NOT NULL,
  primary_disability_encrypted    jsonb,
  secondary_disabilities_encrypted jsonb,
  meeting_id           uuid,
  effective_on         date NOT NULL,
  annual_review_due_on date NOT NULL,
  present_levels_encrypted jsonb,
  present_levels_provenance jsonb NOT NULL,
  placement            jsonb NOT NULL,
  accommodations       jsonb NOT NULL DEFAULT '[]',
  transition_plan      jsonb,
  extended_school_year jsonb NOT NULL,
  signed_on            date,
  supersedes_iep_id    uuid REFERENCES ieps(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ieps_student_idx ON ieps(student_id);
-- Supports the district dashboard's "what is due" query without a scan.
CREATE INDEX ieps_active_review_idx
  ON ieps(district_id, annual_review_due_on) WHERE status = 'active';

-- Only one IEP may be in effect for a student at a time. Two active IEPs means
-- two conflicting offers of FAPE, which is unanswerable at a hearing.
CREATE UNIQUE INDEX ieps_one_active_per_student
  ON ieps(student_id) WHERE status = 'active';

CREATE TABLE goals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  iep_id              uuid NOT NULL REFERENCES ieps(id) ON DELETE CASCADE,
  area                text NOT NULL,
  statement_encrypted jsonb,
  baseline            jsonb NOT NULL,
  target              jsonb NOT NULL,
  measurement_method  text NOT NULL,
  reporting_frequency text NOT NULL,
  objectives          jsonb NOT NULL DEFAULT '[]',
  provenance          jsonb NOT NULL,
  position            integer NOT NULL DEFAULT 0
);
CREATE INDEX goals_iep_idx ON goals(iep_id);

CREATE TABLE services (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  iep_id              uuid NOT NULL REFERENCES ieps(id) ON DELETE CASCADE,
  type                text NOT NULL,
  minutes_per_session integer NOT NULL CHECK (minutes_per_session > 0),
  sessions_per_period integer NOT NULL CHECK (sessions_per_period > 0),
  period              text NOT NULL CHECK (period IN ('week', 'month', 'year')),
  setting             text NOT NULL,
  provider_role       text NOT NULL,
  starts_on           date NOT NULL,
  ends_on             date NOT NULL,
  medicaid_billable   boolean NOT NULL DEFAULT false,
  CHECK (ends_on >= starts_on)
);
CREATE INDEX services_iep_idx ON services(iep_id);

CREATE TABLE meetings (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id                 uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  student_id                  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  purpose                     text NOT NULL,
  notice_sent_on              date,
  scheduled_for               date NOT NULL,
  held_on                     date,
  interpreter_provided        boolean NOT NULL DEFAULT false,
  interpreter_language        text,
  rescheduled_from            date[] NOT NULL DEFAULT '{}',
  parent_requested_reschedule boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meetings_student_idx ON meetings(student_id);

CREATE TABLE meeting_attendance (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id           uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  meeting_id            uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  name                  text NOT NULL,
  role                  text NOT NULL,
  status                text NOT NULL,
  written_input_provided boolean NOT NULL DEFAULT false
);
CREATE INDEX meeting_attendance_meeting_idx ON meeting_attendance(meeting_id);

CREATE TABLE consents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id           uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  student_id            uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind                  text NOT NULL,
  requested_on          date NOT NULL,
  responded_on          date,
  response              text NOT NULL,
  signed_by             text,
  presented_in_language text NOT NULL,
  document_uri          text
);
CREATE INDEX consents_student_idx ON consents(student_id);

CREATE TABLE notices (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id             uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  student_id              uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind                    text NOT NULL,
  sent_on                 date NOT NULL,
  delivery                text NOT NULL,
  language                text NOT NULL,
  translation_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  content_encrypted       jsonb,
  document_uri            text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notices_student_idx ON notices(student_id);

CREATE TABLE progress_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  goal_id             uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  student_id          uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  recorded_on         date NOT NULL,
  recorded_by         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  value               numeric NOT NULL,
  unit                text NOT NULL,
  narrative_encrypted jsonb,
  on_track            boolean NOT NULL
);
CREATE INDEX progress_goal_idx ON progress_entries(goal_id, recorded_on DESC);

CREATE TABLE service_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id         uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  service_id          uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  student_id          uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  delivered_on        date NOT NULL,
  minutes_delivered   integer NOT NULL CHECK (minutes_delivered >= 0),
  provider_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_credential text NOT NULL,
  setting             text NOT NULL,
  group_size          integer NOT NULL DEFAULT 1 CHECK (group_size > 0),
  narrative_encrypted jsonb,
  status              text NOT NULL,
  signed_on           date,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_logs_service_idx ON service_logs(service_id, delivered_on);
CREATE INDEX service_logs_student_idx ON service_logs(student_id);

-- ---------------------------------------------------------------------------
-- Governance
-- ---------------------------------------------------------------------------

CREATE TABLE approval_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id       uuid NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  action            text NOT NULL,
  subject_type      text NOT NULL,
  subject_id        uuid NOT NULL,
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_by_role text NOT NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  justification     text NOT NULL CHECK (length(btrim(justification)) > 0),
  state             text NOT NULL DEFAULT 'pending',
  decided_by        uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_by_role   text,
  decided_at        timestamptz,
  decision_note     text,
  expires_at        timestamptz NOT NULL,
  -- Separation of duties, enforced in the database. Application code that
  -- forgets this check cannot produce a self-approved row.
  CONSTRAINT approval_not_self CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX approval_pending_idx
  ON approval_requests(district_id, requested_at) WHERE state = 'pending';

CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  district_id   uuid NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
  sequence      bigint NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_id      uuid,
  actor_role    text NOT NULL,
  action        text NOT NULL,
  subject_type  text NOT NULL,
  subject_id    text NOT NULL,
  student_id    uuid,
  -- Field NAMES only. Values here would make the audit log a second, less
  -- protected copy of the student record.
  changed_fields text[] NOT NULL DEFAULT '{}',
  reason        text,
  previous_hash text NOT NULL,
  hash          text NOT NULL,
  UNIQUE (district_id, sequence)
);
CREATE INDEX audit_student_idx ON audit_log(student_id, sequence);

-- The audit log is append-only at the database level. This is the property the
-- whole governance story rests on: no application bug, ORM misuse, or
-- compromised service account can rewrite history, because the privilege to do
-- so is not granted to the role the application connects as.
CREATE OR REPLACE FUNCTION sentryai.reject_audit_mutation() RETURNS trigger
  LANGUAGE plpgsql AS
$$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION sentryai.reject_audit_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION sentryai.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- FORCE is used so the table owner is subject to the policies too. Without it,
-- RLS silently does nothing whenever the application connects as the owner --
-- which is the default in most deployments and the most common way RLS ends up
-- being decorative.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schools', 'users', 'school_calendars', 'students', 'student_assignments',
    'evaluations', 'ieps', 'goals', 'services', 'meetings', 'meeting_attendance',
    'consents', 'notices', 'progress_entries', 'service_logs',
    'approval_requests', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY district_isolation ON %I USING (district_id = sentryai.current_district()) WITH CHECK (district_id = sentryai.current_district())',
      t
    );
  END LOOP;
END $$;

-- districts is scoped by its own id rather than a district_id column.
ALTER TABLE districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE districts FORCE ROW LEVEL SECURITY;
CREATE POLICY district_self ON districts
  USING (id = sentryai.current_district())
  WITH CHECK (id = sentryai.current_district());

-- Caseload scoping layers on top of district isolation. Both policies are
-- restrictive with respect to each other: a row must satisfy district
-- isolation AND caseload visibility.
CREATE POLICY caseload_visibility ON students
  AS RESTRICTIVE
  USING (sentryai.can_see_student(id))
  WITH CHECK (sentryai.can_see_student(id));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'evaluations', 'ieps', 'meetings', 'consents', 'notices',
    'progress_entries', 'service_logs', 'approval_requests'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY caseload_visibility ON %I AS RESTRICTIVE USING (sentryai.can_see_student(student_id)) WITH CHECK (sentryai.can_see_student(student_id))',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Application role
--
-- Deliberately has no UPDATE or DELETE on audit_log. The trigger above is the
-- belt; this is the braces.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentryai_app') THEN
    CREATE ROLE sentryai_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public, sentryai TO sentryai_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sentryai_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sentryai_app;

REVOKE UPDATE, DELETE ON audit_log FROM sentryai_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sentryai TO sentryai_app;
