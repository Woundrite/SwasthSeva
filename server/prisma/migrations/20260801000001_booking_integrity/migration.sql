-- Integrity rules that Prisma's schema language cannot express.
--
-- The exclusion constraints below are the real double-booking guarantee. The
-- application also holds a transaction-scoped advisory lock while it checks
-- availability, but that lock only serialises well-behaved callers. These
-- constraints are what make an overlapping appointment physically impossible,
-- including for direct SQL access, buggy code paths and concurrent transactions.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Range sanity
-- ---------------------------------------------------------------------------

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_time_range_valid" CHECK ("ends_at" > "starts_at");

ALTER TABLE "slot_holds"
    ADD CONSTRAINT "slot_holds_time_range_valid" CHECK ("ends_at" > "starts_at");

ALTER TABLE "doctor_leaves"
    ADD CONSTRAINT "doctor_leaves_time_range_valid" CHECK ("ends_at" > "starts_at");

-- ---------------------------------------------------------------------------
-- Overlap prevention
-- ---------------------------------------------------------------------------

-- A doctor can never hold two live appointments that overlap in time. Using a
-- range overlap (rather than a unique index on the start time) keeps the
-- guarantee correct when slot durations differ, for example after an admin
-- shortens a doctor's slot length while future bookings already exist.
ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_no_overlap_per_doctor"
    EXCLUDE USING gist (
        "doctor_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    )
    WHERE ("status" IN ('SCHEDULED', 'COMPLETED'));

-- The same protection from the patient's side: one person cannot be booked
-- into two overlapping consultations, even with different doctors.
ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_no_overlap_per_patient"
    EXCLUDE USING gist (
        "patient_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    )
    WHERE ("status" IN ('SCHEDULED', 'COMPLETED'));

-- Two patients cannot hold the same slot at the same time. Expired holds are
-- moved out of ACTIVE (lazily on the booking path, and by the sweeper job), so
-- an abandoned checkout never permanently blocks a slot.
ALTER TABLE "slot_holds"
    ADD CONSTRAINT "slot_holds_no_overlap_per_doctor"
    EXCLUDE USING gist (
        "doctor_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    )
    WHERE ("status" = 'ACTIVE');

-- A doctor's leave periods must not overlap each other, so leave windows stay
-- unambiguous when the availability generator subtracts them.
ALTER TABLE "doctor_leaves"
    ADD CONSTRAINT "doctor_leaves_no_overlap_per_doctor"
    EXCLUDE USING gist (
        "doctor_id" WITH =,
        tstzrange("starts_at", "ends_at", '[)') WITH &&
    );

-- ---------------------------------------------------------------------------
-- Domain rules
-- ---------------------------------------------------------------------------

-- Emails are stored lower-cased so the unique index is genuinely case-insensitive.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

ALTER TABLE "doctor_profiles"
    ADD CONSTRAINT "doctor_profiles_slot_duration_valid"
    CHECK ("slot_duration_minutes" BETWEEN 5 AND 240 AND "buffer_minutes" BETWEEN 0 AND 120);

ALTER TABLE "doctor_working_hours"
    ADD CONSTRAINT "doctor_working_hours_valid"
    CHECK (
        "day_of_week" BETWEEN 0 AND 6
        AND "start_minute" >= 0
        AND "end_minute" <= 1440
        AND "start_minute" < "end_minute"
    );

-- A working block must not overlap another block on the same weekday.
ALTER TABLE "doctor_working_hours"
    ADD CONSTRAINT "doctor_working_hours_no_overlap"
    EXCLUDE USING gist (
        "doctor_id" WITH =,
        "day_of_week" WITH =,
        int4range("start_minute", "end_minute", '[)') WITH &&
    );

ALTER TABLE "symptom_intakes"
    ADD CONSTRAINT "symptom_intakes_severity_valid"
    CHECK ("severity" IS NULL OR "severity" BETWEEN 1 AND 10);

ALTER TABLE "prescription_items"
    ADD CONSTRAINT "prescription_items_schedule_valid"
    CHECK (
        "frequency_per_day" BETWEEN 1 AND 12
        AND "duration_days" BETWEEN 1 AND 365
        AND COALESCE(array_length("times_of_day", 1), 0) = "frequency_per_day"
    );

-- A cancelled appointment must always record when and why it was cancelled.
ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_cancellation_complete"
    CHECK (
        "status" <> 'CANCELLED'
        OR ("cancelled_at" IS NOT NULL AND "cancellation_reason" IS NOT NULL)
    );

-- A delivered outbox row must carry its delivery timestamp.
ALTER TABLE "email_outbox"
    ADD CONSTRAINT "email_outbox_sent_complete"
    CHECK ("status" <> 'SENT' OR "sent_at" IS NOT NULL);
